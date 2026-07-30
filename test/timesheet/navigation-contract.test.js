const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const view = fs.readFileSync('app/timesheet/webapp/view/App.view.xml', 'utf8');
const controller = fs.readFileSync('app/timesheet/webapp/controller/App.controller.js', 'utf8');
const launchpadView = fs.readFileSync('app/launchpad/webapp/view/App.view.xml', 'utf8');
const launchpadController = fs.readFileSync('app/launchpad/webapp/controller/App.controller.js', 'utf8');

test('My Reports is removed from the Timesheet navigation and content', () => {
    assert.doesNotMatch(view, /key="reports"/);
    assert.doesNotMatch(view, /selectedTab\}\s*===\s*'reports'/);
    assert.doesNotMatch(view, /i18n>navReports/);
});

test('Create request is available in My Requests employee mode and Work Calendar', () => {
    const matches = view.match(/i18n>btnCreateRequest/g) || [];
    assert.equal(matches.length, 2);

    const requestsStart = view.indexOf('<!-- My Requests Section');
    const historyStart = view.indexOf('<!-- My History Section');
    const requestSection = view.slice(requestsStart, historyStart);
    const calendarStart = view.indexOf('<!-- Work Calendar Section');
    const requestsCommentStart = view.indexOf('<!-- My Requests Section');
    const calendarSection = view.slice(calendarStart, requestsCommentStart);

    assert.match(requestSection, /i18n>btnCreateRequest/);
    assert.match(requestSection, /visible="\{= \$\{view>\/reqViewMode\} === 'employee' &amp;&amp; !\$\{view>\/requestsBusy\} \}"/);
    assert.match(calendarSection, /id="calendarCreateRequestButton"/);
    assert.match(calendarSection, /id="calendarCreateRequestButton"[\s\S]*?width="100%"/);
    assert.match(calendarSection, /press="onCreateRequestFromCalendar"/);

    const calendarButtonPosition = calendarSection.indexOf('id="calendarCreateRequestButton"');
    const calendarLegendPosition = calendarSection.indexOf('id="calendarLegend"');
    assert.ok(calendarButtonPosition > calendarSection.indexOf('<layout:Grid'));
    assert.ok(calendarButtonPosition < calendarLegendPosition);
});

test('Create request no longer reuses a previously selected Attendance row', () => {
    const handlerStart = controller.indexOf('onCreateRequest: function');
    const dialogStart = controller.indexOf('_openRequestDialog: function');
    const handler = controller.slice(handlerStart, dialogStart);

    assert.doesNotMatch(handler, /attendanceTable/);
    assert.doesNotMatch(handler, /getSelectedItem/);
});

test('Dashboard is visible only to managers and employees fall back to Attendance', () => {
    assert.match(view, /key="dashboard"[^\r\n]*visible="\{view>\/isManager\}"/);
    assert.match(view, /visible="\{= \$\{view>\/isManager\} &amp;&amp; \$\{view>\/selectedTab\} === 'dashboard' \}"/);
    assert.match(controller, /if \(!bIsManager && oViewModel\.getProperty\("\/selectedTab"\) === "dashboard"\)/);
    assert.match(controller, /setProperty\("\/selectedTab", "attendance"\)/);
});

test('Work Calendar uses Check In and Check Out labels', () => {
    for (const file of [
        'app/timesheet/webapp/i18n/i18n.properties',
        'app/timesheet/webapp/i18n/i18n_en.properties',
        'app/timesheet/webapp/i18n/i18n_vi.properties'
    ]) {
        const bundle = fs.readFileSync(file, 'utf8');
        assert.match(bundle, /^detClockIn=Check In$/m);
        assert.match(bundle, /^detClockOut=Check Out$/m);
    }
});

test('Calendar request uses the selected calendar date and attendance times', () => {
    assert.match(controller, /onCreateRequestFromCalendar: function/);
    assert.match(controller, /getSelectedDates\(\)/);
    assert.match(controller, /Date: sDateKey/);
    assert.match(controller, /this\._showCreateRequestDialog\(\{/);
});

test('Embedded Timesheet navigation has an accessible collapse toggle', () => {
    assert.match(view, /sideExpanded="\{view>\/sideExpanded\}"/);
    assert.match(view, /selectedKey="\{= \$\{view>\/selectedTab\} \}"/);

    const toggleStart = view.lastIndexOf('<tnt:NavigationListItem', view.indexOf('key="toggleNavigation"'));
    const toggleEnd = view.indexOf('/>', toggleStart);
    const toggleItem = view.slice(toggleStart, toggleEnd);

    assert.match(toggleItem, /key="toggleNavigation"/);
    assert.match(toggleItem, /icon="sap-icon:\/\/menu2"/);
    assert.match(toggleItem, /tooltip="\{i18n>navToggleMenu\}"/);
    assert.doesNotMatch(toggleItem, /\btext=/);
    assert.match(controller, /sideExpanded: true/);
    assert.match(controller, /if \(sKey === "toggleNavigation"\)/);
    assert.match(controller, /setProperty\("\/sideExpanded", bExpanded\)/);
});

test('Launchpad header no longer renders the redundant menu button', () => {
    assert.doesNotMatch(launchpadView, /id="btnMenu"/);
});

test('Reload restores the embedded app from query parameters without consuming Profile router hash', () => {
    assert.match(launchpadController, /this\._restoreRouteFromHash\(\)/);
    assert.match(launchpadController, /sApp === "timesheet"/);
    assert.match(launchpadController, /_navigateToApp\("timesheetPage", "znxr09\.timesheet"/);
    assert.match(launchpadController, /window\.history\.replaceState/);
    assert.match(launchpadController, /searchParams\.set\("app", sApp\)/);
    assert.match(launchpadController, /fromLegacyHash: bFromLegacyHash/);
    assert.match(launchpadController, /embedded Profile component owns the hash/);
    assert.doesNotMatch(launchpadController, /var sHash = "#\/" \+ sApp/);

    assert.match(controller, /var sInitialTab = this\._getTabFromRoute\(\) \|\| "dashboard"/);
    assert.match(controller, /selectedTab: sInitialTab/);
    assert.match(controller, /searchParams\.set\("app", "timesheet"\)/);
    assert.match(controller, /searchParams\.set\("tab", sTab\)/);
    assert.match(controller, /this\._persistTabInRoute\(sKey\)/);
    assert.match(controller, /this\._persistTabInRoute\("attendance"\)/);
});

test('Request mode switching never exposes actions for stale request data', () => {
    assert.match(view, /busy="\{view>\/requestsBusy\}"/);
    assert.match(view, /busyIndicatorDelay="0"/);
    assert.match(view, /reqDataMode\} === 'employee'/);
    assert.match(view, /reqDataMode\} === 'manager'/);
    assert.match(view, /!\$\{view>\/requestsBusy\}[\s\S]*?onApproveRequest/);

    assert.match(controller, /reqDataMode: ""/);
    assert.match(controller, /requestsBusy: false/);
    assert.match(controller, /this\._oRequestsXhr\.abort\(\)/);
    assert.match(controller, /new JSONModel\(\{ rows: \[\] \}\), "reqList"/);
    assert.match(controller, /iRequestId !== this\._iRequestLoadSequence/);
    assert.match(controller, /sMode !== oViewModel\.getProperty\("\/reqViewMode"\)/);
    assert.match(controller, /setProperty\("\/reqDataMode", sMode\)/);
});
