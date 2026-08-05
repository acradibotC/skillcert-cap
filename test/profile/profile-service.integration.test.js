const test = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const { SELECT } = cds.ql;

let service;
let originalConnectTo;
let profileDisplayShouldFail = false;

function user(email = 'haonguyen022202@gmail.com', pernr = '90000005', isHrAdmin = false) {
    return new cds.User({
        id: email,
        roles: isHrAdmin ? ['ProfileHRAdmin'] : [],
        attr: {
            authorized: true,
            email,
            sapUserId: email,
            pernr,
            name: 'Ta Nam Son',
            isHrAdmin
        }
    });
}

test.before(async () => {
    await cds.deploy('srv/service.cds').to('sqlite::memory:');
    originalConnectTo = cds.connect.to;
    cds.connect.to = async function (name) {
        if (name === 'ZUI_NXR_PROFILE_O4') {
            return {
                run: async () => {
                    if (profileDisplayShouldFail) {
                        throw Object.assign(new Error('Mocked profile display outage'), { status: 503 });
                    }
                    return {
                        UserId: 'HAONGUYEN022202@GMAIL.COM',
                        Pernr: '90000005',
                        EmployeeName: 'Ta Nam Son',
                        DateOfBirth: '20040926',
                        Gender: 'Male',
                        Nationality: 'Vietnamese',
                        MaritalStatus: 'Married',
                        PositionId: '00001234',
                        PositionName: 'SAP Developer',
                        OrgUnitId: '00005678',
                        OrgUnitName: 'Technology',
                        WorkEmail: 'haonguyen022202@gmail.com',
                        Telephone: '0901234567',
                        PermanentAddress: '123 SAP Street',
                        CurrentAddress: '456 UI5 Avenue',
                        PayMethod: 'C',
                        JoinDate: '20240101',
                        IsManager: 'X'
                    };
                }
            };
        }
        if (name === 'ZUI_NXR_SKILLREQ_O4') {
            return {
                run: async () => ({
                    UserId: 'HAONGUYEN022202@GMAIL.COM',
                    Pernr: '90000005',
                    EmployeeName: 'Ta Nam Son',
                    PositionId: '60009500',
                    PositionName: 'Chief Financial Officer',
                    OrgUnitId: '50009050',
                    OrgUnitName: 'Accounting Finance Dept',
                    IsManager: 'X'
                })
            };
        }
        return originalConnectTo.call(cds.connect, name);
    };

    service = await cds.serve('ProfileService')
        .from('srv/service.cds')
        .with(require('../../srv/profile-service'));
    cds.connect.to = originalConnectTo;
});

test('MyProfile is mapped from SAP UserProfile without ProfileSnapshots', async () => {
    const rows = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfile'),
        user: user()
    }));
    const profile = rows.Pernr ? rows : rows[0];

    assert.equal(profile.Pernr, '90000005');
    assert.equal(profile.EmployeeName, 'Ta Nam Son');
    assert.equal(profile.PositionName, 'SAP Developer');
    assert.equal(profile.OrgUnitName, 'Technology');
    assert.equal(profile.WorkEmail, 'haonguyen022202@gmail.com');
    assert.equal(profile.DateOfBirth, '2004-09-26');
    assert.equal(profile.Gender, 'Male');
    assert.equal(profile.Nationality, 'Vietnamese');
    assert.equal(profile.MaritalStatus, 'Married');
    assert.equal(profile.Telephone, '0901234567');
    assert.equal(profile.PermanentAddress, '123 SAP Street');
    assert.equal(profile.CurrentAddress, '456 UI5 Avenue');
    assert.equal(profile.PayMethod, 'C');
    assert.equal(profile.PayMethodText, 'Cash');
    assert.equal(profile.JoinDate, '2024-01-01');
    assert.equal(profile.IsSimulation, false);
    assert.equal(profile.IdNumber, '');
    assert.ok(profile.ProfileVersion);
});

