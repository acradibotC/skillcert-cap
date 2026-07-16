const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadValidator() {
    let exported;
    const sandbox = {
        sap: {
            ui: {
                define(dependencies, factory) {
                    assert.equal(dependencies.length, 0);
                    exported = factory();
                }
            }
        }
    };
    vm.runInNewContext(
        fs.readFileSync('app/profile/webapp/model/profileValidator.js', 'utf8'),
        sandbox,
        { filename: 'profileValidator.js' }
    );
    return exported;
}

const editableStates = Object.fromEntries([
    'WORK_EMAIL', 'TAX_CODE', 'CURR_ADDRESS', 'PAY_METHOD',
    'BANK_COUNTRY', 'BANK_KEY', 'BANK_ACCT'
].map(code => [code, { Editable: true, EffectiveEditable: true }]));

test('UI validator creates one atomic bank-transfer change set', () => {
    const validator = loadValidator();
    const original = {
        WORK_EMAIL: 'employee@example.com', TAX_CODE: '0123456789', CURR_ADDRESS: 'Hanoi',
        PAY_METHOD: 'C', BANK_COUNTRY: '', BANK_KEY: '', BANK_ACCT: ''
    };
    const values = {
        ...original,
        PAY_METHOD: 'T', BANK_COUNTRY: 'VN', BANK_KEY: 'LOCAL-DEMO', BANK_ACCT: '0012345678'
    };
    const result = validator.validateProfileChange(values, original, {
        states: editableStates,
        isBankTransfer: true,
        remark: ''
    });
    assert.equal(result.valid, true);
    assert.deepEqual(
        Array.from(result.changes, change => change.FieldCode),
        ['PAY_METHOD', 'BANK_COUNTRY', 'BANK_KEY', 'BANK_ACCT']
    );
});

test('UI validator rejects invalid email and 19-digit bank account', () => {
    const validator = loadValidator();
    const original = {
        WORK_EMAIL: 'employee@example.com', TAX_CODE: '0123456789', CURR_ADDRESS: 'Hanoi',
        PAY_METHOD: 'T', BANK_COUNTRY: 'VN', BANK_KEY: 'LOCAL-DEMO', BANK_ACCT: '0012345678'
    };
    const values = { ...original, WORK_EMAIL: 'invalid', BANK_ACCT: '1234567890123456789' };
    const result = validator.validateProfileChange(values, original, {
        states: editableStates,
        isBankTransfer: true,
        remark: ''
    });
    assert.equal(result.valid, false);
    assert.equal(result.errors.WORK_EMAIL, 'profileValidationEmail');
    assert.equal(result.errors.BANK_ACCT, 'profileValidationBankAccount');
});
