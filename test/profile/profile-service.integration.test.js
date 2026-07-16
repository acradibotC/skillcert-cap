const test = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const { SELECT, UPDATE } = cds.ql;

process.env.NODE_ENV = 'test';
process.env.PROFILE_MODE = 'mock';

let service;

function user(email, pernr, isHrAdmin = false) {
    return new cds.User({
        id: email,
        roles: isHrAdmin ? ['ProfileHRAdmin'] : [],
        attr: {
            authorized: true,
            email,
            pernr,
            name: email.split('@')[0],
            isHrAdmin
        }
    });
}

function send(event, data, requestUser) {
    return service.send(new cds.Request({ event, data, user: requestUser }));
}

test.before(async () => {
    await cds.deploy('srv/service.cds').to('sqlite::memory:');
    service = await cds.serve('ProfileService')
        .from('srv/service.cds')
        .with(require('../../srv/profile-service'));
});

test('employee submit, HR revision/resubmit and simulated approve are atomic', async () => {
    const employee = user('employee@example.com', '00000001');
    const hr = user('hr@example.com', '00000099', true);

    const profiles = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfile'),
        user: employee
    }));
    assert.equal(profiles.Pernr || profiles[0]?.Pernr, '00000001');
    const profile = profiles.Pernr ? profiles : profiles[0];

    const submitted = await send('submitProfileChange', {
        IdempotencyKey: 'integration-submit-1',
        ProfileVersion: profile.ProfileVersion,
        Remark: 'Please update my work email',
        Changes: [{ FieldCode: 'WORK_EMAIL', NewValue: 'employee.new@example.com' }]
    }, employee);
    assert.equal(submitted.Status, '01');

    const revision = await send('requestProfileChanges', {
        RequestId: submitted.ID,
        ExpectedVersion: submitted.Version,
        HrComment: 'Please confirm the address too.'
    }, hr);
    assert.equal(revision.Status, '04');

    const resubmitted = await send('resubmitProfileChange', {
        RequestId: submitted.ID,
        ExpectedVersion: revision.Version,
        IdempotencyKey: 'integration-resubmit-1',
        ProfileVersion: profile.ProfileVersion,
        Remark: 'Confirmed',
        Changes: [{ FieldCode: 'WORK_EMAIL', NewValue: 'employee.confirmed@example.com' }]
    }, employee);
    assert.equal(resubmitted.Status, '01');

    const approved = await send('approveProfileChange', {
        RequestId: submitted.ID,
        ExpectedVersion: resubmitted.Version,
        HrComment: 'Approved in local test.'
    }, hr);
    assert.equal(approved.Status, '02');
    assert.equal(approved.IsSimulation, true);

    const snapshots = await cds.db.run(
        SELECT.from('znxr09.db.ProfileSnapshots').where({ employeePernr: '00000001' })
    );
    assert.equal(snapshots[0].workEmail, 'employee.confirmed@example.com');
    const locks = await cds.db.run(
        SELECT.from('znxr09.db.ProfileFieldLocks').where({ employeePernr: '00000001' })
    );
    assert.equal(locks.length, 0);
});

test('duplicate field lock and stale HR decision are rejected', async () => {
    const employee = user('employee2@example.com', '00000002');
    const hr = user('hr@example.com', '00000099', true);
    const profileRows = await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];

    const first = await send('submitProfileChange', {
        IdempotencyKey: 'integration-lock-1', ProfileVersion: profile.ProfileVersion,
        Remark: '', Changes: [{ FieldCode: 'CURR_ADDRESS', NewValue: 'Da Nang' }]
    }, employee);

    await assert.rejects(() => send('submitProfileChange', {
        IdempotencyKey: 'integration-lock-2', ProfileVersion: profile.ProfileVersion,
        Remark: '', Changes: [{ FieldCode: 'CURR_ADDRESS', NewValue: 'Hue' }]
    }, employee), error => error.code === 'FIELD_LOCKED' || error.statusCode === 409);

    const rejected = await send('rejectProfileChange', {
        RequestId: first.ID, ExpectedVersion: first.Version, HrComment: 'Rejected for test.'
    }, hr);
    assert.equal(rejected.Status, '03');

    await assert.rejects(() => send('approveProfileChange', {
        RequestId: first.ID, ExpectedVersion: first.Version, HrComment: ''
    }, hr), error => error.code === 'INVALID_STATE' || error.statusCode === 400);
});

test('employee cannot read the HR approval inbox and own-request filtering prevents IDOR', async () => {
    const employee = user('employee3@example.com', '00000003');
    const otherEmployee = user('employee4@example.com', '00000004');

    await assert.rejects(() => service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.ProfileApprovalRequests'),
        user: employee
    })), error => error.code === 'PROFILE_HR_FORBIDDEN' || error.statusCode === 403);

    const rows = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfileRequests'),
        user: otherEmployee
    }));
    assert.ok(rows.every(row => row.Pernr === '00000004'));
});

