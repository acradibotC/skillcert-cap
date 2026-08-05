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
    assert.match(source, /p_land1\s+TYPE p0006-land1 DEFAULT 'VN'/);
    assert.match(source, /p_city\s+TYPE p0006-ort01 DEFAULT 'Unknown'/);
    assert.match(source, /ls_p0006-anssa\s+=\s+iv_subty/);
    assert.match(source, /ls_p0006-land1\s+=\s+p_land1/);
    assert.match(source, /ls_p0006-ort01\s+=\s+lv_city/);
    const apply0105 = source.match(/^FORM apply_0105[\s\S]*?^ENDFORM\./m)[0];
    const apply0006 = source.match(/^FORM apply_0006[\s\S]*?^ENDFORM\./m)[0];
    assert.doesNotMatch(apply0105, /lv_address|lv_city|lt_parts/);
    assert.match(apply0006, /lv_address[\s\S]*lv_city[\s\S]*lt_parts/);
    assert.doesNotMatch(source, /HR master-data posting FM is not configured/);
});
