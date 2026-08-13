const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('znxr_attreq_sync_job.prog.abap', 'utf8');
const controller = fs.readFileSync('app/timesheet/webapp/controller/App.controller.js', 'utf8');
const service = fs.readFileSync('srv/service.js', 'utf8');

test('WFH keeps one request type and sends the attendance times needed by PA2002', () => {
    assert.match(controller, /getTimeKey: function \(oDate\)/);
    assert.match(controller, /if \(sTab === "WFH"\)[\s\S]*?CorrectedStartTime = this\.getTimeKey\(doStart\)/);
    assert.match(controller, /if \(sTab === "WFH"\)[\s\S]*?CorrectedEndTime = this\.getTimeKey\(doEnd\)/);
    assert.match(service, /if \(data\.RequestType === 'WFH'\)[\s\S]*?CorrectedStartTime = data\.CorrectedStartTime \|\| '08:00:00'/);
    assert.match(service, /if \(data\.RequestType === 'WFH'\)[\s\S]*?CorrectedEndTime = data\.CorrectedEndTime \|\| '17:30:00'/);
});

test('WFH is mapped to PA2002 subtype 0800 with a fallback time and verification', () => {
    assert.match(source, /WHEN 'EDIT_TIMESHEET' OR 'WFH' OR 'WORK_FROM_HOME'/);
    assert.match(source, /WHEN 'WFH'\.\s+lv_subty = '0800'/);
    assert.match(source, /request_type = 'WFH'[\s\S]*?lv_time_start = '080000'/);
    assert.match(source, /request_type = 'WFH'[\s\S]*?lv_time_end = '173000'/);
    assert.match(source, /request_type = 'WFH'[\s\S]*?stdaz = \( lv_end_seconds - lv_start_seconds \) \/ 3600/);
    assert.match(source, /request_type = 'WFH'[\s\S]*?PA2002 verification failed after infotype operation/);
});

test('Overtime is mapped to PA2005 and verified after posting', () => {
    assert.match(source, /WHEN 'OVERTIME'\.[\s\S]*?lv_infty = '2005'/);
    assert.match(source, /WHEN 'OVERTIME'\.[\s\S]*?lv_subty = space/);
    assert.match(source, /ls_p2005-beguz = lv_time_start/);
    assert.match(source, /ls_p2005-enduz = lv_time_end/);
    assert.match(source, /ls_p2005-stdaz = \( lv_end_seconds - lv_start_seconds \) \/ 3600/);
    assert.match(source, /ls_p2005-punb1 = <ls_req>-ot_break_hours/);
    assert.match(source, /PA2005 verification failed after overtime operation/);
    assert.match(source, /Updated existing PA2005 overtime and verified/);
    assert.match(source, /Inserted PA2005 overtime and verified/);
    assert.doesNotMatch(source, /WHEN 'OVERTIME'\.\s+lv_subty = '0900'/);
});

test('Edit Timesheet modifies one existing PA2002 record and inserts only when absent', () => {
    assert.match(source, /request_type = 'EDIT_TIMESHEET'/);
    assert.match(source, /FROM pa2002[\s\S]*?subty = @lv_subty[\s\S]*?sprps = @space/);
    assert.match(source, /CASE lines\( lt_existing_p2002 \)/);
    assert.match(source, /WHEN 0\.[\s\S]*?lv_operation = 'INS'/);
    assert.match(source, /WHEN 1\.[\s\S]*?lv_operation = 'MOD'/);
    assert.match(source, /recordnumber\s+= lv_seqnr/);
    assert.match(source, /operation\s+= lv_operation/);
});

test('Edit Timesheet fails closed when the target date has multiple active records', () => {
    assert.match(
        source,
        /Multiple active PA2002 subtype 0800 records exist for this date\./
    );
});

test('Edit Timesheet is marked successful only after PA2002 verification', () => {
    const verificationPosition = source.indexOf(
        'PA2002 verification failed after infotype operation.'
    );
    const successUpdatePosition = source.indexOf(
        "SET sap_post_status = 'SUCCESS'"
    );

    assert.ok(verificationPosition > 0);
    assert.ok(successUpdatePosition > verificationPosition);
    assert.match(source, /SELECT COUNT\( \* \)[\s\S]*?lv_active_p2002_count <> 1/);
    assert.match(source, /COMMIT WORK AND WAIT\.[\s\S]*?SELECT SINGLE seqnr[\s\S]*?beguz = @lv_time_start[\s\S]*?enduz = @lv_time_end/);
    assert.doesNotMatch(source, /stdaz = @ls_p2002-stdaz/);
    assert.match(source, /stdaz > 0/);
    assert.match(source, /Updated existing PA2002 subtype/);
    assert.match(source, /Inserted PA2002 subtype/);
});