test('SAP mode fails closed without a configured write adapter', async () => {
    const employee = user('employee5@example.com', '00000005');
    const hr = user('hr@example.com', '00000099', true);
    const profileRows = await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];
    const request = await send('submitProfileChange', {
        IdempotencyKey: 'integration-sap-mode', ProfileVersion: profile.ProfileVersion,
        Remark: '', Changes: [{ FieldCode: 'TELEPHONE', NewValue: '+84 900 111 222' }]
    }, employee);

    process.env.PROFILE_MODE = 'sap';
    try {
        await assert.rejects(() => send('approveProfileChange', {
            RequestId: request.ID, ExpectedVersion: request.Version, HrComment: ''
        }, hr), error => error.code === 'SAP_PROFILE_ADAPTER_NOT_CONFIGURED' || error.statusCode === 503);
    } finally {
        process.env.PROFILE_MODE = 'mock';
    }

    const persisted = await cds.db.run(
        SELECT.one.from('znxr09.db.ProfileChangeRequests').where({ ID: request.ID })
    );
    assert.equal(persisted.status, '01');
});

test('idempotent submit returns the same request and rejects a changed payload', async () => {
    const employee = user('employee6@example.com', '00000006');
    const profileRows = await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];
    const payload = {
        IdempotencyKey: 'integration-idempotency', ProfileVersion: profile.ProfileVersion,
        Remark: 'same', Changes: [{ FieldCode: 'ADDRESS', NewValue: 'Ho Chi Minh City' }]
    };
    const first = await send('submitProfileChange', payload, employee);
    const repeated = await send('submitProfileChange', payload, employee);
    assert.equal(repeated.ID, first.ID);

    await assert.rejects(() => send('submitProfileChange', {
        ...payload,
        Remark: 'different'
    }, employee), error => error.code === 'IDEMPOTENCY_CONFLICT' || error.statusCode === 409);
});

test('revision items are own-employee only and dropped fields release their locks', async () => {
    const employee = user('employee7@example.com', '00000007');
    const otherEmployee = user('employee70@example.com', '00000070');
    const hr = user('hr@example.com', '00000099', true);
    const profileRows = await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];
    const request = await send('submitProfileChange', {
        IdempotencyKey: 'integration-revision-locks', ProfileVersion: profile.ProfileVersion,
        Remark: '',
        Changes: [
            { FieldCode: 'TELEPHONE', NewValue: '+84 900 222 333' },
            { FieldCode: 'ADDRESS', NewValue: 'Original proposed address' }
        ]
    }, employee);
    const revision = await send('requestProfileChanges', {
        RequestId: request.ID, ExpectedVersion: request.Version, HrComment: 'Revise the address.'
    }, hr);

    const ownItems = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfileRequestItems').where({ RequestId: request.ID, IsCurrent: true }),
        user: employee
    }));
    assert.equal(ownItems.length, 2);
    const otherItems = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfileRequestItems').where({ RequestId: request.ID, IsCurrent: true }),
        user: otherEmployee
    }));
    assert.equal(otherItems.length, 0);

    const resubmitPayload = {
        RequestId: request.ID, ExpectedVersion: revision.Version, ProfileVersion: profile.ProfileVersion,
        IdempotencyKey: 'integration-revision-resubmit',
        Remark: 'Keep telephone only.',
        Changes: [{ FieldCode: 'TELEPHONE', NewValue: '+84 900 222 333' }]
    };
    const resubmitted = await send('resubmitProfileChange', resubmitPayload, employee);
    const repeated = await send('resubmitProfileChange', resubmitPayload, employee);
    assert.equal(repeated.ID, resubmitted.ID);
    assert.equal(repeated.Version, resubmitted.Version);
    await assert.rejects(() => send('resubmitProfileChange', {
        ...resubmitPayload,
        Remark: 'Changed payload with reused key.'
    }, employee), error => error.code === 'IDEMPOTENCY_CONFLICT' || error.statusCode === 409);
    const locks = await cds.db.run(
        SELECT.from('znxr09.db.ProfileFieldLocks').where({ request_ID: request.ID })
    );
    assert.deepEqual(locks.map(lock => lock.fieldName), ['TELEPHONE']);
});

