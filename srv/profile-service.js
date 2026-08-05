const cds = require('@sap/cds');
const crypto = require('node:crypto');
const {
    STATUS,
    FIELD_CATALOG,
    stableHash,
    validateChangeSet,
    canTransition
} = require('./profile-domain');

const { SELECT, INSERT, UPDATE, DELETE } = cds.ql;

const REQUESTS = 'znxr09.db.ProfileChangeRequests';
const ITEMS = 'znxr09.db.ProfileChangeItems';
const LOCKS = 'znxr09.db.ProfileFieldLocks';
const EVENTS = 'znxr09.db.ProfileRequestEvents';

const DTO_PROPERTY_BY_FIELD = Object.freeze({
    ID_NUMBER: 'IdNumber',
    TELEPHONE: 'Telephone',
    ADDRESS: 'PermanentAddress',
    WORK_EMAIL: 'WorkEmail',
    CURR_ADDRESS: 'CurrentAddress',
    TAX_CODE: 'TaxCode',
    PAY_METHOD: 'PayMethod',
    BANK_COUNTRY: 'BankCountry',
    BANK_KEY: 'BankKey',
    BANK_ACCT: 'BankAccount'
});

const DEFAULT_PROFILE_DISPLAY_SERVICE = 'ZUI_NXR_PROFILE_O4';
const DEFAULT_PROFILE_DISPLAY_FALLBACK_SERVICE = 'ZUI_NXR_SKILLREQ_O4';

function reject(req, status, code, message) {
    return req.reject({ status, code, message });
}

function utcNow() {
    return new Date().toISOString();
}

function uuid() {
    return crypto.randomUUID();
}

function actorId(context) {
    return context.name || context.email || context.sapUserId || context.pernr || 'UNKNOWN';
}

function requestNumber() {
    return (`PR${Date.now().toString(36)}${uuid().replace(/-/g, '').slice(0, 8)}`)
        .toUpperCase()
        .slice(0, 24);
}

function normalizeRemark(value) {
    const remark = value === null || value === undefined ? '' : String(value).trim();
    return remark.slice(0, 500);
}

function changePayload(rawChanges) {
    return (rawChanges || []).map(change => ({
        fieldName: String(change?.fieldName || change?.FieldName || change?.FieldCode || '').trim().toUpperCase(),
        newValue: change?.newValue ?? change?.NewValue ?? ''
    }));
}

function domainProfile(profile) {
    return Object.fromEntries(Object.entries(FIELD_CATALOG).map(([fieldName, definition]) => [
        definition.property,
        profile?.[DTO_PROPERTY_BY_FIELD[fieldName]] || ''
    ]));
}

function profileRequestDto(row) {
    if (!row) return null;
    return {
        ID: row.ID,
        RequestNo: row.requestNo,
        Pernr: row.employeePernr,
        EmployeeName: row.employeeName,
        Status: row.status,
        Version: row.version,
        RevisionNo: row.revisionNo,
        Remark: row.employeeRemark,
        HrComment: row.hrComment,
        ApplyState: row.applyState,
        IsSimulation: row.isSimulation,
        SubmittedAt: row.createdAt,
        ModifiedAt: row.modifiedAt
    };
}

function profileItemDto(row) {
    if (!row) return null;
    return {
        ID: row.ID,
        RequestId: row.request_ID,
        Pernr: row.Pernr || row.employeePernr,
        Sequence: row.sequence,
        RevisionNo: row.revisionNo,
        FieldCode: row.fieldName,
        FieldGroup: row.fieldGroup,
        OldValue: row.oldValue,
        NewValue: row.newValue,
        IsSensitive: row.isSensitive === true || row.isSensitive === 1,
        MappingStatus: row.mappingStatus,
        IsCurrent: row.isCurrent === true || row.isCurrent === 1
    };
}

