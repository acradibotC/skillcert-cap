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
