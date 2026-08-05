const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('MyProfile apply job posts approved queued requests to HR infotypes', () => {
    const source = fs.readFileSync('sap/znxr_profile_apply_job.prog.abap', 'utf8');

    assert.match(source, /REPORT znxr_profile_apply_job\./);
    assert.match(source, /p_test\s+TYPE abap_bool AS CHECKBOX DEFAULT abap_true/);
    assert.match(source, /WHERE status\s+=\s+@gc_status_approved[\s\S]*AND apply_state\s+=\s+@gc_state_queued/);
    assert.match(source, /BAPI_EMPLOYEE_ENQUEUE/);
    assert.match(source, /BAPI_EMPLOYEE_DEQUEUE/);
    assert.match(source, /HR_INFOTYPE_OPERATION/);
    assert.match(source, /gc_infty_0105[\s\S]*VALUE '0105'/);
    assert.match(source, /gc_infty_0006[\s\S]*VALUE '0006'/);
    assert.match(source, /gc_infty_0009[\s\S]*VALUE '0009'/);
    assert.match(source, /gc_infty_0185[\s\S]*VALUE '0185'/);
    assert.match(source, /gc_state_applied[\s\S]*VALUE 'APPLIED'/);
    assert.doesNotMatch(source, /HR master-data posting FM is not configured/);
});
