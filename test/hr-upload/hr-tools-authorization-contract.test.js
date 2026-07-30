const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('HR Tools authorization is derived from SAP OrgUnitId and fails closed', () => {
    const source = fs.readFileSync('srv/server.js', 'utf8');

    assert.match(source, /HR_ORG_UNIT_IDS\s*\|\|\s*'50009040'/);
    assert.match(source, /orgUnitId:\s*String\(profile\.OrgUnitId/);
    assert.match(source, /canUseHrTools:\s*canUseHrTools\(profile\.OrgUnitId\)/);
    assert.match(source, /const ensureHrToolsAuthorized/);
    assert.match(source, /HR_TOOLS_FORBIDDEN/);
    assert.match(source, /app\.use\(\s*['"]\/hr-upload\/webapp['"][\s\S]*ensureHrToolsAuthorized/);
    assert.match(source, /app\.use\(['"]\/api\/v4['"][\s\S]*ensureHrToolsAuthorized\)/);
});

test('launchpad hides and guards HR navigation when permission is absent', () => {
    const controller = fs.readFileSync('app/launchpad/webapp/controller/App.controller.js', 'utf8');
    const view = fs.readFileSync('app/launchpad/webapp/view/App.view.xml', 'utf8');

    assert.match(controller, /canUseHrTools:\s*false/);
    assert.match(controller, /setProperty\(["']\/canUseHrTools["'],\s*oData\.canUseHrTools === true\)/);
    assert.match(controller, /onNavToHrTools:[\s\S]*getProperty\(["']\/canUseHrTools["']\)/);
    assert.match(controller, /onNavToHrUpload:[\s\S]*getProperty\(["']\/canUseHrTools["']\)/);
    assert.match(view, /<Button id="navHr"[^\r\n]*visible="\{user>\/canUseHrTools\}"/);
    assert.match(view, /header="\{i18n>tileHrUpload\}"[\s\S]*visible="\{user>\/canUseHrTools\}"/);
});
