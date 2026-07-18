const cds = require('@sap/cds');
const { FIELD_CATALOG, stableHash } = require('./profile-domain');

const { SELECT } = cds.ql;

function reject(req, status, code, message) {
    return req.reject({ status, code, message });
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
        DateOfBirth: sapProfile.DateOfBirth || null,
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
        PayMethodText: sapProfile.PayMethodText || '',
        BankCountry: sapProfile.BankCountry || '',
        BankKey: sapProfile.BankKey || '',
        BankAccount: sapProfile.BankAccount || '',
        BankName: sapProfile.BankName || '',
        JoinDate: sapProfile.JoinDate || null,
        ContractType: sapProfile.ContractType || '',
        DependentsSummary: sapProfile.DependentsSummary || '',
        IsSimulation: false
    };
    dto.ProfileVersion = stableHash(dto);
    return dto;
}

function fieldRows(profile) {
    const propertyByField = {
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
    };

    return Object.entries(FIELD_CATALOG).map(([FieldCode, definition]) => {
        const value = profile[propertyByField[FieldCode]] || '';
        return {
            FieldCode,
            Value: value,
            DisplayValue: value,
            FieldGroup: definition.group,
            MaxLength: definition.maxLength,
            // FE preview mode: expose the FS-approved editable field set while
            // keeping all workflow actions fail-closed until RAP is available.
            Editable: true,
            Mandatory: false,
            Sensitive: Boolean(definition.sensitive),
            Locked: false,
            LockRequestId: null,
            LockStatus: '',
            MappingStatus: value ? 'CONFIRMED' : definition.mappingStatus
        };
    });
}

module.exports = async function ProfileService() {
    const sap = await cds.connect.to('ZUI_NXR_SKILLREQ_O4');

    async function readSapProfile(req, context) {
        const candidates = [...new Set([
            context.sapUserId,
            context.email,
            context.sapUserId.toUpperCase(),
            context.email.toUpperCase()
        ].filter(Boolean))];

        let profile;
        for (const userId of candidates) {
            profile = await sap.run(SELECT.one.from('UserProfile').where({ UserId: userId }));
            if (profile) break;
        }
        if (!profile && context.pernr) {
            profile = await sap.run(SELECT.one.from('UserProfile').where({ Pernr: context.pernr }));
        }
        if (!profile) {
            return reject(req, 404, 'SAP_PROFILE_NOT_FOUND', 'No employee profile was found in SAP.');
        }
        if (String(profile.Pernr || '') !== context.pernr) {
            return reject(req, 403, 'SAP_PROFILE_IDENTITY_MISMATCH', 'The SAP employee profile does not match the authenticated identity.');
        }
        return profile;
    }

    async function currentProfile(req) {
        const context = userContext(req);
        return profileDto(await readSapProfile(req, context), context);
    }

    this.on('READ', 'MyProfile', currentProfile);
    this.on('READ', 'MyProfileFields', async req => fieldRows(await currentProfile(req)));

    // UI-preview phase: workflow persistence is intentionally not loaded.
    this.on('READ', ['MyProfileRequests', 'MyProfileRequestItems'], req => {
        userContext(req);
        return [];
    });
    this.on('READ', ['ProfileApprovalRequests', 'ProfileApprovalRequestItems', 'ProfileRequestEvents'], req => {
        userContext(req, true);
        return [];
    });
    this.on('READ', 'ProfilePaymentMethods', () => []);
    this.on('READ', 'ProfileBanks', () => []);

    this.on([
        'submitProfileChange',
        'resubmitProfileChange',
        'requestProfileChanges',
        'rejectProfileChange',
        'approveProfileChange'
    ], req => reject(
        req,
        501,
        'PROFILE_WORKFLOW_NOT_AVAILABLE',
        'Profile changes are disabled until the SAP RAP profile workflow is available.'
    ));
};
