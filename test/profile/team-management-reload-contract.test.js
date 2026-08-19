const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const component = fs.readFileSync('app/profile/webapp/Component.js', 'utf8');
const controller = fs.readFileSync('app/profile/webapp/controller/SkillList.controller.js', 'utf8');
const view = fs.readFileSync('app/profile/webapp/view/SkillList.view.xml', 'utf8');

test('Team Management keeps SAP load errors visible and supports retry after reload', () => {
    assert.match(component, /reloadTeamMembers\s*=\s*function/);
    assert.match(component, /fnFailTeamLoad/);
    assert.match(component, /setProperty\("\/loadState",\s*"error"\)/);
    assert.doesNotMatch(component, /catch\(function\s*\(oError\)[\s\S]*?fnFinish\(true,\s*\[\]\)/);
    assert.match(component, /ManagerUserId.*FilterOperator\.EQ/);
    assert.match(controller, /onRetryTeamMembers/);
    assert.match(controller, /sKey === "team"[\s\S]*reloadTeamMembers/);
    assert.match(view, /text="\{team>\/error\}"/);
    assert.match(view, /press="onRetryTeamMembers"/);
});
