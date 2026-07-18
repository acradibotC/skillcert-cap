const assert = require('node:assert/strict');
const test = require('node:test');

const packageJson = require('../../package.json');

test('Skill RAP remote service enables CSRF handling at service level', () => {
    const service = packageJson.cds.requires.ZUI_NXR_SKILLREQ_O4;

    assert.equal(service.csrf, true);
    assert.equal(service.csrfInBatch, true);
    assert.equal(service.credentials.csrf, undefined);
});
