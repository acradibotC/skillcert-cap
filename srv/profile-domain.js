const crypto = require('crypto');

const STATUS = Object.freeze({
    PENDING: '01',
    APPROVED: '02',
    REJECTED: '03',
    REVISION: '04'
});

const FIELD_CATALOG = Object.freeze({
    ID_NUMBER: {
        property: 'idNumber', maxLength: 20, group: 'PERSONAL', sensitive: true,
        mappingStatus: 'UNCONFIRMED', sapInfotype: '0185', sapSubtype: '', sapField: 'ICNUM'
    },
    TELEPHONE: {
        property: 'telephone', maxLength: 30, group: 'CONTACT',
        pattern: /^[+\d][\d\s().-]{6,29}$/,
        mappingStatus: 'UNCONFIRMED', sapInfotype: '0105', sapSubtype: '', sapField: 'USRID'
    },
    ADDRESS: {
        property: 'permanentAddress', maxLength: 60, group: 'CONTACT',
        mappingStatus: 'UNCONFIRMED', sapInfotype: '0006', sapSubtype: '1', sapField: 'STRAS'
    },
    WORK_EMAIL: {
        property: 'workEmail', maxLength: 241, group: 'CONTACT',
        pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        mappingStatus: 'CONFIRMED', sapInfotype: '0105', sapSubtype: '0010', sapField: 'USRID_LONG'
    },
    CURR_ADDRESS: {
        property: 'currentAddress', maxLength: 60, group: 'CONTACT',
        mappingStatus: 'UNCONFIRMED', sapInfotype: '0006', sapSubtype: '', sapField: 'STRAS'
    },
    TAX_CODE: {
        property: 'taxCode', maxLength: 10, group: 'PAYMENT', sensitive: true,
        pattern: /^\d{10}$/,
        mappingStatus: 'UNCONFIRMED', sapInfotype: '', sapSubtype: '', sapField: ''
    },
    PAY_METHOD: {
        property: 'paymentMethod', maxLength: 1, group: 'PAYMENT',
        values: ['C', 'T'],
        mappingStatus: 'CONFIRMED', sapInfotype: '0009', sapSubtype: '', sapField: 'ZLSCH'
    },
    BANK_COUNTRY: {
        property: 'bankCountry', maxLength: 3, group: 'PAYMENT',
        pattern: /^[A-Z]{2,3}$/,
        mappingStatus: 'CONFIRMED', sapInfotype: '0009', sapSubtype: '', sapField: 'BANKS'
    },
    BANK_KEY: {
        property: 'bankKey', maxLength: 15, group: 'PAYMENT',
        pattern: /^[A-Za-z0-9-]{1,15}$/,
        mappingStatus: 'CONFIRMED', sapInfotype: '0009', sapSubtype: '', sapField: 'BANKL'
    },
    BANK_ACCT: {
        property: 'bankAccount', maxLength: 18, group: 'PAYMENT', sensitive: true,
        pattern: /^\d{10,18}$/,
        mappingStatus: 'CONFIRMED', sapInfotype: '0009', sapSubtype: '', sapField: 'BANKN'
    }
});

function normalizeValue(value) {
    if (value === null || value === undefined) return '';
    return String(value).trim();
}

