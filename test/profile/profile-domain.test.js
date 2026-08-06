const test = require('node:test');
const assert = require('node:assert/strict');
const {
    STATUS,
    validateChangeSet,
    canTransition,
    maskValue,
    resolveProfileMode
} = require('../../srv/profile-domain');

const baseProfile = {
    workEmail: 'employee@example.com',
    telephone: '+84 900 000 000',
    permanentAddress: 'Hanoi',
    currentAddress: 'Hanoi',
    taxCode: '0123456789',
    paymentMethod: 'C',
    bankAccount: '',
    bankName: ''
};

test('validates a normal multi-field change', () => {
    const result = validateChangeSet(baseProfile, [
        { fieldName: 'WORK_EMAIL', newValue: 'new@example.com' },
        { fieldName: 'CURR_ADDRESS', newValue: 'Da Nang' }
    ]);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(result.changes.map(change => change.fieldName), ['WORK_EMAIL', 'CURR_ADDRESS']);
});

test('rejects invalid email and no-longer-editable tax code', () => {
    const result = validateChangeSet(baseProfile, [
        { fieldName: 'WORK_EMAIL', newValue: 'invalid' },
        { fieldName: 'TAX_CODE', newValue: '123' }
    ]);
    assert.deepEqual(result.errors.map(error => error.code), ['INVALID_FORMAT', 'FIELD_NOT_EDITABLE']);
});

test('telephone must start with a digit or plus sign', () => {
    const result = validateChangeSet(baseProfile, [
        { fieldName: 'TELEPHONE', newValue: '.......' }
    ]);
    assert.ok(result.errors.some(error => error.code === 'INVALID_FORMAT'));
});

test('bank transfer requires account and bank', () => {
    const result = validateChangeSet(baseProfile, [{ fieldName: 'PAY_METHOD', newValue: 'T' }]);
    assert.ok(result.errors.some(error => error.code === 'BANK_ACCOUNT_REQUIRED'));
    assert.ok(result.errors.some(error => error.code === 'BANK_COUNTRY_REQUIRED'));
    assert.ok(result.errors.some(error => error.code === 'BANK_KEY_REQUIRED'));
});

test('bank account preserves leading zero and accepts 18 digits', () => {
    const result = validateChangeSet(baseProfile, [
        { fieldName: 'PAY_METHOD', newValue: 'T' },
        { fieldName: 'BANK_COUNTRY', newValue: 'VN' },
        { fieldName: 'BANK_KEY', newValue: 'LOCAL-DEMO' },
        { fieldName: 'BANK_ACCT', newValue: '001234567890123456' }
    ]);
    assert.equal(result.errors.length, 0);
    assert.equal(result.changes.find(change => change.fieldName === 'BANK_ACCT').newValue, '001234567890123456');
});

test('switching from transfer to cash clears persisted bank details', () => {
    const transferProfile = {
        ...baseProfile,
        paymentMethod: 'T',
        bankCountry: 'VN',
        bankKey: 'LOCAL-DEMO',
        bankAccount: '001234567890123456',
        bankName: 'Local Demo Bank'
    };
    const result = validateChangeSet(transferProfile, [
        { fieldName: 'PAY_METHOD', newValue: 'C' }
    ]);
    assert.equal(result.errors.length, 0);
    assert.deepEqual(
        Object.fromEntries(result.changes.map(change => [change.fieldName, change.newValue])),
        { PAY_METHOD: 'C', BANK_COUNTRY: '', BANK_KEY: '', BANK_ACCT: '' }
    );
});

test('rejects unchanged and duplicate fields', () => {
    const unchanged = validateChangeSet(baseProfile, [{ fieldName: 'WORK_EMAIL', newValue: baseProfile.workEmail }]);
    assert.equal(unchanged.errors[0].code, 'NO_EFFECTIVE_CHANGES');
    const duplicate = validateChangeSet(baseProfile, [
        { fieldName: 'ADDRESS', newValue: 'A' },
        { fieldName: 'ADDRESS', newValue: 'B' }
    ]);
    assert.ok(duplicate.errors.some(error => error.code === 'DUPLICATE_FIELD'));
});

test('enforces the 01/02/03/04 state machine', () => {
    assert.equal(canTransition(STATUS.PENDING, 'approve'), true);
    assert.equal(canTransition(STATUS.PENDING, 'requestChanges'), true);
    assert.equal(canTransition(STATUS.REVISION, 'resubmit'), true);
    assert.equal(canTransition(STATUS.APPROVED, 'resubmit'), false);
});

test('masks sensitive values', () => {
    assert.equal(maskValue('001234567890'), '********7890');
});

test('production cannot run with mock mode', () => {
    assert.throws(() => resolveProfileMode({ NODE_ENV: 'production', PROFILE_MODE: 'mock' }), /must be sap/);
    assert.equal(resolveProfileMode({ NODE_ENV: 'test', PROFILE_MODE: 'mock' }), 'mock');
});
