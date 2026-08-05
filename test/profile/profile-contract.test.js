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
    assert.match(employeeController, /\/MyProfileRequests/);
    assert.doesNotMatch(employeeController, /Fragment\.load/);
    assert.match(employeeController, /_startProfileEdit/);
    assert.match(employeeController, /\/isEditingProfile/);
    assert.match(employeeController, /validator\.validateProfileChange/);
    assert.match(employeeController, /hasPendingRequest/);
    assert.match(employeeController, /executeAction\(this\._model\(\), oEdit\.isRevision \? "resubmitProfileChange" : "submitProfileChange"/);
    assert.match(employeeController, /submitProfileChange/);
    assert.match(employeeController, /onReviseProfileRequest/);
    assert.match(employeeController, /resubmitProfileChange/);
    assert.match(employeeController, /sLoadState === "error"[\s\S]*profileErrorServiceUnavailable/);

    const employeeView = fs.readFileSync('app/profile/webapp/view/MyProfile.view.xml', 'utf8');
    assert.match(employeeView, /profilePreviewEditButton/);
    assert.match(employeeView, /profilePreviewEditButton[\s\S]*?enabled="\{profileUi>\/hasEditableField\}"/);
    assert.match(employeeView, /profileInlineEditCard/);
    assert.match(employeeView, /visible="\{profileUi>\/isEditingProfile\}"/);
    assert.match(employeeView, /press="onEditProfile"/);
    assert.doesNotMatch(employeeView, /profileEmployeeIdInput/);
    assert.match(employeeView, /visible="\{profile>\/HasBankTransfer\}"/);
    assert.doesNotMatch(employeeView, /profileReadOnlySap/);
    assert.match(employeeView, /profileRequestHistory/);
    assert.match(employeeView, /profileRequestHistoryTable/);
    assert.match(employeeView, /profileResubmitButton/);
    assert.match(employeeView, /profileEditWorkflowNotice/);

    const approvalDialog = fs.readFileSync('app/profile/webapp/view/ProfileApprovalDetailDialog.fragment.xml', 'utf8');
    const profileCss = fs.readFileSync('app/profile/webapp/css/style.css', 'utf8');
    assert.match(approvalDialog, /headerText="\{i18n>profileHrComment\}"/);
    assert.match(approvalDialog, /profileDecisionPanel/);
    assert.match(approvalDialog, /profileHrCommentHelp/);
    assert.match(approvalDialog, /width="100%"/);
    assert.match(profileCss, /\.profileDecisionPanel/);
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
