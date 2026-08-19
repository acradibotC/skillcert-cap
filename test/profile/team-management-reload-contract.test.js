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
    assert.match(component, /fnReadTeamMembers\s*=\s*function/);
    assert.match(component, /aManagerIds\[iIndex\]/);
    assert.match(component, /getProperty\("\/pernr"\)/);
    assert.doesNotMatch(component, /new Filter\(\{\s*filters:\s*aManagerIds\.map/);
    assert.match(component, /pTeamMembersLoad/);
    assert.match(component, /transient empty response must not erase/);
    assert.match(component, /getProperty\("\/loadState"\)\s*===\s*"ready"[\s\S]*aCurrentTeam\.length\s*>\s*0/);
    assert.match(controller, /onRetryTeamMembers/);
    assert.match(controller, /sKey === "team"[\s\S]*reloadTeamMembers\(false\)/);
    assert.match(controller, /onRetryTeamMembers[\s\S]*reloadTeamMembers\(true\)/);
    assert.match(view, /text="\{team>\/error\}"/);
    assert.match(view, /press="onRetryTeamMembers"/);
});