function profileEventDto(row) {
    if (!row) return null;
    return {
        ID: row.ID,
        RequestId: row.request_ID,
        RevisionNo: row.revisionNo,
        EventType: row.eventType,
        FromStatus: row.fromStatus,
        ToStatus: row.toStatus,
        ActorRole: row.actorRole,
        Comment: row.comment,
        CreatedAt: row.occurredAt
    };
}

function filterValue(where, name) {
    if (!Array.isArray(where)) return undefined;
    for (let index = 0; index < where.length; index += 1) {
        const token = where[index];
        if (Array.isArray(token?.xpr)) {
            const nested = filterValue(token.xpr, name);
            if (nested !== undefined) return nested;
        }
        const refName = token?.ref?.[token.ref.length - 1];
        if (refName === name && where[index + 1] === '=' && where[index + 2]?.val !== undefined) {
            return where[index + 2].val;
        }
    }
    return undefined;
}

function sortByCreatedDesc(rows) {
    return rows.sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')) ||
        String(left.ID || '').localeCompare(String(right.ID || '')));
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
        email: String(info.email || httpReq?.user?.emails?.[0]?.value || '').trim(),
        sapUserId: String(info.sapUserId || info.email || '').trim(),
        name: String(info.employeeName || info.name || '').trim(),
        isHrAdmin: info.isHrAdmin === true || req.user?.is?.('ProfileHRAdmin') === true
    };
    if (requireHr && !context.isHrAdmin) {
        reject(req, 403, 'PROFILE_HR_FORBIDDEN', 'HR profile permission is required.');
    }
    return context;
}

function profileDto(sapProfile, context) {
    const sapUserId = String(sapProfile.UserId || context.sapUserId || '').trim();
    const dto = {
        Pernr: String(sapProfile.Pernr || context.pernr),
        EmployeeName: sapProfile.EmployeeName || context.name,
        DateOfBirth: normalizeDate(sapProfile.DateOfBirth),
        Gender: sapProfile.Gender || '',
        Nationality: sapProfile.Nationality || '',
        MaritalStatus: sapProfile.MaritalStatus || '',
        PositionName: sapProfile.PositionName || sapProfile.PositionId || '',
        OrgUnitName: sapProfile.OrgUnitName || sapProfile.OrgUnitId || '',
        IdNumber: sapProfile.IdNumber || '',
        Telephone: sapProfile.Telephone || sapProfile.MobilePhone || '',
        PermanentAddress: sapProfile.PermanentAddress || '',
        WorkEmail: sapProfile.WorkEmail || (sapUserId.includes('@') ? sapUserId.toLowerCase() : ''),
        CurrentAddress: sapProfile.CurrentAddress || '',
        TaxCode: sapProfile.TaxCode || '',
        PayMethod: sapProfile.PayMethod || '',
        PayMethodText: sapProfile.PayMethodText || paymentMethodText(sapProfile.PayMethod),
        BankCountry: sapProfile.BankCountry || '',
        BankKey: sapProfile.BankKey || '',
        BankAccount: sapProfile.BankAccount || '',
        BankName: sapProfile.BankName || '',
        JoinDate: normalizeDate(sapProfile.JoinDate),
        ContractType: sapProfile.ContractType || '',
        DependentsSummary: sapProfile.DependentsSummary || '',
        IsSimulation: false
    };
    dto.ProfileVersion = stableHash(dto);
    return dto;
}

function fieldRows(profile, locks = []) {
    const lockByField = new Map(locks.map(lock => [lock.fieldName, lock]));
    return Object.entries(FIELD_CATALOG).map(([FieldCode, definition]) => {
        const value = profile[DTO_PROPERTY_BY_FIELD[FieldCode]] || '';
        const lock = lockByField.get(FieldCode);
        return {
            FieldCode,
            Value: value,
            DisplayValue: value,
            FieldGroup: definition.group,
            MaxLength: definition.maxLength,
            Editable: true,
            Mandatory: false,
            Sensitive: Boolean(definition.sensitive),
            Locked: Boolean(lock),
            LockRequestId: lock?.request_ID || null,
            LockStatus: lock?.status || '',
            MappingStatus: value ? 'CONFIRMED' : definition.mappingStatus
        };
    });
}

