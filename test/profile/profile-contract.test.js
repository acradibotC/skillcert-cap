const test = require('node:test');
const assert = require('node:assert/strict');
const cds = require('@sap/cds');
const fs = require('node:fs');

test('ProfileService metadata matches the UI contract', async () => {
    const model = await cds.load('srv/service.cds');
    const edmx = cds.compile.to.edmx(model, { service: 'ProfileService' });

    for (const entitySet of [
        'MyProfile',
        'MyProfileFields',
        'MyProfileRequests',
        'MyProfileRequestItems',
        'ProfileApprovalRequests',
        'ProfileApprovalRequestItems',
        'ProfileRequestEvents',
        'ProfilePaymentMethods',
        'ProfileBanks'
    ]) {
        assert.match(edmx, new RegExp(`EntitySet Name="${entitySet}"`));
    }

    assert.match(edmx, /Action Name="submitProfileChange" IsBound="false"/);
    assert.match(edmx, /Parameter Name="IdempotencyKey"/);
    assert.match(edmx, /Parameter Name="Changes" Type="Collection\(ProfileService\.ProfileChangeInput\)"/);
    assert.match(edmx, /Action Name="resubmitProfileChange" IsBound="false"[\s\S]*?Parameter Name="IdempotencyKey"/);
    assert.match(edmx, /Action Name="approveProfileChange" IsBound="false"/);
    assert.match(edmx, /Parameter Name="ExpectedVersion"/);

    const uiContract = [
        fs.readFileSync('app/profile/webapp/controller/MyProfile.controller.js', 'utf8'),
        fs.readFileSync('app/profile/webapp/controller/ProfileApprovalInbox.controller.js', 'utf8')
    ].join('\n');
    for (const entitySet of [
        'MyProfile', 'MyProfileFields', 'MyProfileRequests', 'MyProfileRequestItems', 'ProfileApprovalRequests',
        'ProfileApprovalRequestItems', 'ProfileRequestEvents', 'ProfilePaymentMethods', 'ProfileBanks'
    ]) {
        assert.match(uiContract, new RegExp(`/${entitySet}`));
    }

    const employeeController = fs.readFileSync('app/profile/webapp/controller/MyProfile.controller.js', 'utf8');
    assert.match(employeeController, /sLoadState === "error"[\s\S]*profileErrorServiceUnavailable/);
});

test('existing skill approval actions remain explicitly unbound', async () => {
    const model = await cds.load('srv/service.cds');
    const edmx = cds.compile.to.edmx(model, { service: 'SkillService' });
    assert.match(edmx, /Action Name="approveRequest" IsBound="false"/);
    assert.match(edmx, /Action Name="rejectRequest" IsBound="false"/);

    for (const controllerPath of [
        'app/profile/webapp/controller/SkillList.controller.js',
        'app/profile/webapp/controller/CertDetail.controller.js'
    ]) {
        const source = fs.readFileSync(controllerPath, 'utf8');
        assert.doesNotMatch(source, /com\.sap\.gateway.*(?:approveRequest|rejectRequest)/);
        assert.match(source, /bindContext\("\/approveRequest\(\.\.\.\)"\)/);
        assert.match(source, /setParameter\("RequestId"/);
    }
});
