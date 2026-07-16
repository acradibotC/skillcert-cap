const cds = require('@sap/cds');
const {
    STATUS,
    FIELD_CATALOG,
    stableHash,
    profileVersion,
    validateChangeSet,
    canTransition,
    resolveProfileMode
} = require('./profile-domain');

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;
const BANK_LOCK_FIELDS = ['PAY_METHOD', 'BANK_COUNTRY', 'BANK_KEY', 'BANK_ACCT'];
const MOCK_BANKS = Object.freeze([
    { BankCountry: 'VN', BankKey: 'LOCAL-DEMO', BankName: 'Local Demo Bank', IsSimulation: true }
]);

function reject(req, status, code, message, target) {
    return req.reject({ status, code, message, target });
}

function requireAvailableAdapter(req) {
    let mode;
    try {
        mode = resolveProfileMode();
    } catch (error) {
        reject(req, 503, error.code || 'PROFILE_MODE_INVALID', error.message);
    }
    if (mode === 'sap') {
        reject(req, 503, 'SAP_PROFILE_ADAPTER_NOT_CONFIGURED', 'The SAP profile adapter is not configured.');
    }
    return mode;
}

function userContext(req, requireHr = false) {
    const httpReq = req.http?.req;
    const sessionInfo = httpReq?.session?.userInfo;
    const capInfo = req.user?.attr || {};
    if (httpReq && sessionInfo && String(sessionInfo.userId || '') !== String(httpReq.user?.id || '')) {
        reject(req, 403, 'IDENTITY_CONTEXT_MISMATCH', 'The authenticated identity must be mapped again.');
    }
    const info = sessionInfo || capInfo;
    const authenticated = httpReq
        ? httpReq.isAuthenticated?.() === true
        : Boolean(req.user?.id && req.user.id !== 'anonymous');
    if (!authenticated || info?.authorized === false || !info?.pernr) {
        reject(req, 403, 'EMPLOYEE_NOT_LINKED', 'The authenticated identity is not linked to an employee.');
    }
    const context = {
        pernr: String(info.pernr),
        email: String(info.email || httpReq?.user?.emails?.[0]?.value || '').toLowerCase(),
        name: String(info.employeeName || info.name || ''),
        isHrAdmin: info.isHrAdmin === true || req.user?.is?.('ProfileHRAdmin') === true
    };
    if (requireHr && !context.isHrAdmin) {
        reject(req, 403, 'PROFILE_HR_FORBIDDEN', 'HR profile permission is required.');
    }
    return context;
}

function addWhere(query, expression) {
    const current = query.SELECT?.where;
    query.SELECT.where = current ? [{ xpr: current }, 'and', ...expression] : expression;
}

function now() {
    return new Date().toISOString();
}