test('MyProfile falls back to legacy SkillReq UserProfile while display OData is unavailable', async () => {
    profileDisplayShouldFail = true;
    try {
        const rows = await service.send(new cds.Request({
            event: 'READ',
            query: SELECT.from('ProfileService.MyProfile'),
            user: user()
        }));
        const profile = rows.Pernr ? rows : rows[0];

        assert.equal(profile.Pernr, '90000005');
        assert.equal(profile.EmployeeName, 'Ta Nam Son');
        assert.equal(profile.PositionName, 'Chief Financial Officer');
        assert.equal(profile.OrgUnitName, 'Accounting Finance Dept');
        assert.equal(profile.WorkEmail, 'haonguyen022202@gmail.com');
        assert.equal(profile.DateOfBirth, null);
        assert.equal(profile.Gender, '');
    } finally {
        profileDisplayShouldFail = false;
    }
});

test('MyProfileFields exposes the workflow editable field catalog', async () => {
    const fields = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfileFields'),
        user: user()
    }));

    assert.ok(fields.length >= 10);
    assert.ok(fields.every(field => field.Editable === true));
    assert.ok(fields.every(field => field.Locked === false));
    assert.equal(fields.find(field => field.FieldCode === 'WORK_EMAIL').Value, 'haonguyen022202@gmail.com');
});

test('profile edit submits a pending request, locks fields, and keeps SAP apply fail-safe', async () => {
    const profileRows = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfile'),
        user: user()
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];
    const submitKey = `profile-submit-${Date.now()}`;

    const submitted = await service.send(new cds.Request({
        event: 'submitProfileChange',
        data: {
            IdempotencyKey: submitKey,
            ProfileVersion: profile.ProfileVersion,
            Remark: 'Update contact email',
            Changes: [{ FieldCode: 'WORK_EMAIL', NewValue: 'profile.change@example.com' }]
        },
        user: user()
    }));

    assert.equal(submitted.Status, '01');
    assert.equal(submitted.Pernr, '90000005');
    assert.match(submitted.RequestNo, /^PR/);

    const duplicate = await service.send(new cds.Request({
        event: 'submitProfileChange',
        data: {
            IdempotencyKey: submitKey,
            ProfileVersion: profile.ProfileVersion,
            Remark: 'Update contact email',
            Changes: [{ FieldCode: 'WORK_EMAIL', NewValue: 'profile.change@example.com' }]
        },
        user: user()
    }));
    assert.equal(duplicate.ID, submitted.ID);

    const requests = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfileRequests'),
        user: user()
    }));
    assert.ok(requests.some(request => request.ID === submitted.ID && request.Status === '01'));

    const hrOutbox = await cds.run(SELECT.from('znxr09.db.ProfileNotificationOutbox').where({
        request_ID: submitted.ID,
        eventType: 'SUBMITTED',
        recipientType: 'HR_ADMIN'
    }));
    assert.equal(hrOutbox.length, 1);

    const fieldsAfterSubmit = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfileFields'),
        user: user()
    }));
    const emailField = fieldsAfterSubmit.find(field => field.FieldCode === 'WORK_EMAIL');
    assert.equal(emailField.Locked, true);
    assert.equal(emailField.LockRequestId, submitted.ID);

    await assert.rejects(() => service.send(new cds.Request({
        event: 'submitProfileChange',
        data: {
            IdempotencyKey: `profile-submit-conflict-${Date.now()}`,
            ProfileVersion: profile.ProfileVersion,
            Remark: 'Conflicting email update',
            Changes: [{ FieldCode: 'WORK_EMAIL', NewValue: 'profile.conflict@example.com' }]
        },
        user: user()
    })), error => error.code === 'PROFILE_FIELD_LOCKED' || error.statusCode === 409);

    const inbox = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.ProfileApprovalRequests'),
        user: user('hr@example.com', '90000099', true)
    }));
    assert.ok(inbox.some(request => request.ID === submitted.ID && request.Status === '01'));

    await assert.rejects(() => service.send(new cds.Request({
        event: 'approveProfileChange',
        data: {
            RequestId: submitted.ID,
            ExpectedVersion: submitted.Version,
            HrComment: ''
        },
        user: user('hr@example.com', '90000099', true)
    })), error => error.code === 'SAP_PROFILE_WRITE_NOT_AVAILABLE' || error.statusCode === 501);

    const revision = await service.send(new cds.Request({
        event: 'requestProfileChanges',
        data: {
            RequestId: submitted.ID,
            ExpectedVersion: submitted.Version,
            HrComment: 'Please confirm the address as well.'
        },
        user: user('hr@example.com', '90000099', true)
    }));
    assert.equal(revision.Status, '04');

    const resubmitted = await service.send(new cds.Request({
        event: 'resubmitProfileChange',
        data: {
            RequestId: submitted.ID,
            ExpectedVersion: revision.Version,
            IdempotencyKey: `profile-resubmit-${Date.now()}`,
            ProfileVersion: profile.ProfileVersion,
            Remark: 'Confirmed contact email',
            Changes: [{ FieldCode: 'WORK_EMAIL', NewValue: 'profile.change.2@example.com' }]
        },
        user: user()
    }));
    assert.equal(resubmitted.Status, '01');
    assert.equal(resubmitted.RevisionNo, 2);

    const rejected = await service.send(new cds.Request({
        event: 'rejectProfileChange',
        data: {
            RequestId: submitted.ID,
            ExpectedVersion: resubmitted.Version,
            HrComment: 'Rejected for regression test cleanup.'
        },
        user: user('hr@example.com', '90000099', true)
    }));
    assert.equal(rejected.Status, '03');

    const fieldsAfterReject = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfileFields'),
        user: user()
    }));
    assert.equal(fieldsAfterReject.find(field => field.FieldCode === 'WORK_EMAIL').Locked, false);
});

