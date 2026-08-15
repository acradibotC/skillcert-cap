const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const controller = fs.readFileSync('app/profile/webapp/controller/MyProfile.controller.js', 'utf8');
const view = fs.readFileSync('app/profile/webapp/view/MyProfile.view.xml', 'utf8');

test('profile value-help dialogs use supported SelectDialog lifecycle handlers', () => {
    assert.doesNotMatch(controller, /attachAfterClose/);
    assert.match(controller, /oEvent\.getSource\(\)\.destroy\(\)/);
});

test('work e-mail is normalized and excluded from profile editing', () => {
    assert.match(controller, /oProfile\.WorkEmail\s*=\s*String\(oProfile\.WorkEmail\s*\|\|\s*""\)\.trim\(\)\.toLowerCase\(\)/);
    assert.match(controller, /oField\.FieldCode\s*!==\s*"WORK_EMAIL"/);
    assert.match(controller, /sCode\s*!==\s*"WORK_EMAIL"/);
    assert.doesNotMatch(controller, /WORK_EMAIL:\s*"profileWorkEmailInput"/);
    assert.match(view, /id="profileWorkEmailInput"[^\r\n]*editable="false"/);
});
