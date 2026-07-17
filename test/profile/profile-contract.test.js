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
    for (const property of ['DateOfBirth', 'Gender', 'Nationality', 'MaritalStatus']) {
        assert.match(edmx, new RegExp(`Property Name="${property}"`));
    }

    const employeeController = fs.readFileSync('app/profile/webapp/controller/MyProfile.controller.js', 'utf8');
    assert.match(employeeController, /\/MyProfile/);
    assert.match(employeeController, /\/MyProfileFields/);
    assert.doesNotMatch(employeeController, /\/MyProfileRequests/);
    assert.doesNotMatch(employeeController, /\/ProfilePaymentMethods/);
    assert.doesNotMatch(employeeController, /\/ProfileBanks/);
    assert.match(employeeController, /sLoadState === "error"[\s\S]*profileErrorServiceUnavailable/);

    const employeeView = fs.readFileSync('app/profile/webapp/view/MyProfile.view.xml', 'utf8');
    assert.match(employeeView, /profilePreviewEditButton/);
    assert.match(employeeView, /profilePreviewEditButton[\s\S]*?enabled="false"/);
    assert.match(employeeView, /visible="\{profile>\/HasBankTransfer\}"/);
    assert.match(employeeView, /profileReadOnlySap/);
    assert.doesNotMatch(employeeView, /profileRequestHistory/);
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