test('profile approval applies changes through configured SAP profile OData adapter', async () => {
    const profileRows = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfile'),
        user: user()
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];

    const oldApplyMode = process.env.PROFILE_APPLY_MODE;
    const oldApplyService = process.env.PROFILE_APPLY_SERVICE;
    const oldApplyPath = process.env.PROFILE_APPLY_ACTION_PATH;
    const oldApplyStrategy = process.env.PROFILE_APPLY_STRATEGY;
    const oldApplyHttpClient = process.env.PROFILE_APPLY_HTTP_CLIENT;
    const sentRequests = [];
    const sapRequestId = '11111111-2222-3333-4444-555555555555';

    process.env.PROFILE_APPLY_MODE = 'sap';
    process.env.PROFILE_APPLY_SERVICE = 'ZUI_NXR_PROFILE_APPLY_O4';
    process.env.PROFILE_APPLY_STRATEGY = 'create';
    process.env.PROFILE_APPLY_HTTP_CLIENT = 'cap';
    delete process.env.PROFILE_APPLY_ACTION_PATH;
    cds.connect.to = async function (name) {
        if (name === 'ZUI_NXR_PROFILE_APPLY_O4') {
            return {
                send: async request => {
                    sentRequests.push(request);
                    if (request.method === 'GET') {
                        return [{
                            RequestId: sapRequestId,
                            RequestNo: request.path.includes('RequestNo') ? 'matched-by-request-no' : ''
                        }];
                    }
                    if (request.method === 'POST') {
                        return {
                            RequestId: sapRequestId,
                            ApplyState: 'PENDING_APPROVAL',
                            ApplyMessage: 'Staged by mocked SAP profile OData service.'
                        };
                    }
                    return {
                        Applied: true,
                        ApplyState: 'QUEUED',
                        Message: 'Queued by mocked SAP profile OData service.'
                    };
                }
            };
        }
        return originalConnectTo.call(cds.connect, name);
    };

    try {
        const submitted = await service.send(new cds.Request({
            event: 'submitProfileChange',
            data: {
                IdempotencyKey: `profile-submit-sap-${Date.now()}`,
                ProfileVersion: profile.ProfileVersion,
                Remark: 'Update current address',
                Changes: [{ FieldCode: 'CURR_ADDRESS', NewValue: '123 Local Street' }]
            },
            user: user()
        }));

        assert.equal(submitted.Status, '01');
        assert.equal(submitted.ApplyState, 'PENDING_APPROVAL');
        assert.equal(sentRequests[0].method, 'POST');
        assert.equal(sentRequests[0].path, '/ProfileApplyRequest');
        assert.equal(sentRequests[0].data.RequestNo, submitted.RequestNo);
        assert.equal(sentRequests[0].data.Pernr, '90000005');
        assert.equal(sentRequests[0].data.Status, '01');
        assert.equal(sentRequests[0].data.ApplyState, 'PENDING_APPROVAL');
        assert.equal(sentRequests[0].data.DecisionByEmail, '');
        assert.equal(sentRequests[0].data.ChangedFields, 'CURR_ADDRESS');
        assert.equal(sentRequests[0].data.CurrentAddress, '123 Local Street');

        const approved = await service.send(new cds.Request({
            event: 'approveProfileChange',
            data: {
                RequestId: submitted.ID,
                ExpectedVersion: submitted.Version,
                HrComment: 'Approved after SAP apply.'
            },
            user: user('hr@example.com', '90000099', true)
        }));

        assert.equal(approved.Status, '02');
        assert.equal(approved.ApplyState, 'QUEUED');
        assert.equal(sentRequests[1].method, 'GET');
        assert.match(sentRequests[1].path, /RequestNo%20eq%20'PR/);
        assert.equal(sentRequests[2].method, 'MERGE');
        assert.equal(sentRequests[2].path, `/ProfileApplyRequest(guid'${sapRequestId}')`);
        assert.equal(sentRequests[2].data.RequestNo, submitted.RequestNo);
        assert.equal(sentRequests[2].data.Pernr, '90000005');
        assert.equal(sentRequests[2].data.Status, '02');
        assert.equal(sentRequests[2].data.ApplyState, 'QUEUED');
        assert.equal(sentRequests[2].data.DecisionByEmail, 'hr@example.com');
        assert.equal(sentRequests[2].data.ChangedFields, 'CURR_ADDRESS');
        assert.equal(sentRequests[2].data.CurrentAddress, '123 Local Street');

        const employeeOutbox = await cds.run(SELECT.from('znxr09.db.ProfileNotificationOutbox').where({
            request_ID: submitted.ID,
            eventType: 'APPROVED',
            recipientType: 'EMPLOYEE',
            recipientKey: '90000005'
        }));
        assert.equal(employeeOutbox.length, 1);

        const fieldsAfterApprove = await service.send(new cds.Request({
            event: 'READ',
            query: SELECT.from('ProfileService.MyProfileFields'),
            user: user()
        }));
        assert.equal(fieldsAfterApprove.find(field => field.FieldCode === 'CURR_ADDRESS').Locked, false);
    } finally {
        if (oldApplyMode === undefined) delete process.env.PROFILE_APPLY_MODE;
        else process.env.PROFILE_APPLY_MODE = oldApplyMode;
        if (oldApplyService === undefined) delete process.env.PROFILE_APPLY_SERVICE;
        else process.env.PROFILE_APPLY_SERVICE = oldApplyService;
        if (oldApplyPath === undefined) delete process.env.PROFILE_APPLY_ACTION_PATH;
        else process.env.PROFILE_APPLY_ACTION_PATH = oldApplyPath;
        if (oldApplyStrategy === undefined) delete process.env.PROFILE_APPLY_STRATEGY;
        else process.env.PROFILE_APPLY_STRATEGY = oldApplyStrategy;
        if (oldApplyHttpClient === undefined) delete process.env.PROFILE_APPLY_HTTP_CLIENT;
        else process.env.PROFILE_APPLY_HTTP_CLIENT = oldApplyHttpClient;
        cds.connect.to = originalConnectTo;
    }
});