function stableHash(value) {
    return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function profileVersion(profile) {
    const values = Object.keys(FIELD_CATALOG).sort().map(fieldName => {
        const definition = FIELD_CATALOG[fieldName];
        return [fieldName, normalizeValue(profile?.[definition.property])];
    });
    return stableHash(values);
}

function validateChangeSet(currentProfile, rawChanges) {
    if (!Array.isArray(rawChanges) || rawChanges.length === 0) {
        return { errors: [{ code: 'NO_CHANGES', message: 'At least one change is required.' }], changes: [] };
    }

    const errors = [];
    const normalized = [];
    const seen = new Set();

    rawChanges.forEach((raw, index) => {
        const fieldName = String(raw?.fieldName || raw?.FieldName || raw?.FieldCode || '').trim().toUpperCase();
        const definition = FIELD_CATALOG[fieldName];
        if (!definition) {
            errors.push({ code: 'FIELD_NOT_EDITABLE', fieldName, message: `Field ${fieldName || index + 1} is not editable.` });
            return;
        }
        if (seen.has(fieldName)) {
            errors.push({ code: 'DUPLICATE_FIELD', fieldName, message: `Field ${fieldName} occurs more than once.` });
            return;
        }
        seen.add(fieldName);

        const newValue = normalizeValue(raw?.newValue ?? raw?.NewValue);
        const oldValue = normalizeValue(currentProfile?.[definition.property]);
        if (newValue.length > definition.maxLength) {
            errors.push({ code: 'MAX_LENGTH', fieldName, message: `${fieldName} exceeds ${definition.maxLength} characters.` });
        }
        if (definition.pattern && newValue && !definition.pattern.test(newValue)) {
            errors.push({ code: 'INVALID_FORMAT', fieldName, message: `${fieldName} has an invalid format.` });
        }
        if (definition.values && !definition.values.includes(newValue)) {
            errors.push({ code: 'INVALID_VALUE', fieldName, message: `${fieldName} must be one of ${definition.values.join(', ')}.` });
        }
        if (newValue === oldValue) return;

        normalized.push({
            fieldName,
            fieldGroup: definition.group,
            oldValue,
            newValue,
            oldValueHash: stableHash(oldValue),
            isSensitive: Boolean(definition.sensitive),
            mappingStatus: definition.mappingStatus,
            sapInfotype: definition.sapInfotype,
            sapSubtype: definition.sapSubtype,
            sapField: definition.sapField,
            property: definition.property
        });
    });

    if (normalized.length === 0 && errors.length === 0) {
        errors.push({ code: 'NO_EFFECTIVE_CHANGES', message: 'The submitted values are unchanged.' });
    }

    const finalProfile = { ...(currentProfile || {}) };
    normalized.forEach(change => { finalProfile[change.property] = change.newValue; });
    if (finalProfile.paymentMethod === 'T') {
        if (!normalizeValue(finalProfile.bankCountry)) {
            errors.push({ code: 'BANK_COUNTRY_REQUIRED', fieldName: 'BANK_COUNTRY', message: 'Bank country is required for bank transfer.' });
        }
        if (!normalizeValue(finalProfile.bankKey)) {
            errors.push({ code: 'BANK_KEY_REQUIRED', fieldName: 'BANK_KEY', message: 'Bank key is required for bank transfer.' });
        }
        if (!normalizeValue(finalProfile.bankAccount)) {
            errors.push({ code: 'BANK_ACCOUNT_REQUIRED', fieldName: 'BANK_ACCT', message: 'Bank account is required for bank transfer.' });
        }
    } else {
        const bankFields = ['BANK_COUNTRY', 'BANK_KEY', 'BANK_ACCT'];
        const invalidBankChange = normalized.find(change =>
            bankFields.includes(change.fieldName) && normalizeValue(change.newValue)
        );
        if (invalidBankChange) {
            errors.push({
                code: 'BANK_FIELDS_NOT_ALLOWED_FOR_CASH',
                fieldName: invalidBankChange.fieldName,
                message: 'Bank details must be empty when the payment method is cash.'
            });
        }
        const changedToCash = normalized.some(change =>
            change.fieldName === 'PAY_METHOD' && change.newValue === 'C'
        );
        if (changedToCash) {
            bankFields.forEach(fieldName => {
                const definition = FIELD_CATALOG[fieldName];
                const existing = normalized.find(change => change.fieldName === fieldName);
                if (existing) {
                    existing.newValue = '';
                } else {
                    const oldValue = normalizeValue(currentProfile?.[definition.property]);
                    if (oldValue) {
                        normalized.push({
                            fieldName,
                            fieldGroup: definition.group,
                            oldValue,
                            newValue: '',
                            oldValueHash: stableHash(oldValue),
                            isSensitive: Boolean(definition.sensitive),
                            mappingStatus: definition.mappingStatus,
                            sapInfotype: definition.sapInfotype,
                            sapSubtype: definition.sapSubtype,
                            sapField: definition.sapField,
                            property: definition.property
                        });
                    }
                }
                finalProfile[definition.property] = '';
            });
        }
    }

    return { errors, changes: normalized, finalProfile };
}

function canTransition(fromStatus, action) {
    const transitions = {
        requestChanges: [STATUS.PENDING],
        reject: [STATUS.PENDING],
        approve: [STATUS.PENDING],
        resubmit: [STATUS.REVISION]
    };
    return Boolean(transitions[action]?.includes(fromStatus));
}

function maskValue(value) {
    const normalized = normalizeValue(value);
    if (normalized.length <= 4) return normalized ? '*'.repeat(normalized.length) : '';
    return '*'.repeat(Math.max(4, normalized.length - 4)) + normalized.slice(-4);
}

function resolveProfileMode(env = process.env) {
    const mode = String(env.PROFILE_MODE || 'mock').toLowerCase();
    if (env.NODE_ENV === 'production' && mode !== 'sap') {
        throw Object.assign(new Error('PROFILE_MODE must be sap in production.'), { code: 'PROFILE_MODE_NOT_PRODUCTION_SAFE' });
    }
    if (!['mock', 'sap'].includes(mode)) {
        throw Object.assign(new Error('PROFILE_MODE must be mock or sap.'), { code: 'PROFILE_MODE_INVALID' });
    }
    return mode;
}

module.exports = {
    STATUS,
    FIELD_CATALOG,
    normalizeValue,
    stableHash,
    profileVersion,
    validateChangeSet,
    canTransition,
    maskValue,
    resolveProfileMode
};