async function activeLocks(tx, pernr) {
    const [locks, requests] = await Promise.all([
        tx.run(SELECT.from(LOCKS).where({ employeePernr: pernr })),
        tx.run(SELECT.from(REQUESTS).where({ employeePernr: pernr }))
    ]);
    const statusByRequest = new Map(requests.map(request => [request.ID, request.status]));
    return locks.map(lock => ({
        ...lock,
        status: statusByRequest.get(lock.request_ID) || STATUS.PENDING
    }));
}

async function assertNoForeignLocks(req, tx, pernr, fieldNames, currentRequestId = '') {
    const locks = await activeLocks(tx, pernr);
    const locked = locks.find(lock => fieldNames.includes(lock.fieldName) && lock.request_ID !== currentRequestId);
    if (locked) {
        return reject(
            req,
            409,
            'PROFILE_FIELD_LOCKED',
            `Field ${locked.fieldName} already has a pending profile change request.`
        );
    }
}

async function insertEvent(tx, requestId, revisionNo, eventType, fromStatus, toStatus, context, role, comment, correlationId) {
    const now = utcNow();
    await tx.run(INSERT.into(EVENTS).entries({
        ID: uuid(),
        request_ID: requestId,
        revisionNo,
        eventType,
        fromStatus,
        toStatus,
        actorEmail: context.email,
        actorPernr: context.pernr,
        actorRole: role,
        comment: normalizeRemark(comment),
        correlationId: correlationId || uuid(),
        occurredAt: now
    }));
}

async function insertItemsAndLocks(tx, requestId, context, revisionNo, changes, now) {
    await tx.run(INSERT.into(ITEMS).entries(changes.map((change, index) => ({
        ID: uuid(),
        request_ID: requestId,
        revisionNo,
        sequence: index + 1,
        fieldName: change.fieldName,
        fieldGroup: change.fieldGroup,
        oldValue: change.oldValue,
        newValue: change.newValue,
        oldValueHash: change.oldValueHash,
        isSensitive: change.isSensitive,
        mappingStatus: change.mappingStatus,
        sapInfotype: change.sapInfotype,
        sapSubtype: change.sapSubtype,
        sapField: change.sapField,
        isCurrent: true,
        createdAt: now,
        createdBy: context.email,
        modifiedAt: now,
        modifiedBy: context.email
    }))));

    await tx.run(INSERT.into(LOCKS).entries(changes.map(change => ({
        employeePernr: context.pernr,
        fieldName: change.fieldName,
        request_ID: requestId,
        acquiredAt: now
    }))));
}

async function readRequest(tx, requestId) {
    return tx.run(SELECT.one.from(REQUESTS).where({ ID: requestId }));
}

function assertExpectedVersion(req, request, expectedVersion) {
    if (Number(expectedVersion) !== Number(request.version)) {
        return reject(req, 412, 'PROFILE_REQUEST_STALE', 'The profile request version is out of date.');
    }
}

async function currentItems(tx, requestId) {
    return tx.run(SELECT.from(ITEMS).where({ request_ID: requestId, isCurrent: true }));
}

async function releaseLocks(tx, requestId) {
    await tx.run(DELETE.from(LOCKS).where({ request_ID: requestId }));
}

function asBoolean(value) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') {
        return ['true', 'x', 'yes', '1'].includes(value.trim().toLowerCase());
    }
    return false;
}

function envBool(name, defaultValue = false) {
    const value = process.env[name];
    if (value === undefined || value === null || value === '') return defaultValue;
    return ['true', 'x', 'yes', 'y', '1'].includes(String(value).trim().toLowerCase());
}