test('MyProfileRequests includes staged SAP profile request history', async () => {
    const oldApplyMode = process.env.PROFILE_APPLY_MODE;
    const oldApplyService = process.env.PROFILE_APPLY_SERVICE;
    const oldApplyPath = process.env.PROFILE_APPLY_ACTION_PATH;
    const oldApplyStrategy = process.env.PROFILE_APPLY_STRATEGY;
    const oldApplyHttpClient = process.env.PROFILE_APPLY_HTTP_CLIENT;
    const sentRequests = [];

    process.env.PROFILE_APPLY_MODE = 'sap';
    process.env.PROFILE_APPLY_SERVICE = 'ZUI_NXR_PROFILE_APPLY_O4';
    process.env.PROFILE_APPLY_STRATEGY = 'create';
    process.env.PROFILE_APPLY_HTTP_CLIENT = 'cap';
    delete process.env.PROFILE_APPLY_ACTION_PATH;
    cds.connect.to = async function (name) {
        if (name === 'ZUI_NXR_PROFILE_APPLY_O4') {
            return {
                send: async request => {
                    sentRequests.push(request);
                    assert.equal(request.method, 'GET');
                    assert.match(request.path, /Pernr%20eq%20'90000005'/);
                    return {
                        d: {
                            results: [{
                                RequestId: '22222222-3333-4444-5555-666666666666',
                                RequestNo: 'PRSAPHISTORY',
                                Pernr: '90000005',
                                EmployeeName: 'Ta Nam Son',
                                RevisionNo: 1,
                                Status: '01',
                                ApplyState: 'PENDING_APPROVAL',
                                ApplyMessage: 'SAP pending row',
                                CreatedAt: '/Date(1784514628000)/',
                                LastChangedAt: '/Date(1784514628000)/'
                            }]
                        }
                    };
                }
            };
        }
        return originalConnectTo.call(cds.connect, name);
    };

    try {
        const requests = await service.send(new cds.Request({
            event: 'READ',
            query: SELECT.from('ProfileService.MyProfileRequests'),
            user: user()
        }));

        const sapHistoryRow = requests.find(request => request.RequestNo === 'PRSAPHISTORY');
        assert.equal(sentRequests.length, 1);
        assert.ok(sapHistoryRow);
        assert.equal(sapHistoryRow.ID, '22222222-3333-4444-5555-666666666666');
        assert.equal(sapHistoryRow.Pernr, '90000005');
        assert.equal(sapHistoryRow.Status, '01');
        assert.equal(sapHistoryRow.ApplyState, 'PENDING_APPROVAL');
        assert.equal(sapHistoryRow.SubmittedAt, '2026-07-20T02:30:28.000Z');
    } finally {
        if (oldApplyMode === undefined) delete process.env.PROFILE_APPLY_MODE;
        else process.env.PROFILE_APPLY_MODE = oldApplyMode;
        if (oldApplyService === undefined) delete process.env.PROFILE_APPLY_SERVICE;
        else process.env.PROFILE_APPLY_SERVICE = oldApplyService;
        if (oldApplyPath === undefined) delete process.env.PROFILE_APPLY_ACTION_PATH;
        else process.env.PROFILE_APPLY_ACTION_PATH = oldApplyPath;
        if (oldApplyStrategy === undefined) delete process.env.PROFILE_APPLY_STRATEGY;
        else process.env.PROFILE_APPLY_STRATEGY = oldApplyStrategy;
        if (oldApplyHttpClient === undefined) delete process.env.PROFILE_APPLY_HTTP_CLIENT;
        else process.env.PROFILE_APPLY_HTTP_CLIENT = oldApplyHttpClient;
        cds.connect.to = originalConnectTo;
    }
});

