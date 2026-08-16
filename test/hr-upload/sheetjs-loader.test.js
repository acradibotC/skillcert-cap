const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadController(windowObject, documentObject) {
    let controller;
    const Controller = {
        extend(_name, definition) {
            controller = definition;
            return definition;
        }
    };
    class JSONModel {}
    const sandbox = {
        window: windowObject,
        document: documentObject,
        Promise,
        Error,
        FileReader: function () {},
        setTimeout,
        sap: {
            ui: {
                define(_dependencies, factory) {
                    factory(
                        Controller,
                        JSONModel,
                        { error() {}, warning() {}, information() {}, confirm() {}, Action: { OK: 'OK' } },
                        { show() {} },
                        function () {},
                        function () {},
                        function () {}
                    );
                }
            }
        }
    };
    vm.runInNewContext(
        fs.readFileSync('app/hr-upload/webapp/controller/App.controller.js', 'utf8'),
        sandbox,
        { filename: 'App.controller.js' }
    );
    return controller;
}

function sheetJs(parseDateCode) {
    return {
        read() {},
        utils: { sheet_to_json() {} },
        SSF: {
            parse_date_code: parseDateCode || function () {
                return { y: 2026, m: 8, d: 8 };
            }
        }
    };
}

test('SheetJS readiness rejects the stale empty XLSX object', () => {
    const controller = loadController({ XLSX: {} }, {});
    assert.equal(controller._isSheetJsReady(), false);
});

test('SheetJS readiness requires read, sheet_to_json, and calendar-safe date APIs', () => {
    const controller = loadController({ XLSX: sheetJs() }, {});
    assert.equal(controller._isSheetJsReady(), true);
});

test('SheetJS readiness rejects an incomplete date parser', () => {
    const controller = loadController({
        XLSX: {
            read() {},
            utils: { sheet_to_json() {} }
        }
    }, {});
    assert.equal(controller._isSheetJsReady(), false);
});

test('SheetJS loader replaces a stale global and resolves only after API validation', async () => {
    const windowObject = { XLSX: {} };
    const documentObject = {
        createElement() {
            return {
                setAttribute() {},
                parentNode: null
            };
        },
        head: {
            appendChild(script) {
                script.parentNode = this;
                windowObject.XLSX = sheetJs();
                script.onload();
            },
            removeChild() {}
        }
    };
    const controller = loadController(windowObject, documentObject);
    const result = await controller._ensureSheetJs();
    assert.equal(result, windowObject.XLSX);
    assert.equal(typeof result.read, 'function');
    assert.equal(typeof result.utils.sheet_to_json, 'function');
});

test('failed SheetJS load clears the promise so a later Parse can retry', async () => {
    let appendCount = 0;
    const windowObject = { XLSX: {} };
    const documentObject = {
        createElement() {
            return {
                setAttribute() {},
                parentNode: null
            };
        },
        head: {
            appendChild(script) {
                appendCount++;
                script.parentNode = this;
                script.onerror();
            },
            removeChild(script) {
                script.parentNode = null;
            }
        }
    };
    const controller = loadController(windowObject, documentObject);
    await assert.rejects(controller._ensureSheetJs(), /Could not load/);
    assert.equal(controller._sheetJsPromise, null);
    await assert.rejects(controller._ensureSheetJs(), /Could not load/);
    assert.equal(appendCount, 2);
});

test('a stale global after a successful load triggers a fresh load', async () => {
    let appendCount = 0;
    const windowObject = { XLSX: {} };
    const documentObject = {
        createElement() {
            return {
                setAttribute() {},
                parentNode: null
            };
        },
        head: {
            appendChild(script) {
                appendCount++;
                script.parentNode = this;
                windowObject.XLSX = sheetJs();
                script.onload();
            },
            removeChild() {}
        }
    };
    const controller = loadController(windowObject, documentObject);
    await controller._ensureSheetJs();
    windowObject.XLSX = {};
    await controller._ensureSheetJs();
    assert.equal(appendCount, 2);
});

test('Excel WorkDate serial is converted as a calendar date without timezone arithmetic', () => {
    let receivedOptions;
    const controller = loadController({
        XLSX: sheetJs((serial, options) => {
            receivedOptions = options;
            assert.equal(serial, 46242);
            return { y: 2026, m: 8, d: 8 };
        })
    }, {});

    assert.equal(controller._parseDate(46242, false), '20260808');
    assert.equal(receivedOptions.date1904, false);
});

test('textual YYYYMMDD remains a date key rather than an Excel serial', () => {
    const controller = loadController({ XLSX: sheetJs() }, {});
    assert.equal(controller._parseDate('20260808', false), '20260808');
});
