const cds = require('@sap/cds');
const crypto = require('node:crypto');
const https = require('node:https');
const axios = require('axios');
require('dotenv').config();
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
const OUTBOX = 'znxr09.db.ProfileNotificationOutbox';

const DTO_PROPERTY_BY_FIELD = Object.freeze({
    TELEPHONE: 'Telephone',
    ADDRESS: 'PermanentAddress',
    WORK_EMAIL: 'WorkEmail',
    CURR_ADDRESS: 'CurrentAddress',
    MARITAL_STATUS: 'MaritalStatusCode',
    PAY_METHOD: 'PayMethod',
    BANK_COUNTRY: 'BankCountry',
    BANK_KEY: 'BankKey',
    BANK_ACCT: 'BankAccount'
});

const DEFAULT_PROFILE_DISPLAY_SERVICE = 'ZUI_NXR_PROFILE_O4';
const DEFAULT_PROFILE_DISPLAY_FALLBACK_SERVICE = 'ZUI_NXR_SKILLREQ_O4';
const allowInsecureSapTls = process.env.NODE_ENV !== 'production'
    && process.env.ALLOW_INSECURE_SAP_TLS === 'true';
const sapHttpsAgent = new https.Agent({ rejectUnauthorized: !allowInsecureSapTls });

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
        ApplyMessage: row.applyMessage,
        IsSimulation: row.isSimulation,
        SubmittedAt: row.createdAt,
        ModifiedAt: row.modifiedAt
    };
}

function sapDateTimeToIso(value) {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();

    const raw = String(value).trim();
    const odataDateMatch = raw.match(/^\/Date\((-?\d+)(?:[+-]\d+)?\)\/$/);
    if (odataDateMatch) {
        const timestamp = Number(odataDateMatch[1]);
        if (Number.isFinite(timestamp)) {
            return new Date(timestamp).toISOString();
        }
    }

    const parsedTimestamp = Date.parse(raw);
    if (Number.isFinite(parsedTimestamp)) {
        return new Date(parsedTimestamp).toISOString();
    }
    return raw;
}

function sapProfileRequestDto(row) {
    if (!row) return null;
    const requestId = row.RequestId || row.requestId || row.ID || row.Id || '';
    const requestNo = row.RequestNo || row.requestNo || '';
    const submittedAt = sapDateTimeToIso(row.CreatedAt || row.SubmittedAt || row.createdAt || row.submittedAt);
    const modifiedAt = sapDateTimeToIso(
        row.LastChangedAt || row.ModifiedAt || row.LocalLastChangedAt ||
        row.lastChangedAt || row.modifiedAt || row.localLastChangedAt || submittedAt
    );

    return {
        ID: String(requestId || requestNo || '').replace(/[{}]/g, ''),
        RequestNo: requestNo,
        Pernr: row.Pernr || row.pernr || '',
        EmployeeName: row.EmployeeName || row.employeeName || '',
        Status: row.Status || row.status || '',
        Version: 1,
        RevisionNo: Number(row.RevisionNo || row.revisionNo || 1),
        Remark: row.Remark || row.EmployeeRemark || row.employeeRemark || '',
        HrComment: row.HrComment || row.hrComment || '',
        ApplyState: row.ApplyState || row.applyState || '',
        ApplyMessage: row.ApplyMessage || row.applyMessage || '',
        IsSimulation: false,
        SubmittedAt: submittedAt,
        ModifiedAt: modifiedAt
    };
}

function sortProfileRequestDtos(rows) {
    return rows.sort((left, right) =>
        String(right.SubmittedAt || '').localeCompare(String(left.SubmittedAt || '')) ||
        String(right.ModifiedAt || '').localeCompare(String(left.ModifiedAt || '')) ||
        String(left.RequestNo || left.ID || '').localeCompare(String(right.RequestNo || right.ID || ''))
    );
}