test('ProfileApprovalRequests includes SAP-staged profile requests for HR admins', async () => {
    const oldApplyMode = process.env.PROFILE_APPLY_MODE;
    const oldApplyService = process.env.PROFILE_APPLY_SERVICE;
    const oldApplyPath = process.env.PROFILE_APPLY_ACTION_PATH;
    const oldApplyStrategy = process.env.PROFILE_APPLY_STRATEGY;
    const oldApplyHttpClient = process.env.PROFILE_APPLY_HTTP_CLIENT;
    const sentRequests = [];
    const sapRows = [{
        RequestId: '33333333-4444-5555-6666-777777777777',
        RequestNo: 'PRHRHISTORY',
        Pernr: '90000005',
        EmployeeName: 'Ta Nam Son',
        RevisionNo: 1,
        Status: '01',
        ApplyState: 'PENDING_APPROVAL',
        ApplyMessage: 'SAP pending HR inbox row',
        ChangedFields: 'TELEPHONE,WORK_EMAIL',
        Telephone: '0389431327',
        WorkEmail: 'haonguyen022202@gmail.com',
        CreatedAt: '/Date(1784514628000)/',
        LastChangedAt: '/Date(1784514628000)/'
    }];

    process.env.PROFILE_APPLY_MODE = 'sap';
    process.env.PROFILE_APPLY_SERVICE = 'ZUI_NXR_PROFILE_APPLY_O4';
    process.env.PROFILE_APPLY_STRATEGY = 'create';
    process.env.PROFILE_APPLY_HTTP_CLIENT = 'cap';
    delete process.env.PROFILE_APPLY_ACTION_PATH;
    cds.connect.to = async function (name) {
        if (name === 'ZUI_NXR_PROFILE_APPLY_O4') {
            return {
                send: async request => {
                    sentRequests.push(request);
                    assert.equal(request.method, 'GET');
                    return { d: { results: sapRows } };
                }
            };
        }
        return originalConnectTo.call(cds.connect, name);
    };

    try {
        const inbox = await service.send(new cds.Request({
            event: 'READ',
            query: SELECT.from('ProfileService.ProfileApprovalRequests'),
            user: user('hr@example.com', '90000099', true)
        }));

        const sapInboxRow = inbox.find(request => request.RequestNo === 'PRHRHISTORY');
        assert.ok(sapInboxRow);
        assert.equal(sapInboxRow.ID, '33333333-4444-5555-6666-777777777777');
        assert.equal(sapInboxRow.Pernr, '90000005');
        assert.equal(sapInboxRow.Status, '01');
        assert.match(sentRequests[0].path, /\/ProfileApplyRequest\?%24top=200/);
        assert.doesNotMatch(sentRequests[0].path, /Pernr/);

        const items = await service.send(new cds.Request({
            event: 'READ',
            query: SELECT.from('ProfileService.ProfileApprovalRequestItems').where({
                RequestId: sapInboxRow.ID,
                IsCurrent: true
            }),
            user: user('hr@example.com', '90000099', true)
        }));

        assert.equal(items.length, 2);
        assert.equal(items[0].FieldCode, 'TELEPHONE');
        assert.equal(items[0].NewValue, '0389431327');
        assert.equal(items[1].FieldCode, 'WORK_EMAIL');
    } finally {
        if (oldApplyMode === undefined) delete process.env.PROFILE_APPLY_MODE;
        else process.env.PROFILE_APPLY_MODE = oldApplyMode;
        if (oldApplyService === undefined) delete process.env.PROFILE_APPLY_SERVICE;
        else process.env.PROFILE_APPLY_SERVICE = oldApplyService;
        if (oldApplyPath === undefined) delete process.env.PROFILE_APPLY_ACTION_PATH;
        else process.env.PROFILE_APPLY_ACTION_PATH = oldApplyPath;
        if (oldApplyStrategy === undefined) delete process.env.PROFILE_APPLY_STRATEGY;
        else process.env.PROFILE_APPLY_STRATEGY = oldApplyStrategy;
        if (oldApplyHttpClient === undefined) delete process.env.PROFILE_APPLY_HTTP_CLIENT;
        else process.env.PROFILE_APPLY_HTTP_CLIENT = oldApplyHttpClient;
        cds.connect.to = originalConnectTo;
    }
});

