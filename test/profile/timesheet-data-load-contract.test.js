const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const controller = fs.readFileSync(
    'app/timesheet/webapp/controller/App.controller.js',
    'utf8'
);

test('Timesheet starts schedule and request reads from the authenticated Pernr', () => {
    assert.match(controller, /String\(oLocalUser\.pernr \|\| ""\)\.trim\(\)/);
    assert.match(controller, /if \(sPernr\) \{[\s\S]*?_startEmployeeDataLoad\(sPernr/);
    assert.match(controller, /_startEmployeeDataLoad:[\s\S]*?_fetchWorkSchedule\(sPernr, iYear, oProfile\);[\s\S]*?_loadRequests\(\);/);
});

test('Timesheet fallback uses the case-sensitive SAP user id instead of OAuth email', () => {
    assert.match(controller, /oLocalUser\.sapUserId \|\| sEmail/);
    assert.match(controller, /encodeURIComponent\(sSapUserId\.replace/);
    assert.doesNotMatch(controller, /UserProfile\('\" \+ sEmail/);
});
