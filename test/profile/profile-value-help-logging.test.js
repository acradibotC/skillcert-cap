const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('profile value-help failures emit safe actionable diagnostics', () => {
    const source = fs.readFileSync('srv/profile-service.js', 'utf8');

    assert.match(source, /\[ProfileService\] SAP profile value help failed:/);
    for (const field of [
        'service',
        'entity',
        'status',
        'code',
        'message',
        'correlationId',
        'filterFields',
        'usernameConfigured',
        'passwordConfigured'
    ]) {
        assert.match(source, new RegExp(`\\b${field}\\b`));
    }

    assert.match(source, /Basic\|Bearer/);
    assert.match(source, /authorization\|password\|passwd\|pwd\|token\|secret/);
    assert.doesNotMatch(
        source.match(/console\.error\('\[ProfileService\] SAP profile value help failed:'[\s\S]*?\n\s*}\);/)?.[0] || '',
        /process\.env\.UI5_(?:USERNAME|PASSWORD)\s*[},]/,
        'The diagnostic log must never print runtime credential values'
    );
});
