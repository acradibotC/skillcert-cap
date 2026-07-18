const test = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const { SELECT } = cds.ql;

let service;
let originalConnectTo;

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
        if (name === 'ZUI_NXR_SKILLREQ_O4') {
            return {
                run: async () => ({
                    UserId: 'HAONGUYEN022202@GMAIL.COM',
                    Pernr: '90000005',
                    EmployeeName: 'Ta Nam Son',
                    DateOfBirth: '1990-09-15',
                    Gender: 'Male',
                    Nationality: 'Vietnamese',
                    MaritalStatus: 'Married',
                    PositionId: '00001234',
                    PositionName: 'SAP Developer',
                    OrgUnitId: '00005678',
                    OrgUnitName: 'Technology',
                    IsManager: ''
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
    assert.equal(profile.DateOfBirth, '1990-09-15');
    assert.equal(profile.Gender, 'Male');
    assert.equal(profile.Nationality, 'Vietnamese');
    assert.equal(profile.MaritalStatus, 'Married');
    assert.equal(profile.IsSimulation, false);
    assert.equal(profile.IdNumber, '');
    assert.ok(profile.ProfileVersion);
});

test('MyProfileFields exposes the frontend-preview editable field catalog', async () => {
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

test('frontend preview does not query workflow persistence and keeps change actions disabled', async () => {
    const requests = await service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfileRequests'),
        user: user()
    }));
    assert.deepEqual(requests, []);

    await assert.rejects(() => service.send(new cds.Request({
        event: 'submitProfileChange',
        data: {},
        user: user()
    })), error => error.code === 'PROFILE_WORKFLOW_NOT_AVAILABLE' || error.statusCode === 501);
});

test('SAP profile must match the authenticated Pernr', async () => {
    await assert.rejects(() => service.send(new cds.Request({
        event: 'READ',
        query: SELECT.from('ProfileService.MyProfile'),
        user: user('other@example.com', '90000006')
    })), error => error.code === 'SAP_PROFILE_IDENTITY_MISMATCH' || error.statusCode === 403);
});
