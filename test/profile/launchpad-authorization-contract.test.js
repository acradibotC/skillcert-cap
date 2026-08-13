const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('app/launchpad/webapp/controller/App.controller.js', 'utf8');

test('launchpad fails closed when currentUser authorization check fails', () => {
    assert.match(source, /error:\s*function\s*\(jqXHR\)/);
    assert.match(source, /oUserModel\.setProperty\("\/authorized",\s*false\)/);
    assert.match(source, /responseJSON/);
    assert.match(source, /responseText/);
    assert.match(source, /this\.byId\("errorMessage"\)\.setText\(sMsg\)/);
    assert.match(source, /this\.byId\("navContainer"\)\.to\(this\.byId\("errorPage"\)\)/);
    assert.doesNotMatch(source, /error:\s*function\s*\(jqXHR\)[\s\S]*?authorized",\s*true/);
});

test('launchpad contains the full-screen unmapped-account page', () => {
    const view = fs.readFileSync('app/launchpad/webapp/view/App.view.xml', 'utf8');

    assert.match(view, /id="errorPage"/);
    assert.match(view, /id="errorMessage"/);
    assert.match(view, /press="\.onRetryAuth"/);
    assert.match(view, /press="\.onLogout"/);
});
