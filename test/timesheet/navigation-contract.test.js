const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const view = fs.readFileSync('app/timesheet/webapp/view/App.view.xml', 'utf8');
const controller = fs.readFileSync('app/timesheet/webapp/controller/App.controller.js', 'utf8');
const service = fs.readFileSync('srv/service.js', 'utf8');
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

test('Create request rejects day-off and WFH ranges where end is before start', () => {
    assert.match(controller, /_validateRequestDateRange: function/);
    assert.match(controller, /if \(oEnd < oStart\)/);
    assert.match(controller, /ValueState\.Error/);
    assert.match(controller, /MessageBox\.error\(sMessage\)/);
    assert.match(controller, /if \(!this\._validateRequestDateRange\(sPrefix, true\)\) return/);

    for (const file of [
        'app/timesheet/webapp/i18n/i18n.properties',
        'app/timesheet/webapp/i18n/i18n_en.properties',
        'app/timesheet/webapp/i18n/i18n_vi.properties'
    ]) {
        const bundle = fs.readFileSync(file, 'utf8');
        assert.match(bundle, /^msgEndBeforeStart=/m);
    }

    assert.match(service, /data\.RequestType === 'DAYOFF' \|\| data\.RequestType === 'WFH'/);
    assert.match(service, /if \(end < start\) \{/);
    assert.match(service, /req\.reject\(400, 'End Date\/Time cannot be earlier than Start Date\/Time\.'\)/);
});

test('Overtime sends the selected times and validates outside official working hours', () => {
    assert.match(controller, /_validateOvertimeTimes: function/);
    assert.match(controller, /Overtime must be outside official working hours/);
    assert.match(controller, /oPayload\.CorrectedStartTime = otStart/);
    assert.match(controller, /oPayload\.CorrectedEndTime = otEnd/);
    assert.match(service, /validateAndCalculateOvertime/);
    assert.match(service, /Overtime start and end times are required/);
    assert.match(service, /Overtime must be outside official working hours/);
    assert.match(service, /Overtime cannot exceed 40 hours in a calendar month/);
});

test('Calendar marks PA2005 overtime dates and shows the OT interval in details', () => {
    assert.match(controller, /hasOvertime: Boolean\(oRow\.HasOvertime\)/);
    assert.match(controller, /overtimeText: this\._formatOvertimeText\(oRow\.OvertimeText\)/);
    assert.match(controller, /Date: oData\.dateKey \+ \(oOvertime \? " \*" : ""\)/);
    assert.match(controller, /RequestType === "OVERTIME"/);
    assert.match(controller, /SapPostStatus.*SUCCESS/);
    assert.match(controller, /Number\(oRequest\.Duration \|\| 0\) > 0/);
    assert.match(controller, /sStartTime !== "000000"/);
    assert.match(controller, /\[data-sap-day\]/);
    assert.match(controller, /timesheetOtDate/);
    assert.match(controller, /detOvertimeLabel/);
    assert.match(controller, /overtimeHours\.toFixed\(2\)/);
    assert.match(view, /id="detOvertimeLabel"/);
    assert.match(view, /id="detOvertime"/);
});

test('Work Calendar hides generated week-number index column', () => {
    assert.match(view, /id="attendanceCalendar"[\s\S]*?showWeekNumbers="false"/);
});

test('Calendar labels approved WFH and does not mark today absent', () => {
    assert.match(controller, /getStatusInfo: function \(iStatus, sShiftCode, oDate, bIsWfh\)/);
    assert.match(controller, /statusFullAttendanceWfh/);
    assert.match(controller, /_getApprovedRequestForDate: function/);
    assert.match(controller, /oRequest\.RequestType === sRequestType/);
    assert.match(controller, /statusToday/);
    assert.match(controller, /if \(bIsToday\)/);
    assert.match(controller, /this\._applyCalendarColors\(\)/);
    assert.match(service, /todayKey = new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
    assert.match(service, /row\.AttendanceStatus = 0/);
});

test('Attendance details are rendered below the calendar in the left column', () => {
    const calendarStart = view.indexOf('<!-- Work Calendar Section');
    const calendarSection = view.slice(calendarStart, view.indexOf('<!-- My Requests Section'));
    const calendarPosition = calendarSection.indexOf('id="attendanceCalendar"');
    const detailPosition = calendarSection.indexOf('id="detailPanel"');
    const rightColumnStart = calendarSection.indexOf('id="calendarCreateRequestButton"');

    assert.ok(calendarPosition >= 0);
    assert.ok(detailPosition > calendarPosition);
    assert.ok(rightColumnStart > detailPosition);
    assert.match(calendarSection, /id="detailPanel"[\s\S]*?id="placeholderDetail"/);
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
