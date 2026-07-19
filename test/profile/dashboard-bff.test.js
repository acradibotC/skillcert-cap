const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serverSource = fs.readFileSync(path.join(__dirname, '../../srv/server.js'), 'utf8');

test('Dashboard BFF falls back to SAP WorkSchedule when a dedicated dashboard service is not configured', () => {
    assert.match(serverSource, /loadDashboardFromWorkSchedule/);
    assert.match(serverSource, /ZUI_NXR_WORKSCHEDULE_O4/);
    assert.match(serverSource, /\/WorkSchedule\?\$filter=/);
    assert.match(serverSource, /ZUI_NXR_SKILLREQ_O4/);
    assert.match(serverSource, /\/TeamMembers\?\$filter=/);
    assert.doesNotMatch(
        serverSource,
        /if \(!dashboardUrl\)\s*\{\s*return res\.status\(503\)\.json\(\{ error: 'Dashboard backend is not configured\.' \}\);\s*\}/
    );
});

test('Dashboard BFF keeps the 1-to-31-day server-side period guard', () => {
    assert.match(serverSource, /days >= 1 && days <= 31/);
    assert.match(serverSource, /Select a period from 1 to 31 days\./);
});
