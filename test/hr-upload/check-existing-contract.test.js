const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const serviceCds = fs.readFileSync('srv/service.cds', 'utf8');
const serviceJs = fs.readFileSync('srv/service.js', 'utf8');
const controller = fs.readFileSync(
    'app/hr-upload/webapp/controller/App.controller.js',
    'utf8'
);

test('checkExisting accepts exact employee/date keys instead of whole months', () => {
    assert.match(
        serviceCds,
        /action checkExisting\(records: array of WorktimeKey\)/
    );
    assert.match(controller, /JSON\.stringify\(\{ records: aKeys \}\)/);
    assert.doesNotMatch(controller, /JSON\.stringify\(\{ months:/);
});

test('checkExisting reads actual SAP attendance from WorkSchedule', () => {
    assert.match(
        serviceJs,
        /cds\.connect\.to\('ZUI_NXR_WORKSCHEDULE_O4'\)/
    );
    assert.match(
        serviceJs,
        /\.columns\('Pernr', 'WorkDate', 'ActualStartTime', 'ActualEndTime'\)/
    );
    assert.match(
        serviceJs,
        /\.where\(\{ Pernr: pernr, WorkDate: firstRequestedDate \}\)[\s\S]*?\.limit\(5000\)/
    );
    assert.match(
        serviceJs,
        /actualStart !== '000000' \|\| actualEnd !== '000000'/
    );
});

test('checkExisting returns and displays the exact existing dates', () => {
    assert.match(serviceCds, /dates : array of Date/);
    assert.match(controller, /msgExistingSapData/);
    assert.match(controller, /parts\[2\] \+ "\/" \+ parts\[1\] \+ "\/" \+ parts\[0\]/);
});