function configuredServiceName(name, defaultValue) {
    return String(process.env[name] || defaultValue).trim();
}

function paymentMethodText(code) {
    switch (String(code || '').trim().toUpperCase()) {
        case 'C':
            return 'Cash';
        case 'T':
            return 'Bank Transfer';
        default:
            return '';
    }
}

function normalizeDate(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
    if (/^\d{8}$/.test(text)) {
        return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
    }
    return null;
}

function profileApplyPayload(request, items, context, comment) {
    return {
        RequestId: request.ID,
        RequestNo: request.requestNo || '',
        Pernr: request.employeePernr,
        EmployeeName: request.employeeName || '',
        RequestedByEmail: request.requestedByEmail || '',
        RevisionNo: Number(request.revisionNo || 1),
        DecisionBy: actorId(context),
        DecisionByEmail: context.email || '',
        DecisionPernr: context.pernr || '',
        HrComment: normalizeRemark(comment),
        Changes: (items || []).map(item => ({
            FieldCode: item.fieldName,
            FieldGroup: item.fieldGroup || '',
            OldValue: item.oldValue || '',
            NewValue: item.newValue || '',
            SapInfotype: item.sapInfotype || '',
            SapSubtype: item.sapSubtype || '',
            SapField: item.sapField || '',
            IsSensitive: asBoolean(item.isSensitive)
        }))
    };
}

function sapApplyErrorMessage(error) {
    const details = error?.response?.data?.error || error?.reason?.response?.data?.error;
    const message = details?.message?.value || details?.message || error?.message || 'SAP profile write failed.';
    return String(message).replace(/\s+/g, ' ').slice(0, 500);
}

function normalizeApplyResult(result) {
    const body = Array.isArray(result)
        ? result[0]
        : result?.value || result?.d || result || {};
    const hasAppliedFlag = Object.prototype.hasOwnProperty.call(body, 'Applied')
        || Object.prototype.hasOwnProperty.call(body, 'applied')
        || Object.prototype.hasOwnProperty.call(body, 'Success')
        || Object.prototype.hasOwnProperty.call(body, 'success');
    const applied = hasAppliedFlag
        ? asBoolean(body.Applied ?? body.applied ?? body.Success ?? body.success)
        : true;
    return {
        applied,
        message: String(body.Message || body.message || body.ApplyMessage || 'SAP profile changes were applied.').slice(0, 500)
    };
}

async function sendProfileApply(sapApply, payload) {
    const configuredPath = String(process.env.PROFILE_APPLY_ACTION_PATH || '').trim();
    if (configuredPath) {
        return sapApply.send({
            method: 'POST',
            path: configuredPath,
            data: payload
        });
    }
    return sapApply.send({
        event: 'applyProfileChanges',
        data: payload
    });
}

async function applyProfileChanges(req, request, items, context, comment) {
    const mode = String(process.env.PROFILE_APPLY_MODE || 'disabled').trim().toLowerCase();
    if (mode === 'mock' && process.env.NODE_ENV !== 'production') {
        return {
            applyState: 'APPLIED',
            applyMessage: 'Mock SAP profile apply completed in non-production mode.'
        };
    }
    if (mode === 'sap') {
        if (!items?.length) {
            return reject(req, 400, 'SAP_PROFILE_WRITE_EMPTY_PAYLOAD', 'There are no current profile changes to apply.');
        }

        let sapApply;
        const serviceName = String(process.env.PROFILE_APPLY_SERVICE || 'ZUI_NXR_PROFILE_APPLY_O4').trim();
        try {
            sapApply = await cds.connect.to(serviceName);
        } catch (error) {
            return reject(
                req,
                503,
                'SAP_PROFILE_WRITE_SERVICE_UNAVAILABLE',
                `SAP profile write service ${serviceName} is not available.`
            );
        }

        let result;
        try {
            result = await sendProfileApply(sapApply, profileApplyPayload(request, items, context, comment));
        } catch (error) {
            return reject(req, error.statusCode || error.status || 502, 'SAP_PROFILE_WRITE_FAILED', sapApplyErrorMessage(error));
        }

        const normalized = normalizeApplyResult(result);
        if (!normalized.applied) {
            return reject(req, 502, 'SAP_PROFILE_WRITE_REJECTED', normalized.message);
        }
        return {
            applyState: 'APPLIED',
            applyMessage: normalized.message
        };
    }
    return reject(
        req,
        501,
        'SAP_PROFILE_WRITE_NOT_AVAILABLE',
        'The SAP profile write adapter is not configured. The request remains pending and SAP data was not changed.'
    );
}