function requestNumber() {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    return `PR-${stamp}-${cds.utils.uuid().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

function resubmitInputHash(data) {
    const changes = Array.isArray(data.Changes) ? data.Changes.map(change => [
        String(change.FieldCode || change.FieldName || change.fieldName || '').trim().toUpperCase(),
        String(change.NewValue ?? change.newValue ?? '').trim()
    ]).sort((left, right) => left[0].localeCompare(right[0])) : [];
    return stableHash({
        requestId: String(data.RequestId || ''),
        expectedVersion: Number(data.ExpectedVersion),
        profileVersion: String(data.ProfileVersion || ''),
        remark: String(data.Remark || '').trim().slice(0, 500),
        changes
    });
}

function fieldsToLock(changes) {
    const fields = new Set(changes.map(change => change.fieldName));
    if (BANK_LOCK_FIELDS.some(field => fields.has(field))) {
        BANK_LOCK_FIELDS.forEach(field => fields.add(field));
    }
    return [...fields];
}

function ensureValidBankSelection(req, validation, mode) {
    if (validation.finalProfile?.paymentMethod !== 'T') return;
    if (mode === 'mock') {
        const valid = MOCK_BANKS.some(bank =>
            bank.BankCountry === validation.finalProfile.bankCountry &&
            bank.BankKey === validation.finalProfile.bankKey
        );
        if (!valid) {
            reject(req, 400, 'BANK_NOT_IN_CATALOG', 'Select a bank from the available bank catalog.', 'BANK_KEY');
        }
    }
}

function requestDto(request) {
    return {
        ID: request.ID,
        RequestNo: request.requestNo,
        Pernr: request.employeePernr,
        EmployeeName: request.employeeName,
        Status: request.status,
        Version: request.version,
        RevisionNo: request.revisionNo,
        Remark: request.employeeRemark,
        HrComment: request.hrComment,
        ApplyState: request.applyState,
        IsSimulation: request.isSimulation,
        SubmittedAt: request.createdAt,
        ModifiedAt: request.modifiedAt
    };
}

module.exports = async function ProfileService() {
    const db = await cds.connect.to('db');
    const {
        ProfileChangeRequests,
        ProfileChangeItems,
        ProfileFieldLocks,
        ProfileRequestEvents,
        ProfileNotificationOutbox,
        ProfileSnapshots
    } = db.entities('znxr09.db');

    async function ensureSnapshot(tx, context) {
        let snapshot = await tx.run(SELECT.one.from(ProfileSnapshots).where({ employeePernr: context.pernr }));
        if (!snapshot) {
            snapshot = {
                employeePernr: context.pernr,
                employeeName: context.name,
                workEmail: context.email,
                paymentMethod: 'C',
                version: 1
            };
            await tx.run(INSERT.into(ProfileSnapshots).entries(snapshot));
            snapshot = await tx.run(SELECT.one.from(ProfileSnapshots).where({ employeePernr: context.pernr }));
        }
        return snapshot;
    }

    async function getRequest(tx, requestId) {
        return tx.run(SELECT.one.from(ProfileChangeRequests).where({ ID: requestId }));
    }

    function assertVersion(req, request, expectedVersion) {
        if (Number(expectedVersion) !== Number(request.version)) {
            reject(req, 409, 'STALE_VERSION', 'The request was changed by another user. Reload and retry.');
        }
    }

    async function writeEvent(tx, request, eventType, fromStatus, toStatus, context, comment) {
        await tx.run(INSERT.into(ProfileRequestEvents).entries({
            ID: cds.utils.uuid(),
            request_ID: request.ID,
            revisionNo: request.revisionNo,
            eventType,
            fromStatus,
            toStatus,
            actorEmail: context.email,
            actorPernr: context.pernr,
            actorRole: context.isHrAdmin ? 'HR' : 'EMPLOYEE',
            comment: comment || '',
            correlationId: cds.context?.id || '',
            occurredAt: now()
        }));
    }

    async function writeOutbox(tx, request, eventType, recipientType, recipientKey) {
        await tx.run(INSERT.into(ProfileNotificationOutbox).entries({
            ID: cds.utils.uuid(),
            request_ID: request.ID,
            eventType,
            recipientType,
            recipientKey: recipientKey || '',
            deliveryStatus: 'PENDING',
            attempts: 0
        }));
    }

    this.on('READ', 'MyProfile', async req => {
        const mode = requireAvailableAdapter(req);
        const context = userContext(req);
        const tx = db.tx(req);
        const snapshot = await ensureSnapshot(tx, context);
        return {
            Pernr: context.pernr,
            EmployeeName: snapshot.employeeName || context.name,
            PositionName: snapshot.position || '',
            OrgUnitName: snapshot.department || '',
            IdNumber: snapshot.idNumber || '',
            Telephone: snapshot.telephone || '',
            PermanentAddress: snapshot.permanentAddress || '',
            WorkEmail: snapshot.workEmail || context.email,
            CurrentAddress: snapshot.currentAddress || '',
            TaxCode: snapshot.taxCode || '',
            PayMethod: snapshot.paymentMethod || 'C',
            PayMethodText: snapshot.paymentMethod === 'T' ? 'Bank Transfer' : 'Cash',
            BankCountry: snapshot.bankCountry || '',
            BankKey: snapshot.bankKey || '',
            BankAccount: snapshot.bankAccount || '',
            BankName: snapshot.bankName || '',
            JoinDate: snapshot.joinDate || null,
            ContractType: snapshot.contractType || '',
            DependentsSummary: snapshot.dependentsSummary || '',
            ProfileVersion: profileVersion(snapshot),
            IsSimulation: mode === 'mock'
        };
    });

    this.before('READ', 'MyProfileRequests', req => {
        requireAvailableAdapter(req);
        const context = userContext(req);
        addWhere(req.query, [{ ref: ['Pernr'] }, '=', { val: context.pernr }]);
    });

    this.before('READ', 'MyProfileRequestItems', req => {
        requireAvailableAdapter(req);
        const context = userContext(req);
        addWhere(req.query, [{ ref: ['Pernr'] }, '=', { val: context.pernr }]);
    });

    this.before('READ', 'ProfileApprovalRequests', req => {
        requireAvailableAdapter(req);
        userContext(req, true);
    });

    this.before('READ', ['ProfileApprovalRequestItems', 'ProfileRequestEvents'], req => {
        requireAvailableAdapter(req);
        userContext(req, true);
    });

    this.on('READ', 'MyProfileFields', async req => {
        requireAvailableAdapter(req);
        const context = userContext(req);
        const tx = db.tx(req);
        const snapshot = await ensureSnapshot(tx, context);
        const locks = await tx.run(SELECT.from(ProfileFieldLocks).where({ employeePernr: context.pernr }));
        const requests = locks.length
            ? await tx.run(SELECT.from(ProfileChangeRequests).where({ employeePernr: context.pernr }))
            : [];
        const requestById = new Map(requests.map(request => [request.ID, request]));
        return Object.entries(FIELD_CATALOG).map(([FieldCode, definition]) => {
            const lock = locks.find(candidate => candidate.fieldName === FieldCode);
            const request = lock && requestById.get(lock.request_ID);
            const value = snapshot[definition.property] || '';
            return {
                FieldCode,
                Value: value,
                DisplayValue: value,
                FieldGroup: definition.group,
                MaxLength: definition.maxLength,
                Editable: true,
                Mandatory: FieldCode === 'PAY_METHOD',
                Sensitive: Boolean(definition.sensitive),
                Locked: Boolean(lock),
                LockRequestId: lock?.request_ID || null,
                LockStatus: request?.status || '',
                MappingStatus: definition.mappingStatus
            };
        });
    });

    this.on('READ', 'ProfilePaymentMethods', () => [
        { Code: 'C', Text: 'Cash', Category: 'CASH', IsBankTransfer: false },
        { Code: 'T', Text: 'Bank Transfer', Category: 'BANK_TRANSFER', IsBankTransfer: true }
    ]);

    this.on('READ', 'ProfileBanks', req => {
        requireAvailableAdapter(req);
        return MOCK_BANKS.map(bank => ({ ...bank }));
    });

    this.on('submitProfileChange', async req => {
        const mode = requireAvailableAdapter(req);
        const context = userContext(req);
        const idempotencyKey = String(req.data.IdempotencyKey || '').trim();
        if (!idempotencyKey || idempotencyKey.length > 64) {
            return reject(req, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.', 'idempotencyKey');
        }

        return db.run(async tx => {
            const snapshot = await ensureSnapshot(tx, context);
            const currentProfileVersion = profileVersion(snapshot);
            if (!req.data.ProfileVersion) {
                return reject(req, 400, 'PROFILE_VERSION_REQUIRED', 'The profile version is required.', 'ProfileVersion');
            }
            if (req.data.ProfileVersion !== currentProfileVersion) {
                return reject(req, 409, 'STALE_PROFILE', 'The profile changed. Reload before submitting.');
            }
            const validation = validateChangeSet(snapshot, req.data.Changes);
            if (validation.errors.length) {
                return reject(req, 400, 'VALIDATION_ERROR', validation.errors.map(error => error.message).join(' '));
            }
            ensureValidBankSelection(req, validation, mode);

            const normalizedRemark = String(req.data.Remark || '').trim().slice(0, 500);
            const payloadHash = stableHash({
                changes: validation.changes.map(change => [change.fieldName, change.newValue]),
                remark: normalizedRemark
            });
            const existing = await tx.run(SELECT.one.from(ProfileChangeRequests).where({
                employeePernr: context.pernr,
                idempotencyKey
            }));
            if (existing) {
                if (existing.payloadHash === payloadHash) return requestDto(existing);
                return reject(req, 409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was already used for another payload.');
            }

            const fieldNames = fieldsToLock(validation.changes);
            const existingLocks = await tx.run(SELECT.from(ProfileFieldLocks).where({ employeePernr: context.pernr }));
            const conflicting = existingLocks.find(lock => fieldNames.includes(lock.fieldName));
            if (conflicting) {
                return reject(req, 409, 'FIELD_LOCKED', `${conflicting.fieldName} already has an active request.`, conflicting.fieldName);
            }

            const request = {
                ID: cds.utils.uuid(),
                requestNo: requestNumber(),
                employeePernr: context.pernr,
                employeeName: snapshot.employeeName || context.name,
                requestedByEmail: context.email,
                status: STATUS.PENDING,
                version: 1,
                revisionNo: 1,
                profileVersion: currentProfileVersion,
                idempotencyKey,
                payloadHash,
                employeeRemark: normalizedRemark,
                applyState: 'NOT_APPLIED',
                isSimulation: false
            };
            await tx.run(INSERT.into(ProfileChangeRequests).entries(request));
            await tx.run(INSERT.into(ProfileChangeItems).entries(validation.changes.map((change, index) => ({
                ID: cds.utils.uuid(), request_ID: request.ID, revisionNo: 1, sequence: index + 1,
                fieldName: change.fieldName, fieldGroup: change.fieldGroup,
                oldValue: change.oldValue, newValue: change.newValue, oldValueHash: change.oldValueHash,
                isSensitive: change.isSensitive, mappingStatus: change.mappingStatus,
                sapInfotype: change.sapInfotype, sapSubtype: change.sapSubtype, sapField: change.sapField,
                isCurrent: true
            }))));
            await tx.run(INSERT.into(ProfileFieldLocks).entries(fieldNames.map(fieldName => ({
                employeePernr: context.pernr,
                fieldName,
                request_ID: request.ID,
                acquiredAt: now()
            }))));
            await writeEvent(tx, request, 'SUBMITTED', null, STATUS.PENDING, context, request.employeeRemark);
            await writeOutbox(tx, request, 'PROFILE_SUBMITTED', 'HR', 'PROFILE_HR');
            return requestDto(request);
        });
    });

    this.on('resubmitProfileChange', async req => {
        const mode = requireAvailableAdapter(req);
        const context = userContext(req);
        const idempotencyKey = String(req.data.IdempotencyKey || '').trim();
        if (!idempotencyKey || idempotencyKey.length > 64) {
            return reject(req, 400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid idempotency key is required.', 'IdempotencyKey');
        }
        const inputHash = resubmitInputHash(req.data);
        return db.run(async tx => {
            const request = await getRequest(tx, req.data.RequestId);
            if (!request || request.employeePernr !== context.pernr) {
                return reject(req, 404, 'REQUEST_NOT_FOUND', 'Profile request was not found.');
            }
            if (request.lastResubmitKey === idempotencyKey) {
                if (request.lastResubmitHash === inputHash) return requestDto(request);
                return reject(req, 409, 'IDEMPOTENCY_CONFLICT', 'The idempotency key was already used for another resubmit payload.');
            }
            if (!canTransition(request.status, 'resubmit')) {
                return reject(req, 400, 'INVALID_STATE', 'Only a revision request can be resubmitted.');
            }
            assertVersion(req, request, req.data.ExpectedVersion);
            const snapshot = await ensureSnapshot(tx, context);
            const currentProfileVersion = profileVersion(snapshot);
            if (!req.data.ProfileVersion) {
                return reject(req, 400, 'PROFILE_VERSION_REQUIRED', 'The profile version is required.', 'ProfileVersion');
            }
            if (req.data.ProfileVersion !== currentProfileVersion) {
                return reject(req, 409, 'STALE_PROFILE', 'The profile changed. Reload before resubmitting.');
            }
            const validation = validateChangeSet(snapshot, req.data.Changes);
            if (validation.errors.length) {
                return reject(req, 400, 'VALIDATION_ERROR', validation.errors.map(error => error.message).join(' '));
            }
            ensureValidBankSelection(req, validation, mode);
            const locks = await tx.run(SELECT.from(ProfileFieldLocks).where({ request_ID: request.ID }));
            const allowed = new Set(locks.map(lock => lock.fieldName));
            if (validation.changes.some(change => !allowed.has(change.fieldName))) {
                return reject(req, 409, 'REVISION_FIELD_MISMATCH', 'Resubmit can only change fields in the revision request.');
            }
            const nextLockFields = fieldsToLock(validation.changes);
            const nextRevision = request.revisionNo + 1;
            await tx.run(UPDATE(ProfileChangeItems).set({ isCurrent: false }).where({ request_ID: request.ID, isCurrent: true }));
            await tx.run(INSERT.into(ProfileChangeItems).entries(validation.changes.map((change, index) => ({
                ID: cds.utils.uuid(), request_ID: request.ID, revisionNo: nextRevision, sequence: index + 1,
                fieldName: change.fieldName, fieldGroup: change.fieldGroup,
                oldValue: change.oldValue, newValue: change.newValue, oldValueHash: change.oldValueHash,
                isSensitive: change.isSensitive, mappingStatus: change.mappingStatus,
                sapInfotype: change.sapInfotype, sapSubtype: change.sapSubtype, sapField: change.sapField,
                isCurrent: true
            }))));
            await tx.run(DELETE.from(ProfileFieldLocks).where({ request_ID: request.ID }));
            await tx.run(INSERT.into(ProfileFieldLocks).entries(nextLockFields.map(fieldName => ({
                employeePernr: context.pernr,
                fieldName,
                request_ID: request.ID,
                acquiredAt: now()
            }))));
            const payloadHash = stableHash(validation.changes.map(change => [change.fieldName, change.newValue]));
            const changedRows = await tx.run(UPDATE(ProfileChangeRequests).set({
                status: STATUS.PENDING,
                version: request.version + 1,
                revisionNo: nextRevision,
                profileVersion: currentProfileVersion,
                payloadHash,
                lastResubmitKey: idempotencyKey,
                lastResubmitHash: inputHash,
                employeeRemark: String(req.data.Remark || '').trim().slice(0, 500),
                hrComment: null
            }).where({ ID: request.ID, version: request.version }));
            if (Number(changedRows) !== 1) {
                return reject(req, 409, 'STALE_VERSION', 'The request was changed by another user. Reload and retry.');
            }
            const updated = { ...request, status: STATUS.PENDING, version: request.version + 1, revisionNo: nextRevision };
            await writeEvent(tx, updated, 'RESUBMITTED', STATUS.REVISION, STATUS.PENDING, context, req.data.Remark);
            await writeOutbox(tx, updated, 'PROFILE_RESUBMITTED', 'HR', 'PROFILE_HR');
            return requestDto(updated);
        });
    });

    async function hrDecision(req, action) {
        requireAvailableAdapter(req);
        const context = userContext(req, true);
        const commentsRequired = action !== 'approve';
        const comment = String(req.data.HrComment || '').trim();
        if (commentsRequired && !comment) {
            return reject(req, 400, 'HR_COMMENT_REQUIRED', 'HR comment is required.', 'hrComment');
        }
        return db.run(async tx => {
            const request = await getRequest(tx, req.data.RequestId);
            if (!request) return reject(req, 404, 'REQUEST_NOT_FOUND', 'Profile request was not found.');
            if (!canTransition(request.status, action)) {
                return reject(req, 400, 'INVALID_STATE', `Action ${action} is not allowed for status ${request.status}.`);
            }
            assertVersion(req, request, req.data.ExpectedVersion);

            let snapshot;
            let changes;
            if (action === 'approve') {
                snapshot = await ensureSnapshot(tx, { ...context, pernr: request.employeePernr, name: request.employeeName });
                const items = await tx.run(SELECT.from(ProfileChangeItems).where({
                    request_ID: request.ID,
                    revisionNo: request.revisionNo,
                    isCurrent: true
                }));
                changes = {};
                items.forEach(item => {
                    const definition = FIELD_CATALOG[item.fieldName];
                    if (!definition) return;
                    const currentValueHash = stableHash(String(snapshot[definition.property] ?? '').trim());
                    if (currentValueHash !== item.oldValueHash) {
                        reject(req, 409, 'STALE_PROFILE_FIELD', `${item.fieldName} changed after submission. Request a new review cycle.`);
                    }
                    changes[definition.property] = item.newValue;
                });
                if (changes.bankKey === 'LOCAL-DEMO') {
                    changes.bankName = 'Local Demo Bank';
                }
                if (changes.paymentMethod === 'C' || changes.bankKey === '') {
                    changes.bankName = '';
                }
                changes.version = Number(snapshot.version || 0) + 1;
            }

            const nextStatus = action === 'requestChanges' ? STATUS.REVISION
                : action === 'reject' ? STATUS.REJECTED : STATUS.APPROVED;
            const applyState = action === 'approve' ? 'SIMULATED' : request.applyState;
            const changedRows = await tx.run(UPDATE(ProfileChangeRequests).set({
                status: nextStatus,
                version: request.version + 1,
                hrComment: comment,
                decisionBy: context.email,
                decisionAt: now(),
                applyState,
                applyMessage: action === 'approve' ? 'Applied to local DEV snapshot only.' : request.applyMessage,
                isSimulation: action === 'approve'
            }).where({ ID: request.ID, version: request.version, status: request.status }));
            if (Number(changedRows) !== 1) {
                return reject(req, 409, 'STALE_VERSION', 'The request was changed by another user. Reload and retry.');
            }

            if (action === 'approve') {
                const changedSnapshots = await tx.run(
                    UPDATE(ProfileSnapshots).set(changes).where({
                        employeePernr: request.employeePernr,
                        version: snapshot.version
                    })
                );
                if (Number(changedSnapshots) !== 1) {
                    return reject(req, 409, 'STALE_PROFILE', 'The employee profile changed during approval. Reload and retry.');
                }
            }

            if ([STATUS.APPROVED, STATUS.REJECTED].includes(nextStatus)) {
                await tx.run(DELETE.from(ProfileFieldLocks).where({ request_ID: request.ID }));
            }
            const updated = { ...request, status: nextStatus, version: request.version + 1, hrComment: comment, applyState, isSimulation: action === 'approve' };
            await writeEvent(tx, updated, action.toUpperCase(), request.status, nextStatus, context, comment);
            await writeOutbox(tx, updated, `PROFILE_${action.toUpperCase()}`, 'EMPLOYEE', request.employeePernr);
            return requestDto(updated);
        });
    }

    this.on('requestProfileChanges', req => hrDecision(req, 'requestChanges'));
    this.on('rejectProfileChange', req => hrDecision(req, 'reject'));
    this.on('approveProfileChange', req => hrDecision(req, 'approve'));
};
