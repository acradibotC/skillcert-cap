const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('attendance mail job uses SAP BCS and a durable idempotent mail log', () => {
    const tableSource = fs.readFileSync('sap/ztb_nxr_attmail.tabl.asddl', 'utf8');
    const jobSource = fs.readFileSync('sap/znxr_attreq_mail_job.prog.abap', 'utf8');

    assert.match(tableSource, /define table ztb_nxr_attmail/i);
    assert.match(tableSource, /key event_id\s+:\s+sysuuid_x16/i);
    assert.match(tableSource, /request_id\s+:\s+sysuuid_x16/i);
    assert.match(tableSource, /event_type\s+:\s+abap\.char\(20\)/i);
    assert.match(tableSource, /recipient_email\s+:\s+abap\.char\(241\)/i);
    assert.match(tableSource, /mail_status\s+:\s+abap\.char\(10\)/i);
    assert.match(tableSource, /retry_count\s+:\s+abap\.int4/i);

    assert.match(jobSource, /REPORT znxr_attreq_mail_job\./);
    assert.match(jobSource, /p_test\s+TYPE abap_bool AS CHECKBOX DEFAULT abap_true/);
    assert.match(jobSource, /FROM ztb_nxr_attreq/);
    assert.match(jobSource, /FROM ztb_nxr_attmail/);
    assert.match(jobSource, /AND event_type\s+=\s+@iv_event/);
    assert.match(jobSource, /AND recipient_email\s+=\s+@lv_recipient/);
    assert.match(jobSource, /gc_event_submitted[\s\S]*VALUE 'SUBMITTED'/);
    assert.match(jobSource, /gc_event_approved[\s\S]*VALUE 'APPROVED'/);
    assert.match(jobSource, /gc_event_rejected[\s\S]*VALUE 'REJECTED'/);
    assert.match(jobSource, /cl_bcs=>create_persistent/);
    assert.match(jobSource, /cl_document_bcs=>create_document/);
    assert.match(jobSource, /cl_cam_address_bcs=>create_internet_address/);
    assert.match(jobSource, /lo_request->send/);
    assert.match(jobSource, /EmployeeEmail[\s\S]*FROM zi_nxr_hr_team_members/i);
});