module.exports = async function ProfileService() {
    const profileDisplayServiceName = configuredServiceName('PROFILE_DISPLAY_SERVICE', DEFAULT_PROFILE_DISPLAY_SERVICE);
    const profileDisplayFallbackServiceName = configuredServiceName(
        'PROFILE_DISPLAY_FALLBACK_SERVICE',
        DEFAULT_PROFILE_DISPLAY_FALLBACK_SERVICE
    );
    const allowProfileDisplayFallback = envBool('PROFILE_DISPLAY_ALLOW_FALLBACK', true);

    async function connectProfileService(serviceName) {
        if (!serviceName) {
            return { serviceName, service: null, error: null };
        }
        try {
            return { serviceName, service: await cds.connect.to(serviceName), error: null };
        } catch (error) {
            return { serviceName, service: null, error };
        }
    }

    const profileDisplay = await connectProfileService(profileDisplayServiceName);
    const profileDisplayFallback = profileDisplayFallbackServiceName === profileDisplayServiceName
        ? profileDisplay
        : await connectProfileService(profileDisplayFallbackServiceName);

    function profileLookupCandidates(context) {
        return [...new Set([
            context.sapUserId,
            context.email,
            context.sapUserId?.toUpperCase(),
            context.email?.toUpperCase(),
            context.sapUserId?.toLowerCase(),
            context.email?.toLowerCase()
        ].filter(Boolean))];
    }

    async function findProfile(connection, context) {
        if (!connection.service) {
            if (connection.error) throw connection.error;
            return null;
        }

        for (const userId of profileLookupCandidates(context)) {
            const profile = await connection.service.run(SELECT.one.from('UserProfile').where({ UserId: userId }));
            if (profile) return profile;
        }
        if (context.pernr) {
            return connection.service.run(SELECT.one.from('UserProfile').where({ Pernr: context.pernr }));
        }
        return null;
    }

    async function readSapProfile(req, context) {
        let primaryError;
        let profile;
        try {
            profile = await findProfile(profileDisplay, context);
        } catch (error) {
            primaryError = error;
            if (!allowProfileDisplayFallback) {
                return reject(
                    req,
                    error.statusCode || error.status || 503,
                    'SAP_PROFILE_DISPLAY_SERVICE_UNAVAILABLE',
                    `SAP profile display service ${profileDisplay.serviceName} is not available.`
                );
            }
        }

        if (!profile && allowProfileDisplayFallback && profileDisplayFallback.serviceName) {
            try {
                profile = await findProfile(profileDisplayFallback, context);
            } catch (error) {
                const serviceName = primaryError
                    ? `${profileDisplay.serviceName} and ${profileDisplayFallback.serviceName}`
                    : profileDisplayFallback.serviceName;
                return reject(
                    req,
                    error.statusCode || error.status || 503,
                    'SAP_PROFILE_DISPLAY_SERVICE_UNAVAILABLE',
                    `SAP profile display service ${serviceName} is not available.`
                );
            }
        }

        if (!profile && primaryError) {
            return reject(
                req,
                primaryError.statusCode || primaryError.status || 503,
                'SAP_PROFILE_DISPLAY_SERVICE_UNAVAILABLE',
                `SAP profile display service ${profileDisplay.serviceName} is not available.`
            );
        }

        if (!profile) {
            return reject(req, 404, 'SAP_PROFILE_NOT_FOUND', 'No employee profile was found in SAP.');
        }
        if (String(profile.Pernr || '') !== context.pernr) {
            return reject(req, 403, 'SAP_PROFILE_IDENTITY_MISMATCH', 'The SAP employee profile does not match the authenticated identity.');
        }
        return profile;
    }

    async function currentProfile(req, existingContext) {
        const context = existingContext?.pernr ? existingContext : userContext(req);
        return profileDto(await readSapProfile(req, context), context);
    }

    this.on('READ', 'MyProfile', currentProfile);
    this.on('READ', 'MyProfileFields', async req => {
        const context = userContext(req);
        const tx = cds.tx(req);
        return fieldRows(await currentProfile(req, context), await activeLocks(tx, context.pernr));
    });

    this.on('READ', 'MyProfileRequests', async req => {
        const context = userContext(req);
        const tx = cds.tx(req);
        const rows = await tx.run(SELECT.from(REQUESTS).where({ employeePernr: context.pernr }));
        return sortByCreatedDesc(rows).map(profileRequestDto);
    });

    this.on('READ', 'ProfileApprovalRequests', async req => {
        userContext(req, true);
        const rows = await cds.tx(req).run(SELECT.from(REQUESTS));
        return sortByCreatedDesc(rows).map(profileRequestDto);
    });

    this.on('READ', ['MyProfileRequestItems', 'ProfileApprovalRequestItems'], async req => {
        const isApprovalRead = req.target.name.endsWith('ProfileApprovalRequestItems');
        const context = userContext(req, isApprovalRead);
        const tx = cds.tx(req);
        const requestId = filterValue(req.query?.SELECT?.where, 'RequestId');
        const isCurrent = filterValue(req.query?.SELECT?.where, 'IsCurrent');
        const allRequests = await tx.run(SELECT.from(REQUESTS));
        const visibleRequests = allRequests.filter(request =>
            isApprovalRead || request.employeePernr === context.pernr
        );
        const visibleRequestIds = new Set(visibleRequests.map(request => request.ID));
        let rows = await tx.run(SELECT.from(ITEMS));
        rows = rows.filter(row => visibleRequestIds.has(row.request_ID));
        if (requestId) rows = rows.filter(row => row.request_ID === requestId);
        if (isCurrent !== undefined) {
            rows = rows.filter(row => Boolean(row.isCurrent) === Boolean(isCurrent));
        }
        const pernrByRequest = new Map(visibleRequests.map(request => [request.ID, request.employeePernr]));
        return rows
            .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0))
            .map(row => profileItemDto({ ...row, Pernr: pernrByRequest.get(row.request_ID) }));
    });

    this.on('READ', 'ProfileRequestEvents', async req => {
        userContext(req, true);
        const requestId = filterValue(req.query?.SELECT?.where, 'RequestId');
        let rows = await cds.tx(req).run(SELECT.from(EVENTS));
        if (requestId) rows = rows.filter(row => row.request_ID === requestId);
        return rows
            .sort((left, right) => String(right.occurredAt || '').localeCompare(String(left.occurredAt || '')))
            .map(profileEventDto);
    });

    this.on('READ', 'ProfilePaymentMethods', () => [
        { Code: 'C', Text: 'Cash', Category: 'CASH', IsBankTransfer: false },
        { Code: 'T', Text: 'Bank Transfer', Category: 'BANK', IsBankTransfer: true }
    ]);
    this.on('READ', 'ProfileBanks', () => []);

    this.on('submitProfileChange', async req => {
        const context = userContext(req);
        const tx = cds.tx(req);
        const profile = await currentProfile(req, context);
        if (req.data.ProfileVersion && req.data.ProfileVersion !== profile.ProfileVersion) {
            return reject(req, 412, 'PROFILE_VERSION_STALE', 'The displayed SAP profile is out of date.');
        }

        const validation = validateChangeSet(domainProfile(profile), changePayload(req.data.Changes));
        if (validation.errors.length) {
            return reject(req, 400, 'PROFILE_CHANGE_INVALID', validation.errors[0].message);
        }

        const idempotencyKey = String(req.data.IdempotencyKey || '').trim() || uuid();
        const payloadHash = stableHash({
            profileVersion: req.data.ProfileVersion || profile.ProfileVersion,
            remark: normalizeRemark(req.data.Remark),
            changes: validation.changes.map(change => [change.fieldName, change.newValue])
        });
        const duplicate = await tx.run(SELECT.one.from(REQUESTS).where({
            employeePernr: context.pernr,
            idempotencyKey
        }));
        if (duplicate) {
            if (duplicate.payloadHash !== payloadHash) {
                return reject(req, 409, 'PROFILE_IDEMPOTENCY_CONFLICT', 'The same idempotency key was used for a different profile payload.');
            }
            return profileRequestDto(duplicate);
        }

        await assertNoForeignLocks(req, tx, context.pernr, validation.changes.map(change => change.fieldName));

        const now = utcNow();
        const requestId = uuid();
        await tx.run(INSERT.into(REQUESTS).entries({
            ID: requestId,
            requestNo: requestNumber(),
            employeePernr: context.pernr,
            employeeName: profile.EmployeeName,
            requestedByEmail: context.email,
            status: STATUS.PENDING,
            version: 1,
            revisionNo: 1,
            profileVersion: req.data.ProfileVersion || profile.ProfileVersion,
            idempotencyKey,
            payloadHash,
            employeeRemark: normalizeRemark(req.data.Remark),
            applyState: 'NOT_APPLIED',
            isSimulation: false,
            createdAt: now,
            createdBy: context.email,
            modifiedAt: now,
            modifiedBy: context.email
        }));
        await insertItemsAndLocks(tx, requestId, context, 1, validation.changes, now);
        await insertEvent(tx, requestId, 1, 'SUBMITTED', null, STATUS.PENDING, context, 'EMPLOYEE', req.data.Remark, idempotencyKey);

        return profileRequestDto(await readRequest(tx, requestId));
    });

    this.on('resubmitProfileChange', async req => {
        const context = userContext(req);
        const tx = cds.tx(req);
        const requestId = req.data.RequestId;
        const request = await readRequest(tx, requestId);
        if (!request || request.employeePernr !== context.pernr) {
            return reject(req, 404, 'PROFILE_REQUEST_NOT_FOUND', 'The profile request was not found.');
        }
        assertExpectedVersion(req, request, req.data.ExpectedVersion);
        if (!canTransition(request.status, 'resubmit')) {
            return reject(req, 409, 'PROFILE_REQUEST_INVALID_STATE', 'Only revision-required requests can be resubmitted.');
        }

        const profile = await currentProfile(req, context);
        if (req.data.ProfileVersion && req.data.ProfileVersion !== profile.ProfileVersion) {
            return reject(req, 412, 'PROFILE_VERSION_STALE', 'The displayed SAP profile is out of date.');
        }
        const validation = validateChangeSet(domainProfile(profile), changePayload(req.data.Changes));
        if (validation.errors.length) {
            return reject(req, 400, 'PROFILE_CHANGE_INVALID', validation.errors[0].message);
        }

        const idempotencyKey = String(req.data.IdempotencyKey || '').trim() || uuid();
        const payloadHash = stableHash({
            profileVersion: req.data.ProfileVersion || profile.ProfileVersion,
            remark: normalizeRemark(req.data.Remark),
            changes: validation.changes.map(change => [change.fieldName, change.newValue])
        });
        if (request.lastResubmitKey === idempotencyKey) {
            if (request.lastResubmitHash !== payloadHash) {
                return reject(req, 409, 'PROFILE_IDEMPOTENCY_CONFLICT', 'The same idempotency key was used for a different profile payload.');
            }
            return profileRequestDto(request);
        }

        await releaseLocks(tx, requestId);
        await assertNoForeignLocks(req, tx, context.pernr, validation.changes.map(change => change.fieldName), requestId);
        await tx.run(UPDATE(ITEMS).set({ isCurrent: false, modifiedAt: utcNow(), modifiedBy: context.email }).where({ request_ID: requestId }));

        const now = utcNow();
        const revisionNo = Number(request.revisionNo || 1) + 1;
        await tx.run(UPDATE(REQUESTS).set({
            status: STATUS.PENDING,
            version: Number(request.version || 1) + 1,
            revisionNo,
            profileVersion: req.data.ProfileVersion || profile.ProfileVersion,
            lastResubmitKey: idempotencyKey,
            lastResubmitHash: payloadHash,
            employeeRemark: normalizeRemark(req.data.Remark),
            hrComment: '',
            decisionBy: '',
            decisionAt: null,
            modifiedAt: now,
            modifiedBy: context.email
        }).where({ ID: requestId }));
        await insertItemsAndLocks(tx, requestId, context, revisionNo, validation.changes, now);
        await insertEvent(tx, requestId, revisionNo, 'RESUBMITTED', STATUS.REVISION, STATUS.PENDING, context, 'EMPLOYEE', req.data.Remark, idempotencyKey);

        return profileRequestDto(await readRequest(tx, requestId));
    });

    async function decide(req, action, toStatus, eventType, commentRequired = false) {
        const context = userContext(req, true);
        const tx = cds.tx(req);
        const request = await readRequest(tx, req.data.RequestId);
        if (!request) {
            return reject(req, 404, 'PROFILE_REQUEST_NOT_FOUND', 'The profile request was not found.');
        }
        assertExpectedVersion(req, request, req.data.ExpectedVersion);
        if (!canTransition(request.status, action)) {
            return reject(req, 409, 'PROFILE_REQUEST_INVALID_STATE', 'The profile request is not in a pending state.');
        }
        const comment = normalizeRemark(req.data.HrComment);
        if (commentRequired && !comment) {
            return reject(req, 400, 'PROFILE_HR_COMMENT_REQUIRED', 'An HR comment is required.');
        }

        let applyResult = { applyState: request.applyState || 'NOT_APPLIED', applyMessage: request.applyMessage || '' };
        if (action === 'approve') {
            const items = await currentItems(tx, request.ID);
            applyResult = await applyProfileChanges(req, request, items, context, comment);
        }

        const now = utcNow();
        await tx.run(UPDATE(REQUESTS).set({
            status: toStatus,
            version: Number(request.version || 1) + 1,
            hrComment: comment,
            decisionBy: actorId(context),
            decisionAt: now,
            applyState: applyResult.applyState,
            applyMessage: applyResult.applyMessage,
            modifiedAt: now,
            modifiedBy: context.email
        }).where({ ID: request.ID }));
        if (toStatus === STATUS.APPROVED || toStatus === STATUS.REJECTED) {
            await releaseLocks(tx, request.ID);
        }
        await insertEvent(tx, request.ID, request.revisionNo, eventType, request.status, toStatus, context, 'HR', comment, uuid());
        return profileRequestDto(await readRequest(tx, request.ID));
    }

    this.on('requestProfileChanges', req => decide(req, 'requestChanges', STATUS.REVISION, 'REVISION_REQUESTED', true));
    this.on('rejectProfileChange', req => decide(req, 'reject', STATUS.REJECTED, 'REJECTED', true));
    this.on('approveProfileChange', req => decide(req, 'approve', STATUS.APPROVED, 'APPROVED', false));
};
