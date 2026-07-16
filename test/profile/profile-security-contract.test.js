const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('server security defaults fail closed and preserve revoked identity links', () => {
    const source = fs.readFileSync('srv/server.js', 'utf8');

    assert.doesNotMatch(source, /NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]0['"]/);
    assert.doesNotMatch(source, /rejectUnauthorized\s*:\s*false/);
    assert.match(source, /SESSION_SECRET must be configured in production/);
    assert.match(source, /SAP technical credentials are not configured/);
    assert.match(source, /ProfileIdentityLinks/);
    assert.match(source, /IDENTITY_LINK_REVOKED/);
    assert.match(source, /where\(\{ provider, subject \}\)/);
    assert.doesNotMatch(source, /where\(\{ provider, subject, active: true \}\)/);
});

test('profile authorization is based on employee link or HR role, not manager status', () => {
    const source = fs.readFileSync('srv/profile-service.js', 'utf8');
    assert.match(source, /info\?\.pernr/);
    assert.match(source, /ProfileHRAdmin/);
    assert.doesNotMatch(source, /isManager[^\n]*ProfileHRAdmin/);
    assert.match(source, /SAP_PROFILE_ADAPTER_NOT_CONFIGURED/);
});