test('approval rejects a field changed after submission and preserves the pending request', async () => {
    const employee = user('employee8@example.com', '00000008');
    const hr = user('hr@example.com', '00000099', true);
    const profileRows = await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];
    const request = await send('submitProfileChange', {
        IdempotencyKey: 'integration-stale-field', ProfileVersion: profile.ProfileVersion,
        Remark: '', Changes: [{ FieldCode: 'TELEPHONE', NewValue: '+84 900 888 999' }]
    }, employee);

    await cds.db.run(UPDATE('znxr09.db.ProfileSnapshots').set({
        telephone: '+84 900 000 000', version: 2
    }).where({ employeePernr: '00000008' }));

    await assert.rejects(() => send('approveProfileChange', {
        RequestId: request.ID, ExpectedVersion: request.Version, HrComment: ''
    }, hr), error => error.code === 'STALE_PROFILE_FIELD' || error.statusCode === 409);
    const persisted = await cds.db.run(
        SELECT.one.from('znxr09.db.ProfileChangeRequests').where({ ID: request.ID })
    );
    assert.equal(persisted.status, '01');
    const locks = await cds.db.run(
        SELECT.from('znxr09.db.ProfileFieldLocks').where({ request_ID: request.ID })
    );
    assert.equal(locks.length, 1);
});

test('concurrent approval retries apply the request exactly once', async () => {
    const employee = user('employee9@example.com', '00000009');
    const hr = user('hr@example.com', '00000099', true);
    const profileRows = await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];
    const request = await send('submitProfileChange', {
        IdempotencyKey: 'integration-concurrent-approval', ProfileVersion: profile.ProfileVersion,
        Remark: '', Changes: [{ FieldCode: 'TELEPHONE', NewValue: '+84 900 999 111' }]
    }, employee);
    const decision = {
        RequestId: request.ID,
        ExpectedVersion: request.Version,
        HrComment: 'Concurrent retry test.'
    };

    const results = await Promise.allSettled([
        send('approveProfileChange', decision, hr),
        send('approveProfileChange', decision, hr)
    ]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);

    const persisted = await cds.db.run(
        SELECT.one.from('znxr09.db.ProfileChangeRequests').where({ ID: request.ID })
    );
    assert.equal(persisted.status, '02');
    assert.equal(persisted.version, 2);
    const snapshot = await cds.db.run(
        SELECT.one.from('znxr09.db.ProfileSnapshots').where({ employeePernr: '00000009' })
    );
    assert.equal(snapshot.telephone, '+84 900 999 111');
    assert.equal(snapshot.version, 2);
    const events = await cds.db.run(
        SELECT.from('znxr09.db.ProfileRequestEvents').where({ request_ID: request.ID, eventType: 'APPROVE' })
    );
    assert.equal(events.length, 1);
});

test('direct OData submit rejects a bank that is not in the active catalog', async () => {
    const employee = user('employee10@example.com', '00000010');
    const profileRows = await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];
    await assert.rejects(() => send('submitProfileChange', {
        IdempotencyKey: 'integration-invalid-bank', ProfileVersion: profile.ProfileVersion,
        Remark: '',
        Changes: [
            { FieldCode: 'PAY_METHOD', NewValue: 'T' },
            { FieldCode: 'BANK_COUNTRY', NewValue: 'VN' },
            { FieldCode: 'BANK_KEY', NewValue: 'NOT-IN-CATALOG' },
            { FieldCode: 'BANK_ACCT', NewValue: '001234567890123456' }
        ]
    }, employee), error => error.code === 'BANK_NOT_IN_CATALOG' || error.statusCode === 400);
});

test('cash approval clears all local bank snapshot fields atomically', async () => {
    const employee = user('employee11@example.com', '00000011');
    const hr = user('hr@example.com', '00000099', true);
    await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    await cds.db.run(UPDATE('znxr09.db.ProfileSnapshots').set({
        paymentMethod: 'T', bankCountry: 'VN', bankKey: 'LOCAL-DEMO',
        bankAccount: '001234567890123456', bankName: 'Local Demo Bank', version: 2
    }).where({ employeePernr: '00000011' }));
    const profileRows = await service.send(new cds.Request({
        event: 'READ', query: SELECT.from('ProfileService.MyProfile'), user: employee
    }));
    const profile = profileRows.Pernr ? profileRows : profileRows[0];
    const request = await send('submitProfileChange', {
        IdempotencyKey: 'integration-cash-clear', ProfileVersion: profile.ProfileVersion,
        Remark: '', Changes: [{ FieldCode: 'PAY_METHOD', NewValue: 'C' }]
    }, employee);
    await send('approveProfileChange', {
        RequestId: request.ID, ExpectedVersion: request.Version, HrComment: ''
    }, hr);

    const snapshot = await cds.db.run(
        SELECT.one.from('znxr09.db.ProfileSnapshots').where({ employeePernr: '00000011' })
    );
    assert.equal(snapshot.paymentMethod, 'C');
    assert.equal(snapshot.bankCountry, '');
    assert.equal(snapshot.bankKey, '');
    assert.equal(snapshot.bankAccount, '');
    assert.equal(snapshot.bankName, '');
});