test('HR can approve a SAP-staged profile request even when local SQLite history is absent', async () => {
    const oldApplyMode = process.env.PROFILE_APPLY_MODE;
    const oldApplyService = process.env.PROFILE_APPLY_SERVICE;
    const oldApplyPath = process.env.PROFILE_APPLY_ACTION_PATH;
    const oldApplyStrategy = process.env.PROFILE_APPLY_STRATEGY;
    const oldApplyHttpClient = process.env.PROFILE_APPLY_HTTP_CLIENT;
    const sapRequestId = '44444444-5555-6666-7777-888888888888';
    const sentRequests = [];

    process.env.PROFILE_APPLY_MODE = 'sap';
    process.env.PROFILE_APPLY_SERVICE = 'ZUI_NXR_PROFILE_APPLY_O4';
    process.env.PROFILE_APPLY_STRATEGY = 'create';
    process.env.PROFILE_APPLY_HTTP_CLIENT = 'cap';
    delete process.env.PROFILE_APPLY_ACTION_PATH;
    cds.connect.to = async function (name) {
        if (name === 'ZUI_NXR_PROFILE_APPLY_O4') {
            return {
                send: async request => {
                    sentRequests.push(request);
                    if (request.method === 'GET') {
                        assert.equal(request.path, `/ProfileApplyRequest(guid'${sapRequestId}')`);
                        return {
                            RequestId: sapRequestId,
                            RequestNo: 'PRSAPONLYAPPROVE',
                            Pernr: '90000005',
                            EmployeeName: 'Ta Nam Son',
                            RequestedByEmail: 'haonguyen022202@gmail.com',
                            RevisionNo: 1,
                            Status: '01',
                            ApplyState: 'PENDING_APPROVAL',
                            ApplyMessage: 'SAP-only pending row',
                            ChangedFields: 'TELEPHONE',
                            Telephone: '0389431327',
                            CreatedAt: '/Date(1784514628000)/',
                            LastChangedAt: '/Date(1784514628000)/'
                        };
                    }
                    if (request.method === 'MERGE') {
                        return {
                            Applied: true,
                            ApplyState: 'QUEUED',
                            Message: 'Queued SAP-only approval.'
                        };
                    }
                    throw new Error(`Unexpected SAP profile apply mock request ${request.method}`);
                }
            };
        }
        return originalConnectTo.call(cds.connect, name);
    };

    try {
        const approved = await service.send(new cds.Request({
            event: 'approveProfileChange',
            data: {
                RequestId: sapRequestId,
                ExpectedVersion: 1,
                HrComment: ''
            },
            user: user('hr@example.com', '90000099', true)
        }));

        assert.equal(approved.ID, sapRequestId);
        assert.equal(approved.RequestNo, 'PRSAPONLYAPPROVE');
        assert.equal(approved.Status, '02');
        assert.equal(approved.Pernr, '90000005');
        assert.equal(approved.ApplyState, 'QUEUED');
        assert.equal(sentRequests.length, 2);
        assert.equal(sentRequests[1].method, 'MERGE');
        assert.equal(sentRequests[1].path, `/ProfileApplyRequest(guid'${sapRequestId}')`);
        assert.equal(sentRequests[1].data.Status, '02');
        assert.equal(sentRequests[1].data.DecisionByEmail, 'hr@example.com');
        assert.equal(sentRequests[1].data.ChangedFields, 'TELEPHONE');
        assert.equal(sentRequests[1].data.Telephone, '0389431327');
    } finally {
        if (oldApplyMode === undefined) delete process.env.PROFILE_APPLY_MODE;
        else process.env.PROFILE_APPLY_MODE = oldApplyMode;
        if (oldApplyService === undefined) delete process.env.PROFILE_APPLY_SERVICE;
        else process.env.PROFILE_APPLY_SERVICE = oldApplyService;
        if (oldApplyPath === undefined) delete process.env.PROFILE_APPLY_ACTION_PATH;
        else process.env.PROFILE_APPLY_ACTION_PATH = oldApplyPath;
        if (oldApplyStrategy === undefined) delete process.env.PROFILE_APPLY_STRATEGY;
        else process.env.PROFILE_APPLY_STRATEGY = oldApplyStrategy;
        if (oldApplyHttpClient === undefined) delete process.env.PROFILE_APPLY_HTTP_CLIENT;
        else process.env.PROFILE_APPLY_HTTP_CLIENT = oldApplyHttpClient;
        cds.connect.to = originalConnectTo;
    }
});

test('SAP profile must match the authenticated Pernr', async () => {
    await assert.rejects(() => service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfile'),
        user: user('other@example.com', '90000006')
    })), error => error.code === 'SAP_PROFILE_IDENTITY_MISMATCH' || error.statusCode === 403);
});
