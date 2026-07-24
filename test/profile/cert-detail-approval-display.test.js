const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const viewPath = 'app/profile/webapp/view/CertDetail.view.xml';
const controllerPath = 'app/profile/webapp/controller/CertDetail.controller.js';
const i18nPath = 'app/profile/webapp/i18n/i18n.properties';
const i18nEnPath = 'app/profile/webapp/i18n/i18n_en.properties';
const i18nViPath = 'app/profile/webapp/i18n/i18n_vi.properties';

test('certificate detail must not present SAP audit user as business approver', () => {
    const viewSource = fs.readFileSync(viewPath, 'utf8');
    const controllerSource = fs.readFileSync(controllerPath, 'utf8');

    assert.match(viewSource, /formatter:\s*'\.formatApprovalActor'/);
    assert.match(viewSource, /odata>DecisionName/);
    assert.match(viewSource, /odata>DecisionUserId/);
    assert.match(viewSource, /odata>DecisionAt/);
    assert.doesNotMatch(viewSource, /\$\{odata>LastChangedBy\}\s*\?\s*\$\{odata>LastChangedBy\}/);
    assert.doesNotMatch(
        viewSource,
        /<Label text="\{i18n>lblApprover\}"\/>[\s\S]{0,500}?LastChangedBy/,
        'approval information must not label LastChangedBy as Approver'
    );
    assert.match(viewSource, /lblSapAuditUser/);

    assert.match(controllerSource, /formatApprovalActor:\s*function/);
    assert.match(controllerSource, /sDecisionName/);
    assert.match(controllerSource, /sDecisionUserId/);
    assert.match(controllerSource, /formatApprovalDate:\s*function/);
    assert.match(controllerSource, /_isAutoApprovedAtCreation:\s*function/);
    assert.match(controllerSource, /approvalAutoCreated/);
    assert.match(controllerSource, /approvalActorNotExposed/);
});

test('certificate detail must prefer SAP business decision fields when exposed', () => {
    const controllerSource = fs.readFileSync(controllerPath, 'utf8');

    assert.match(
        controllerSource,
        /if \(sDecisionName\) \{\s*return sDecisionName;\s*\}/,
        'DecisionName must be rendered before any RAP audit fallback'
    );
    assert.match(
        controllerSource,
        /if \(sDecisionUserId\) \{\s*return sDecisionUserId;\s*\}/,
        'DecisionUserId must be rendered before any RAP audit fallback'
    );
    assert.match(
        controllerSource,
        /return vDecisionAt \|\| vLastChangedAt \|\| "";/,
        'DecisionAt must be the primary approval date when SAP exposes it'
    );
});

test('approval display i18n texts explain missing business approver contract', () => {
    for (const path of [i18nPath, i18nEnPath, i18nViPath]) {
        const source = fs.readFileSync(path, 'utf8');
        assert.match(source, /detailApprover=/);
        assert.match(source, /lblApprovalHandler=/);
        assert.match(source, /lblSapAuditUser=/);
        assert.match(source, /approvalPending=/);
        assert.match(source, /approvalAutoCreated=/);
        assert.match(source, /approvalActorNotExposed=/);
        assert.match(source, /rejectionActorNotExposed=/);
        assert.match(source, /approvalActorNotCaptured=/);
    }
});
