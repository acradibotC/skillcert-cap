const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const controller = fs.readFileSync('app/timesheet/webapp/controller/App.controller.js', 'utf8');
const view = fs.readFileSync('app/timesheet/webapp/view/App.view.xml', 'utf8');
const csn = fs.readFileSync('srv/external/ZUI_NXR_WORKSCHEDULE_O4.csn', 'utf8');
const sapDdl = fs.readFileSync('sap/zce_nxr_work_schedule.ddls.asddl', 'utf8');

test('Annual Leave quota reuses WorkSchedule metadata and renders a personal panel', () => {
    for (const field of [
        'QuotaType', 'QuotaName', 'QuotaEntitlement', 'QuotaUsed',
        'QuotaRemaining', 'QuotaUnit', 'QuotaValidFrom', 'QuotaValidTo'
    ]) {
        assert.match(csn, new RegExp('"' + field + '"'));
        assert.match(sapDdl, new RegExp('\\b' + field + '\\b'));
    }
    assert.match(view, /id="annualLeaveQuotaPanel"/);
    assert.match(view, /quota>\/remaining/);
    assert.match(view, /quota>\/unrequestedLeave/);
});

test('Unrequested Leave is capped at today and excludes approved DAYOFF dates', () => {
    assert.match(controller, /var sEffectiveTo = sPeriodTo < sAsOfDate \? sPeriodTo : sAsOfDate/);
    assert.match(controller, /if \(oRow\.dateKey > sEffectiveTo \|\| oApprovedLeaveByDate\.has\(oRow\.dateKey\)\) return fTotal/);
    assert.match(controller, /oRequest\.RequestType !== "DAYOFF" \|\| String\(oRequest\.Status\) !== "02"/);
    assert.match(controller, /iStatus === 3 && !oRow\.leaveType/);
});

test('Annual Leave sample uses SAP quota type 01 and day unit', () => {
    assert.match(sapDdl, /QuotaType\s+:\s+ktart/);
    assert.match(fs.readFileSync('sap/zcl_nxr_workschedule_query.clas.abap', 'utf8'), /lv_quota_type\s+TYPE ktart VALUE '01'/);
    assert.match(fs.readFileSync('sap/zcl_nxr_workschedule_query.clas.abap', 'utf8'), /ls_result-QuotaUnit\s*=\s+'DAY'/);
});

test('WorkSchedule does not mark the current date absent before the workday is complete', () => {
    const source = fs.readFileSync('sap/zcl_nxr_workschedule_query.clas.abap', 'utf8');
    assert.match(source, /ls_perws-datum\s+>=\s+sy-datum/);
});
