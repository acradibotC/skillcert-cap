const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('HR Tools authorization is derived from SAP OrgUnitId or configured HR email and fails closed', () => {
    const source = fs.readFileSync('srv/server.js', 'utf8');

    assert.match(source, /HR_ORG_UNIT_IDS\s*\|\|\s*'50009040'/);
    assert.match(source, /PROFILE_HR_EMAILS/);
    assert.match(source, /function canUseHrTools\(orgUnitId, email\)/);
    assert.match(source, /return isConfiguredProfileHrEmail\(email\) \|\| isHrOrgUnit\(orgUnitId\)/);
    assert.match(source, /orgUnitId:\s*String\(profile\.OrgUnitId/);
    assert.match(source, /canUseHrTools:\s*canUseHrTools\(profile\.OrgUnitId,\s*email\)/);
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

test('HR profile approvals are hosted by the HR Tools application', () => {
    const hrView = fs.readFileSync('app/hr-upload/webapp/view/App.view.xml', 'utf8');
    const hrController = fs.readFileSync('app/hr-upload/webapp/controller/App.controller.js', 'utf8');
    const hrComponent = fs.readFileSync('app/hr-upload/webapp/Component.js', 'utf8');
    const hrManifest = fs.readFileSync('app/hr-upload/webapp/manifest.json', 'utf8');
    const launchpadI18n = fs.readFileSync('app/launchpad/webapp/i18n/i18n.properties', 'utf8');
    const profileView = fs.readFileSync('app/profile/webapp/view/SkillList.view.xml', 'utf8');
    const launchpadController = fs.readFileSync('app/launchpad/webapp/controller/App.controller.js', 'utf8');

    assert.match(hrView, /<tnt:ToolPage[\s\S]*sideExpanded="\{hrTools>\/sideExpanded\}"/);
    assert.match(hrView, /<tnt:SideNavigation[\s\S]*selectedKey="\{hrTools>\/selectedTab\}"[\s\S]*itemSelect="\.onHrSideNavSelect"/);
    assert.match(hrView, /<tnt:NavigationListItem key="profileApprovals"[\s\S]*visible="\{user>\/isHrAdmin\}"/);
    assert.match(hrView, /viewName="znxr09\.znxr09f300\.view\.ProfileApprovalInbox"/);
    assert.match(hrController, /NavToHrToolsTab/);
    assert.match(hrController, /znxr09\.hrTools\.selectedTab/);
    assert.match(hrController, /sideExpanded:\s*true/);
    assert.match(hrController, /onHrSideNavSelect/);
    assert.match(hrController, /toggleNavigation/);
    assert.match(hrController, /getController\(\)\.activate/);
    assert.match(hrComponent, /"znxr09\/znxr09f300": "\/profile\/webapp"/);
    assert.match(hrManifest, /"profileService"/);
    assert.match(hrManifest, /"sap\.tnt"/);
    assert.match(launchpadI18n, /tileHrUpload=HR Tools/);
    assert.doesNotMatch(profileView, /key="profileApprovals"/);
    assert.match(launchpadController, /onNavToHrUpload\("profileApprovals"\)/);
});
