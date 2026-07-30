const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('znxr_attreq_sync_job.prog.abap', 'utf8');

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
    assert.match(source, /Updated existing PA2002 subtype 0800 and verified\./);
    assert.match(source, /Inserted PA2002 subtype 0800 and verified\./);
});
