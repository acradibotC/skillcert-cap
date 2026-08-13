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

test('attendance notifications trigger from RAP workflow events without the scanner job', () => {
    const bdefSource = fs.readFileSync('sap/zi_nxr_attreq.bdef.asbdef', 'utf8');
    const definitionSource = fs.readFileSync('sap/zbp_i_nxr_attreq.clas.locals_def.abap', 'utf8');
    const implementationSource = fs.readFileSync('sap/zbp_i_nxr_attreq.clas.locals_imp.abap', 'utf8');
    const serviceSource = fs.readFileSync('srv/service.js', 'utf8');

    assert.match(bdefSource, /determination NotifySubmitted on modify \{ create; \}/i);
    assert.match(bdefSource, /action[\s\S]*Reject result \[1\] \$self/i);
    assert.match(definitionSource, /NotifySubmitted FOR DETERMINE ON MODIFY/i);
    assert.match(definitionSource, /send_notification/i);
    assert.match(implementationSource, /iv_event\s*=\s*'SUBMITTED'/i);
    assert.match(implementationSource, /iv_event\s*=\s*'APPROVED'/i);
    assert.match(implementationSource, /iv_event\s*=\s*'REJECTED'/i);
    assert.match(implementationSource, /cl_bcs=>create_persistent/i);
    assert.match(implementationSource, /CATCH cx_uuid_error/i);
    assert.match(implementationSource, /DATA\(lv_sent\)\s*=\s*lo_request->send/i);
    assert.match(implementationSource, /IF lv_sent = abap_true/i);
    assert.match(implementationSource, /mail_status\s*=\s*'SENT'/i);
    assert.match(implementationSource, /CATCH cx_root/i);
    assert.match(serviceSource, /zsd_nxr_attreq_post\.v0001\.Reject/i);
    assert.doesNotMatch(serviceSource, /UPDATE\('AttendanceRequest'\)[\s\S]*Status: '03'/i);
});
