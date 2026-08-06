const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const controllerPath = 'app/profile/webapp/controller/SkillList.controller.js';
const viewPath = 'app/profile/webapp/view/SkillList.view.xml';

test('personal skill and certification tables keep deferred loading but activate on filters', () => {
    const controllerSource = fs.readFileSync(controllerPath, 'utf8');
    const viewSource = fs.readFileSync(viewPath, 'utf8');

    assert.match(viewSource, /id="mySkillsTable"[\s\S]*?suspended:\s*true/);
    assert.match(viewSource, /id="myCertsTable"[\s\S]*?suspended:\s*true/);

    assert.match(controllerSource, /_activateTableBinding:\s*function/);
    assert.match(controllerSource, /if\s*\(\s*oBinding\.isSuspended\s*&&\s*oBinding\.isSuspended\(\)\s*\)\s*\{[\s\S]*?oBinding\.resume\(\)/);
    assert.match(controllerSource, /_applyTableFilters:\s*function[\s\S]*?oBinding\.filter[\s\S]*?this\._activateTableBinding\(oTable\)/);
    assert.match(controllerSource, /_refreshPersonalTable:\s*function[\s\S]*?this\._applyTableFilters\(oTable,\s*sQuery\)[\s\S]*?this\._activateTableBinding\(oTable,\s*!!bForceRefresh\)/);
});

test('frontend skill create keeps SAP as workflow status source of truth', () => {
    const controllerSource = fs.readFileSync(controllerPath, 'utf8');
    const payloadMatch = controllerSource.match(/var oNewRequest = \{([\s\S]*?)\n            \};/);

    assert.ok(payloadMatch, 'create payload should be readable');
    assert.match(payloadMatch[1], /ReqType:/);
    assert.match(payloadMatch[1], /Pernr:/);
    assert.doesNotMatch(payloadMatch[1], /Status\s*:/);
    assert.match(controllerSource, /bindList\("\/Request"\)/);
});

test('skill detail navigation keeps embedded Profile route inside Launchpad', () => {
    const controllerSource = fs.readFileSync(controllerPath, 'utf8');
    const launchpadSource = fs.readFileSync('app/launchpad/webapp/controller/App.controller.js', 'utf8');

    assert.match(controllerSource, /var sRequestId = oContext\.getProperty\("RequestId"\);/);
    assert.match(controllerSource, /if\s*\(!sRequestId\)\s*\{/);
    assert.match(controllerSource, /certIndex:\s*encodeURIComponent\(String\(sRequestId\)\)/);
    assert.match(launchpadSource, /Embedded UI5 applications/);
    assert.match(launchpadSource, /cert\|skill\|request/);
    assert.match(launchpadSource, /bProfileShellRoute/);
});

test('My Profile navigation has an icon-only collapse toggle that preserves the active tab', () => {
    const controllerSource = fs.readFileSync(controllerPath, 'utf8');
    const viewSource = fs.readFileSync(viewPath, 'utf8');

    assert.match(viewSource, /sideExpanded="\{view>\/sideExpanded\}"/);
    assert.match(viewSource, /selectedKey="\{= \$\{view>\/selectedTab\} \}"/);

    const toggleStart = viewSource.lastIndexOf('<tnt:NavigationListItem', viewSource.indexOf('key="toggleNavigation"'));
    const toggleEnd = viewSource.indexOf('/>', toggleStart);
    const toggleItem = viewSource.slice(toggleStart, toggleEnd);

    assert.match(toggleItem, /key="toggleNavigation"/);
    assert.match(toggleItem, /icon="sap-icon:\/\/menu2"/);
    assert.match(toggleItem, /tooltip="\{i18n>tooltipToggleMenu\}"/);
    assert.doesNotMatch(toggleItem, /\btext=/);

    assert.match(controllerSource, /sideExpanded: true/);
    assert.match(controllerSource, /if \(sKey === "toggleNavigation"\)/);
    assert.match(controllerSource, /setProperty\("\/sideExpanded", bSideExpanded\)/);
    assert.match(controllerSource, /setSelectedKey\(sSelectedTab\)/);
});

test('My Profile no longer exposes the Dashboard tab or placeholder content', () => {
    const viewSource = fs.readFileSync(viewPath, 'utf8');

    assert.doesNotMatch(viewSource, /key="dashboard"/);
    assert.doesNotMatch(viewSource, /selectedTab\}\s*===\s*'dashboard'/);
    assert.doesNotMatch(viewSource, /Dashboard content placeholder/);
});

test('Profile and HR Tools tabs use the shared TimeSheet page header', () => {
    const profileView = fs.readFileSync(viewPath, 'utf8');
    const profileCss = fs.readFileSync('app/profile/webapp/css/style.css', 'utf8');
    const hrView = fs.readFileSync('app/hr-upload/webapp/view/App.view.xml', 'utf8');
    const hrInboxView = fs.readFileSync('app/profile/webapp/view/ProfileApprovalInbox.view.xml', 'utf8');
    const hrI18n = fs.readFileSync('app/hr-upload/webapp/i18n/i18n.properties', 'utf8');

    assert.match(profileView, /timesheetPageHeader[\s\S]*tabMySkills/);
    assert.match(profileView, /timesheetPageHeader[\s\S]*tabMyCerts/);
    assert.match(profileView, /timesheetPageHeader[\s\S]*tabTeamMgmt/);
    assert.match(profileCss, /\.timesheetPageHeader/);
    assert.match(profileCss, /\.timesheetHeaderTitle/);
    assert.match(hrView, /sap-icon:\/\/approvals[\s\S]*profileApprovalPageTitle/);
    assert.match(hrI18n, /profileApprovalPageTitle=HR Profile Approvals/);
    assert.doesNotMatch(hrInboxView, /<Title text="\{i18n>profileApprovalInboxTitle\}"/);
});