function mergeProfileRequestDtos(localRows, sapRows) {
    const byKey = new Map();
    for (const row of sapRows || []) {
        if (!row) continue;
        const key = String(row.RequestNo || row.ID || '').trim();
        if (key) byKey.set(key, row);
    }
    for (const row of localRows || []) {
        if (!row) continue;
        const key = String(row.RequestNo || row.ID || '').trim();
        if (key) {
            byKey.set(key, { ...byKey.get(key), ...row });
        } else {
            byKey.set(`LOCAL:${byKey.size}`, row);
        }
    }
    return Array.from(byKey.values());
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

function sapProfileItemDtos(row) {
    if (!row) return [];
    const requestId = String(row.RequestId || row.requestId || row.ID || row.Id || row.RequestNo || '')
        .replace(/[{}]/g, '')
        .trim();
    if (!requestId) return [];

    const revisionNo = Number(row.RevisionNo || row.revisionNo || 1);
    const changedFields = String(row.ChangedFields || row.changedFields || '')
        .split(',')
        .map(field => field.trim().toUpperCase())
        .filter(field => FIELD_CATALOG[field]);
    const fallbackFields = Object.keys(DTO_PROPERTY_BY_FIELD).filter(fieldCode => {
        const dtoProperty = DTO_PROPERTY_BY_FIELD[fieldCode];
        const value = row[dtoProperty] ?? row[dtoProperty.charAt(0).toLowerCase() + dtoProperty.slice(1)];
        return value !== undefined && value !== null && String(value).trim() !== '';
    });
    const fieldCodes = [...new Set(changedFields.length ? changedFields : fallbackFields)];

    return fieldCodes.map((fieldCode, index) => {
        const definition = FIELD_CATALOG[fieldCode];
        const dtoProperty = DTO_PROPERTY_BY_FIELD[fieldCode];
        const newValue = row[dtoProperty] ?? row[dtoProperty.charAt(0).toLowerCase() + dtoProperty.slice(1)] ?? '';
        return {
            ID: `${requestId}:${revisionNo}:${index + 1}:${fieldCode}`,
            RequestId: requestId,
            Pernr: row.Pernr || row.pernr || '',
            Sequence: index + 1,
            RevisionNo: revisionNo,
            FieldCode: fieldCode,
            FieldGroup: definition.group,
            OldValue: '',
            NewValue: String(newValue),
            IsSensitive: Boolean(definition.sensitive),
            MappingStatus: definition.mappingStatus,
            IsCurrent: true
        };
    });
}

function sapProfileApplyRequest(row) {
    const dto = sapProfileRequestDto(row);
    return {
        ID: dto.ID,
        requestNo: dto.RequestNo,
        employeePernr: dto.Pernr,
        employeeName: dto.EmployeeName,
        requestedByEmail: row.RequestedByEmail || row.requestedByEmail || '',
        status: dto.Status,
        version: Number(row.Version || row.version || 1),
        revisionNo: dto.RevisionNo,
        employeeRemark: dto.Remark,
        hrComment: dto.HrComment,
        applyState: dto.ApplyState,
        applyMessage: dto.ApplyMessage,
        payMethod: row.PayMethod || row.payMethod || '',
        createdAt: dto.SubmittedAt,
        modifiedAt: dto.ModifiedAt
    };
}

function sapProfileApplyItems(row) {
    return sapProfileItemDtos(row).map(item => {
        const definition = FIELD_CATALOG[item.FieldCode] || {};
        return {
            fieldName: item.FieldCode,
            fieldGroup: item.FieldGroup,
            oldValue: item.OldValue,
            newValue: item.NewValue,
            oldValueHash: stableHash(item.OldValue || ''),
            isSensitive: item.IsSensitive,
            mappingStatus: item.MappingStatus,
            sapInfotype: definition.sapInfotype || '',
            sapSubtype: definition.sapSubtype || '',
            sapField: definition.sapField || ''
        };
    });
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
    const maritalLabel = String(sapProfile.MaritalStatus || '').trim();
    const maritalStatusCode = String(sapProfile.MaritalStatusCode || '').trim() || ({
        'Single': '0',
        'Married': '1',
        'Widowed': '2',
        'Divorced': '3'
    }[maritalLabel] || '');
    const dto = {
        Pernr: String(sapProfile.Pernr || context.pernr),
        EmployeeName: sapProfile.EmployeeName || context.name,
        DateOfBirth: normalizeDate(sapProfile.DateOfBirth),
        Gender: sapProfile.Gender || '',
        Nationality: sapProfile.Nationality || '',
        MaritalStatus: maritalLabel,
        MaritalStatusCode: maritalStatusCode,
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

function ensureRemoteServiceCredentials(serviceName, service) {
    const username = process.env.UI5_USERNAME;
    const password = process.env.UI5_PASSWORD;
    const credentialTargets = [
        cds.env.requires?.[serviceName]?.credentials,
        service?.options?.credentials,
        service?.credentials
    ].filter(Boolean);
    for (const credentials of credentialTargets) {
        // package.json may contain ${UI5_USERNAME}/${UI5_PASSWORD} placeholders.
        // Those placeholders are truthy before dotenv/CDS resolves them, so
        // only filling missing properties leaves the remote client without a
        // usable BasicAuthentication header. Always prefer the runtime
        // credentials supplied by the deployment environment.
        if (username) {
            credentials.username = username;
        }
        if (password) {
            credentials.password = password;
        }
    }
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

function profileApplyStagingPayload(request, items, context, comment, options = {}) {
    const status = String(options.status || STATUS.APPROVED).slice(0, 2);
    const isPendingApproval = status === STATUS.PENDING;
    const payload = {
        RequestNo: request.requestNo || '',
        Pernr: request.employeePernr,
        EmployeeName: request.employeeName || '',
        RequestedByEmail: request.requestedByEmail || '',
        RevisionNo: Number(request.revisionNo || 1),
        Status: status,
        ApplyState: String(options.applyState || 'QUEUED').slice(0, 20),
        ApplyMessage: String(options.applyMessage || 'Queued for HR master data background job').slice(0, 500),
        ChangedFields: (items || []).map(item => item.fieldName).filter(Boolean).join(',').slice(0, 255),
        DecisionBy: isPendingApproval ? '' : actorId(context),
        DecisionByEmail: isPendingApproval ? '' : (context.email || ''),
        DecisionPernr: isPendingApproval ? '' : (context.pernr || ''),
        DecisionAt: isPendingApproval ? null : new Date().toISOString(),
        HrComment: isPendingApproval ? '' : normalizeRemark(comment)
    };

    const valueByField = new Map((items || []).map(item => [item.fieldName, item.newValue || '']));
    Object.entries(DTO_PROPERTY_BY_FIELD).forEach(([fieldCode, dtoProperty]) => {
        if (fieldCode === 'PAY_METHOD') {
            payload[dtoProperty] = valueByField.get(fieldCode) || request.payMethod || '';
            return;
        }
        if (valueByField.has(fieldCode)) {
            payload[dtoProperty] = valueByField.get(fieldCode);
        }
    });
    return payload;
}

function sapApplyErrorMessage(error) {
    const details = error?.response?.data?.error || error?.reason?.response?.data?.error;
    const message = details?.message?.value || details?.message || error?.message || 'SAP profile write failed.';
    return String(message).replace(/\s+/g, ' ').slice(0, 500);
}

function sapApplyErrorStatus(error) {
    return Number(
        error?.statusCode ||
        error?.status ||
        error?.response?.status ||
        error?.reason?.statusCode ||
        error?.reason?.status ||
        error?.reason?.response?.status
    ) || 0;
}

function safeRemoteErrorDiagnostic(error) {
    const details = error?.response?.data?.error ||
        error?.reason?.response?.data?.error ||
        error?.cause?.response?.data?.error;
    const rawMessage = details?.message?.value ||
        details?.message ||
        error?.reason?.message ||
        error?.cause?.message ||
        error?.message ||
        'Remote SAP request failed.';
    const message = String(rawMessage)
        .replace(/\b(Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
        .replace(/\b(authorization|password|passwd|pwd|token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
        .replace(/\s+/g, ' ')
        .slice(0, 500);
    const code = String(
        details?.code ||
        error?.code ||
        error?.reason?.code ||
        error?.cause?.code ||
        ''
    ).slice(0, 100);

    return {
        status: sapApplyErrorStatus(error) || 503,
        code,
        message
    };
}

function requestCorrelationId(req) {
    return String(
        req?.context?.id ||
        req?.http?.req?.headers?.['x-correlation-id'] ||
        cds.context?.id ||
        'unavailable'
    ).slice(0, 128);
}

function normalizeApplyResult(result, defaults = {}) {
    const body = Array.isArray(result)
        ? result[0]
        : result?.value || result?.d || result || {};
    const defaultState = String(defaults.applyState || 'QUEUED').slice(0, 20);
    const defaultMessage = String(defaults.message || 'SAP profile change request was staged for background processing.')
        .slice(0, 500);
    const hasAppliedFlag = Object.prototype.hasOwnProperty.call(body, 'Applied')
        || Object.prototype.hasOwnProperty.call(body, 'applied')
        || Object.prototype.hasOwnProperty.call(body, 'Success')
        || Object.prototype.hasOwnProperty.call(body, 'success');
    const applied = hasAppliedFlag
        ? asBoolean(body.Applied ?? body.applied ?? body.Success ?? body.success)
        : true;
    const explicitState = String(body.ApplyState || body.applyState || body.State || body.state || '').trim();
    return {
        applied,
        applyState: (explicitState || (applied ? defaultState : 'REJECTED')).slice(0, 20),
        message: String(
            body.Message ||
            body.message ||
            body.ApplyMessage ||
            defaultMessage
        ).slice(0, 500)
    };
}

function profileApplyEntityPath() {
    return String(process.env.PROFILE_APPLY_ENTITY_PATH || '/ProfileApplyRequest').trim() || '/ProfileApplyRequest';
}

function profileApplyActionPathConfigured() {
    return Boolean(String(process.env.PROFILE_APPLY_ACTION_PATH || '').trim());
}

function profileApplyStrategy() {
    return String(process.env.PROFILE_APPLY_STRATEGY || 'create').trim().toLowerCase();
}

function odataStringLiteral(value) {
    return `'${String(value || '').replace(/'/g, "''")}'`;
}

function remoteRows(result) {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.value)) return result.value;
    if (Array.isArray(result?.d?.results)) return result.d.results;
    if (Array.isArray(result?.results)) return result.results;
    if (result?.d && typeof result.d === 'object') return [result.d];
    return result && typeof result === 'object' ? [result] : [];
}

function profileApplyKeyPath(entityPath, row) {
    const rawId = String(row?.RequestId || row?.requestId || row?.ID || '').replace(/[{}]/g, '').trim();
    if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(rawId)) {
        const error = new Error('SAP profile staging row does not expose a valid RequestId key.');
        error.statusCode = 502;
        throw error;
    }
    return `${entityPath}(guid'${rawId.toLowerCase()}')`;
}

async function readSapProfileApplyByRequestNo(sapApply, requestNo) {
    const entityPath = profileApplyEntityPath();
    const filter = encodeURIComponent(`RequestNo eq ${odataStringLiteral(requestNo)}`);
    const result = await sapApply.send({
        method: 'GET',
        path: `${entityPath}?%24filter=${filter}&%24top=1`
    });
    return remoteRows(result)[0] || null;
}

async function readSapProfileApplyByRequestId(sapApply, requestId) {
    const entityPath = profileApplyEntityPath();
    const normalizedRequestId = String(requestId || '').replace(/[{}]/g, '').trim();
    if (!normalizedRequestId) return null;

    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(normalizedRequestId)) {
        try {
            const result = await sapApply.send({
                method: 'GET',
                path: `${entityPath}(guid'${normalizedRequestId.toLowerCase()}')`
            });
            const row = remoteRows(result)[0];
            if (row) return row;
        } catch (error) {
            if (sapApplyErrorStatus(error) && sapApplyErrorStatus(error) !== 404) {
                throw error;
            }
        }
    }

    const result = await sapApply.send({
        method: 'GET',
        path: `${entityPath}?%24top=200`
    });
    return remoteRows(result).find(row => {
        const sapRequestId = String(row.RequestId || row.requestId || row.ID || row.Id || '')
            .replace(/[{}]/g, '')
            .trim();
        const sapRequestNo = String(row.RequestNo || row.requestNo || '').trim();
        return sapRequestId === normalizedRequestId || sapRequestNo === normalizedRequestId;
    }) || null;
}

async function readSapProfileApplyRows(req, context = {}, options = {}) {
    const mode = String(process.env.PROFILE_APPLY_MODE || 'disabled').trim().toLowerCase();
    if (mode !== 'sap') return [];
    if (profileApplyActionPathConfigured() || profileApplyStrategy() === 'action') return [];

    try {
        const sapApply = await connectProfileApplyService(req);
        const entityPath = profileApplyEntityPath();
        const requestedTop = Number(options.top || 100);
        const top = Number.isFinite(requestedTop) ? Math.max(1, Math.min(requestedTop, 500)) : 100;
        const filters = [];
        if (!options.allEmployees && context.pernr) {
            filters.push(`Pernr eq ${odataStringLiteral(context.pernr)}`);
        }
        const query = filters.length
            ? `?%24filter=${encodeURIComponent(filters.join(' and '))}&%24top=${top}`
            : `?%24top=${top}`;
        const result = await sapApply.send({
            method: 'GET',
            path: `${entityPath}${query}`
        });
        return remoteRows(result);
    } catch (error) {
        console.warn('[ProfileService] SAP profile request history read failed:', sapApplyErrorMessage(error));
        return [];
    }
}

async function readSapProfileApplyHistory(req, context, options = {}) {
    const rows = await readSapProfileApplyRows(req, context, options);
    return rows
        .map(sapProfileRequestDto)
        .filter(row => row && row.ID)
        .filter(row => options.allEmployees || !context?.pernr || !row.Pernr || row.Pernr === context.pernr);
}

async function connectProfileApplyService(req) {
    const serviceName = String(process.env.PROFILE_APPLY_SERVICE || 'ZUI_NXR_PROFILE_APPLY_O4').trim();
    if (shouldUseManualProfileApplyClient(serviceName)) {
        try {
            return createManualProfileApplyClient(serviceName);
        } catch (error) {
            return reject(
                req,
                503,
                'SAP_PROFILE_WRITE_SERVICE_UNAVAILABLE',
                error.message || `SAP profile write service ${serviceName} is not available.`
            );
        }
    }

    try {
        ensureRemoteServiceCredentials(serviceName);
        const sapApply = await cds.connect.to(serviceName);
        ensureRemoteServiceCredentials(serviceName, sapApply);
        return sapApply;
    } catch (error) {
        return reject(
            req,
            503,
            'SAP_PROFILE_WRITE_SERVICE_UNAVAILABLE',
            `SAP profile write service ${serviceName} is not available.`
        );
    }
}

function shouldUseManualProfileApplyClient(serviceName) {
    const explicitClient = String(process.env.PROFILE_APPLY_HTTP_CLIENT || 'auto').trim().toLowerCase();
    if (explicitClient === 'cap') return false;
    if (explicitClient === 'manual') return true;
    if (profileApplyActionPathConfigured() || profileApplyStrategy() === 'action') return false;

    const serviceConfig = cds.env.requires?.[serviceName] || {};
    const kind = String(serviceConfig.kind || '').toLowerCase();
    const url = String(serviceConfig.credentials?.url || '').toLowerCase();
    return kind === 'odata-v2' || url.includes('/sap/opu/odata/sap/');
}

function profileApplyConnectionConfig(serviceName) {
    ensureRemoteServiceCredentials(serviceName);
    const serviceConfig = cds.env.requires?.[serviceName] || {};
    const credentials = serviceConfig.credentials || {};
    const username = credentials.username || process.env.UI5_USERNAME;
    const password = credentials.password || process.env.UI5_PASSWORD;
    const url = String(credentials.url || '').trim();
    if (!url) {
        throw new Error(`SAP profile write service ${serviceName} has no remote URL.`);
    }
    if (!username || !password) {
        throw new Error(`SAP profile write service ${serviceName} is missing UI5 credentials.`);
    }
    return {
        url,
        queries: {
            ...(credentials.queryParameters || {}),
            ...(credentials.queries || {})
        },
        authHeader: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
    };
}

function profileApplyAbsoluteUrl(config, path = '/') {
    const normalizedBase = `${String(config.url || '').replace(/\/+$/, '')}/`;
    const normalizedPath = String(path || '/').replace(/^\/+/, '');
    const url = new URL(normalizedPath, normalizedBase);
    Object.entries(config.queries || {}).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '' && !url.searchParams.has(key)) {
            url.searchParams.set(key, String(value));
        }
    });
    return url.toString();
}

function cookieHeader(setCookie) {
    return (Array.isArray(setCookie) ? setCookie : [setCookie])
        .filter(Boolean)
        .map(cookie => String(cookie).split(';')[0])
        .join('; ');
}

async function fetchProfileApplyCsrf(config) {
    const response = await axios.get(profileApplyAbsoluteUrl(config, '/'), {
        headers: {
            Authorization: config.authHeader,
            'x-csrf-token': 'Fetch',
            Accept: 'application/json'
        },
        httpsAgent: sapHttpsAgent
    });
    const token = response.headers['x-csrf-token'];
    if (!token) {
        const error = new Error('SAP profile write service did not return a CSRF token.');
        error.statusCode = 403;
        throw error;
    }
    return {
        token,
        cookie: cookieHeader(response.headers['set-cookie'])
    };
}

function createManualProfileApplyClient(serviceName) {
    const config = profileApplyConnectionConfig(serviceName);
    return {
        send: async request => {
            const method = String(request.method || 'GET').trim().toUpperCase();
            const path = request.path || '/';
            const url = profileApplyAbsoluteUrl(config, path);
            const baseHeaders = {
                Authorization: config.authHeader,
                Accept: 'application/json'
            };

            if (method === 'GET') {
                const response = await axios.get(url, {
                    headers: baseHeaders,
                    httpsAgent: sapHttpsAgent
                });
                return response.data;
            }

            const csrf = await fetchProfileApplyCsrf(config);
            const response = await axios({
                method,
                url,
                data: request.data,
                headers: {
                    ...baseHeaders,
                    'x-csrf-token': csrf.token,
                    'Content-Type': 'application/json',
                    ...(csrf.cookie ? { Cookie: csrf.cookie } : {}),
                    ...(method === 'MERGE' || method === 'PATCH' || method === 'PUT' ? { 'If-Match': '*' } : {})
                },
                httpsAgent: sapHttpsAgent
            });
            return response.data;
        }
    };
}

async function sendProfileApplyCreate(sapApply, actionPayload, stagingPayload) {
    const configuredPath = String(process.env.PROFILE_APPLY_ACTION_PATH || '').trim();
    if (configuredPath) {
        return sapApply.send({
            method: 'POST',
            path: configuredPath,
            data: actionPayload
        });
    }

    if (profileApplyStrategy() === 'action') {
        return sapApply.send({
            event: 'applyProfileChanges',
            data: actionPayload
        });
    }

    return sapApply.send({
        method: 'POST',
        path: profileApplyEntityPath(),
        data: stagingPayload
    });
}

async function sendProfileApplyUpdateByRequestNo(sapApply, requestNo, stagingPayload) {
    const remoteRow = await readSapProfileApplyByRequestNo(sapApply, requestNo);
    if (!remoteRow) {
        const error = new Error(`SAP profile staging request ${requestNo} was not found.`);
        error.statusCode = 404;
        throw error;
    }
    return sendProfileApplyUpdateByRemoteRow(sapApply, remoteRow, stagingPayload);
}

async function sendProfileApplyUpdateByRemoteRow(sapApply, remoteRow, stagingPayload) {
    const entityPath = profileApplyEntityPath();
    return sapApply.send({
        method: String(process.env.PROFILE_APPLY_UPDATE_METHOD || 'MERGE').trim().toUpperCase(),
        path: profileApplyKeyPath(entityPath, remoteRow),
        data: stagingPayload
    });
}

async function stageProfileSubmission(req, request, items, context, comment) {
    const mode = String(process.env.PROFILE_APPLY_MODE || 'disabled').trim().toLowerCase();
    const defaults = {
        applyState: 'PENDING_APPROVAL',
        message: 'SAP profile change request was staged and is waiting for HR approval.'
    };
    if (mode === 'mock' && process.env.NODE_ENV !== 'production') {
        return {
            applyState: defaults.applyState,
            applyMessage: 'Mock SAP profile change request was staged for HR approval.'
        };
    }
    if (mode !== 'sap') {
        return {
            applyState: 'NOT_APPLIED',
            applyMessage: ''
        };
    }
    if (!items?.length) {
        return reject(req, 400, 'SAP_PROFILE_WRITE_EMPTY_PAYLOAD', 'There are no current profile changes to submit.');
    }

    const sapApply = await connectProfileApplyService(req);
    const stagingPayload = profileApplyStagingPayload(request, items, context, comment, {
        status: STATUS.PENDING,
        applyState: defaults.applyState,
        applyMessage: defaults.message
    });
    let result;
    try {
        if (request.revisionNo > 1) {
            try {
                result = await sendProfileApplyUpdateByRequestNo(sapApply, request.requestNo, stagingPayload);
            } catch (updateError) {
                if ((updateError.statusCode || updateError.status) !== 404) {
                    throw updateError;
                }
                result = await sendProfileApplyCreate(
                    sapApply,
                    profileApplyPayload(request, items, context, comment),
                    stagingPayload
                );
            }
        } else {
            result = await sendProfileApplyCreate(sapApply, profileApplyPayload(request, items, context, comment), stagingPayload);
        }
    } catch (error) {
        return reject(req, error.statusCode || error.status || 502, 'SAP_PROFILE_WRITE_FAILED', sapApplyErrorMessage(error));
    }

    const normalized = normalizeApplyResult(result, defaults);
    if (!normalized.applied) {
        return reject(req, 502, 'SAP_PROFILE_WRITE_REJECTED', normalized.message);
    }
    return {
        applyState: normalized.applyState,
        applyMessage: normalized.message
    };
}

function decisionApplyDefaults(toStatus) {
    if (toStatus === STATUS.APPROVED) {
        return {
            applyState: 'QUEUED',
            message: 'Queued for HR master data background job'
        };
    }
    if (toStatus === STATUS.REJECTED) {
        return {
            applyState: 'REJECTED',
            message: 'Profile change request was rejected by HR.'
        };
    }
    return {
        applyState: 'REVISION_REQUIRED',
        message: 'HR requested changes for this profile request.'
    };
}

async function applyProfileChanges(req, request, items, context, comment) {
    const mode = String(process.env.PROFILE_APPLY_MODE || 'disabled').trim().toLowerCase();
    if (mode === 'mock' && process.env.NODE_ENV !== 'production') {
        return {
            applyState: 'QUEUED',
            applyMessage: 'Mock SAP profile apply request was queued in non-production mode.'
        };
    }
    if (mode === 'sap') {
        if (!items?.length) {
            return reject(req, 400, 'SAP_PROFILE_WRITE_EMPTY_PAYLOAD', 'There are no current profile changes to apply.');
        }

        const sapApply = await connectProfileApplyService(req);

        let result;
        const defaults = decisionApplyDefaults(STATUS.APPROVED);
        const stagingPayload = profileApplyStagingPayload(request, items, context, comment, {
            status: STATUS.APPROVED,
            applyState: defaults.applyState,
            applyMessage: defaults.message
        });
        try {
            if (profileApplyActionPathConfigured() || profileApplyStrategy() === 'action') {
                result = await sendProfileApplyCreate(
                    sapApply,
                    profileApplyPayload(request, items, context, comment),
                    stagingPayload
                );
            } else {
                try {
                    result = await sendProfileApplyUpdateByRequestNo(sapApply, request.requestNo, stagingPayload);
                } catch (updateError) {
                    if ((updateError.statusCode || updateError.status) !== 404) {
                        throw updateError;
                    }
                    result = await sendProfileApplyCreate(
                        sapApply,
                        profileApplyPayload(request, items, context, comment),
                        stagingPayload
                    );
                }
            }
        } catch (error) {
            return reject(req, error.statusCode || error.status || 502, 'SAP_PROFILE_WRITE_FAILED', sapApplyErrorMessage(error));
        }

        const normalized = normalizeApplyResult(result, defaults);
        if (!normalized.applied) {
            return reject(req, 502, 'SAP_PROFILE_WRITE_REJECTED', normalized.message);
        }
        return {
            applyState: normalized.applyState,
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

async function syncProfileDecision(req, request, items, context, comment, toStatus) {
    if (toStatus === STATUS.APPROVED) {
        return applyProfileChanges(req, request, items, context, comment);
    }

    const mode = String(process.env.PROFILE_APPLY_MODE || 'disabled').trim().toLowerCase();
    const defaults = decisionApplyDefaults(toStatus);
    if (mode === 'mock' && process.env.NODE_ENV !== 'production') {
        return {
            applyState: defaults.applyState,
            applyMessage: `Mock SAP profile request status changed to ${toStatus}.`
        };
    }
    if (mode !== 'sap') {
        return {
            applyState: request.applyState || 'NOT_APPLIED',
            applyMessage: request.applyMessage || ''
        };
    }

    const sapApply = await connectProfileApplyService(req);
    const stagingPayload = profileApplyStagingPayload(request, items, context, comment, {
        status: toStatus,
        applyState: defaults.applyState,
        applyMessage: defaults.message
    });
    let result;
    try {
        try {
            result = await sendProfileApplyUpdateByRequestNo(sapApply, request.requestNo, stagingPayload);
        } catch (updateError) {
            if ((updateError.statusCode || updateError.status) !== 404) {
                throw updateError;
            }
            result = await sendProfileApplyCreate(
                sapApply,
                profileApplyPayload(request, items, context, comment),
                stagingPayload
            );
        }
    } catch (error) {
        return reject(req, error.statusCode || error.status || 502, 'SAP_PROFILE_WRITE_FAILED', sapApplyErrorMessage(error));
    }

    const normalized = normalizeApplyResult(result, defaults);
    if (!normalized.applied) {
        return reject(req, 502, 'SAP_PROFILE_WRITE_REJECTED', normalized.message);
    }
    return {
        applyState: normalized.applyState,
        applyMessage: normalized.message
    };
}

async function syncSapOnlyProfileDecision(req, remoteRow, context, comment, toStatus) {
    const mode = String(process.env.PROFILE_APPLY_MODE || 'disabled').trim().toLowerCase();
    if (mode !== 'sap') {
        return reject(req, 404, 'PROFILE_REQUEST_NOT_FOUND', 'The profile request was not found.');
    }
    const request = sapProfileApplyRequest(remoteRow);
    const items = sapProfileApplyItems(remoteRow);
    if (toStatus === STATUS.APPROVED && !items.length) {
        return reject(req, 400, 'SAP_PROFILE_WRITE_EMPTY_PAYLOAD', 'There are no current profile changes to apply.');
    }

    const sapApply = await connectProfileApplyService(req);
    const defaults = decisionApplyDefaults(toStatus);
    const stagingPayload = profileApplyStagingPayload(request, items, context, comment, {
        status: toStatus,
        applyState: defaults.applyState,
        applyMessage: defaults.message
    });
    let result;
    try {
        result = await sendProfileApplyUpdateByRemoteRow(sapApply, remoteRow, stagingPayload);
    } catch (error) {
        return reject(req, error.statusCode || error.status || 502, 'SAP_PROFILE_WRITE_FAILED', sapApplyErrorMessage(error));
    }

    const normalized = normalizeApplyResult(result, defaults);
    if (!normalized.applied) {
        return reject(req, 502, 'SAP_PROFILE_WRITE_REJECTED', normalized.message);
    }

    const now = utcNow();
    return {
        ...sapProfileRequestDto({
            ...remoteRow,
            ...stagingPayload,
            ApplyState: normalized.applyState,
            ApplyMessage: normalized.message,
            LastChangedAt: now
        }),
        Version: Number(request.version || 1) + 1,
        HrComment: comment,
        ApplyState: normalized.applyState,
        ApplyMessage: normalized.message,
        ModifiedAt: now
    };
}

async function decideSapOnlyProfileRequest(req, action, toStatus, commentRequired, context) {
    const mode = String(process.env.PROFILE_APPLY_MODE || 'disabled').trim().toLowerCase();
    if (mode !== 'sap') {
        return reject(req, 404, 'PROFILE_REQUEST_NOT_FOUND', 'The profile request was not found.');
    }

    const comment = normalizeRemark(req.data.HrComment);
    if (commentRequired && !comment) {
        return reject(req, 400, 'PROFILE_HR_COMMENT_REQUIRED', 'An HR comment is required.');
    }

    const sapApply = await connectProfileApplyService(req);
    let remoteRow;
    try {
        remoteRow = await readSapProfileApplyByRequestId(sapApply, req.data.RequestId);
    } catch (error) {
        return reject(req, error.statusCode || error.status || 502, 'SAP_PROFILE_WRITE_FAILED', sapApplyErrorMessage(error));
    }
    if (!remoteRow) {
        return reject(req, 404, 'PROFILE_REQUEST_NOT_FOUND', 'The profile request was not found.');
    }

    const request = sapProfileApplyRequest(remoteRow);
    assertExpectedVersion(req, request, req.data.ExpectedVersion);
    if (!canTransition(request.status, action)) {
        return reject(req, 409, 'PROFILE_REQUEST_INVALID_STATE', 'The profile request is not in a pending state.');
    }

    return syncSapOnlyProfileDecision(req, remoteRow, context, comment, toStatus);
}

async function insertProfileNotificationOutbox(tx, requestId, eventType, recipientType, recipientKey, now) {
    await tx.run(INSERT.into(OUTBOX).entries({
        ID: uuid(),
        request_ID: requestId,
        eventType,
        recipientType,
        recipientKey: recipientKey || '',
        deliveryStatus: 'PENDING',
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
        createdBy: 'CAP_PROFILE_SERVICE',
        modifiedAt: now,
        modifiedBy: 'CAP_PROFILE_SERVICE'
    }));
}

function emitProfileNotificationRefresh() {
    setImmediate(() => process.emit('znxr09.profileNotificationsChanged'));
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
            ensureRemoteServiceCredentials(serviceName);
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
        ensureRemoteServiceCredentials(connection.serviceName, connection.service);

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

    async function readSapValueHelp(req, entity, mapper, options = {}) {
        if (!profileDisplay.service) {
            return reject(
                req,
                503,
                'SAP_PROFILE_VALUE_HELP_UNAVAILABLE',
                `SAP profile value help service ${profileDisplay.serviceName} is not available.`
            );
        }

        try {
            ensureRemoteServiceCredentials(profileDisplay.serviceName, profileDisplay.service);
            let query = SELECT.from(entity).limit(options.limit || 200);
            if (options.where) query = query.where(options.where);
            let rows = await profileDisplay.service.run(query);
            if (typeof options.filter === 'function') rows = (rows || []).filter(options.filter);
            return (rows || []).map(mapper);
        } catch (error) {
            const diagnostic = safeRemoteErrorDiagnostic(error);
            console.error('[ProfileService] SAP profile value help failed:', {
                service: profileDisplay.serviceName,
                entity,
                status: diagnostic.status,
                code: diagnostic.code,
                message: diagnostic.message,
                correlationId: requestCorrelationId(req),
                filterFields: Object.keys(options.where || {}),
                runtimeCredentials: {
                    usernameConfigured: Boolean(process.env.UI5_USERNAME),
                    passwordConfigured: Boolean(process.env.UI5_PASSWORD)
                }
            });
            return reject(
                req,
                diagnostic.status,
                'SAP_PROFILE_VALUE_HELP_UNAVAILABLE',
                `SAP profile value help ${entity} is not available.`
            );
        }
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
        const localRows = sortByCreatedDesc(rows).map(profileRequestDto);
        const sapRows = await readSapProfileApplyHistory(req, context);
        return sortProfileRequestDtos(mergeProfileRequestDtos(localRows, sapRows));
    });

    this.on('READ', 'ProfileApprovalRequests', async req => {
        const context = userContext(req, true);
        const rows = await cds.tx(req).run(SELECT.from(REQUESTS));
        const localRows = sortByCreatedDesc(rows).map(profileRequestDto);
        const sapRows = await readSapProfileApplyHistory(req, context, { allEmployees: true, top: 200 });
        return sortProfileRequestDtos(mergeProfileRequestDtos(localRows, sapRows));
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
        const localItems = rows
            .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0))
            .map(row => profileItemDto({ ...row, Pernr: pernrByRequest.get(row.request_ID) }));
        if (!requestId || localItems.length) {
            return localItems;
        }

        const sapRows = await readSapProfileApplyRows(req, context, { allEmployees: isApprovalRead, top: 200 });
        const normalizedRequestId = String(requestId).replace(/[{}]/g, '').trim();
        const sapRequest = sapRows.find(row => {
            const sapRequestId = String(row.RequestId || row.requestId || row.ID || row.Id || '')
                .replace(/[{}]/g, '')
                .trim();
            const sapRequestNo = String(row.RequestNo || row.requestNo || '').trim();
            const pernrVisible = isApprovalRead || !row.Pernr || row.Pernr === context.pernr;
            return pernrVisible && (sapRequestId === normalizedRequestId || sapRequestNo === normalizedRequestId);
        });
        return sapProfileItemDtos(sapRequest);
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
    this.on('READ', 'ProfileBanks', req => readSapValueHelp(
        req,
        'BankValueHelp',
        row => ({
            BankCountry: String(row.BankCountry || row.Banks || 'VN').trim(),
            BankKey: String(row.BankKey || row.Bankl || '').trim(),
            BankName: String(row.BankName || row.Banka || '').trim(),
            IsSimulation: false
        }),
        {
            limit: 200,
            where: { BankCountry: String(process.env.PROFILE_BANK_COUNTRY || 'VN').trim() }
        }
    ));

    this.on('READ', 'ProfileMaritalStatuses', req => readSapValueHelp(
        req,
        'MaritalStatusValueHelp',
        row => ({
            MaritalStatusCode: String(row.MaritalStatusCode || row.Famst || '').trim(),
            MaritalStatusText: String(row.MaritalStatusText || row.Ftext || '').trim(),
            Language: String(row.Language || row.Sprsl || '').trim(),
            IsSimulation: false
        }),
        {
            limit: 50,
            where: { Language: String(process.env.PROFILE_LANGUAGE || 'EN').trim() }
        }
    ));

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
        const stagedRequest = await readRequest(tx, requestId);
        const stagingResult = await stageProfileSubmission(req, stagedRequest, validation.changes, context, req.data.Remark);
        await tx.run(UPDATE(REQUESTS).set({
            applyState: stagingResult.applyState,
            applyMessage: stagingResult.applyMessage,
            modifiedAt: now,
            modifiedBy: context.email
        }).where({ ID: requestId }));
        await insertEvent(tx, requestId, 1, 'SUBMITTED', null, STATUS.PENDING, context, 'EMPLOYEE', req.data.Remark, idempotencyKey);
        await insertProfileNotificationOutbox(tx, requestId, 'SUBMITTED', 'HR_ADMIN', 'PROFILE_HR_ADMIN', now);

        const saved = profileRequestDto(await readRequest(tx, requestId));
        emitProfileNotificationRefresh();
        return saved;
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
        const stagedRequest = await readRequest(tx, requestId);
        const stagingResult = await stageProfileSubmission(req, stagedRequest, validation.changes, context, req.data.Remark);
        await tx.run(UPDATE(REQUESTS).set({
            applyState: stagingResult.applyState,
            applyMessage: stagingResult.applyMessage,
            modifiedAt: now,
            modifiedBy: context.email
        }).where({ ID: requestId }));
        await insertEvent(tx, requestId, revisionNo, 'RESUBMITTED', STATUS.REVISION, STATUS.PENDING, context, 'EMPLOYEE', req.data.Remark, idempotencyKey);
        await insertProfileNotificationOutbox(tx, requestId, 'RESUBMITTED', 'HR_ADMIN', 'PROFILE_HR_ADMIN', now);

        const saved = profileRequestDto(await readRequest(tx, requestId));
        emitProfileNotificationRefresh();
        return saved;
    });

    async function decide(req, action, toStatus, eventType, commentRequired = false) {
        const context = userContext(req, true);
        const tx = cds.tx(req);
        const request = await readRequest(tx, req.data.RequestId);
        if (!request) {
            return decideSapOnlyProfileRequest(req, action, toStatus, commentRequired, context);
        }
        assertExpectedVersion(req, request, req.data.ExpectedVersion);
        if (!canTransition(request.status, action)) {
            return reject(req, 409, 'PROFILE_REQUEST_INVALID_STATE', 'The profile request is not in a pending state.');
        }
        const comment = normalizeRemark(req.data.HrComment);
        if (commentRequired && !comment) {
            return reject(req, 400, 'PROFILE_HR_COMMENT_REQUIRED', 'An HR comment is required.');
        }

        const items = await currentItems(tx, request.ID);
        const applyResult = await syncProfileDecision(req, request, items, context, comment, toStatus);

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
        await insertProfileNotificationOutbox(tx, request.ID, eventType, 'EMPLOYEE', request.employeePernr, now);
        const saved = profileRequestDto(await readRequest(tx, request.ID));
        emitProfileNotificationRefresh();
        return saved;
    }

    this.on('requestProfileChanges', req => decide(req, 'requestChanges', STATUS.REVISION, 'REVISION_REQUESTED', true));
    this.on('rejectProfileChange', req => decide(req, 'reject', STATUS.REJECTED, 'REJECTED', true));
    this.on('approveProfileChange', req => decide(req, 'approve', STATUS.APPROVED, 'APPROVED', false));
};
