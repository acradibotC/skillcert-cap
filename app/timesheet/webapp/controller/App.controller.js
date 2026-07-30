sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/ValueState",
    "sap/ui/unified/DateTypeRange"
], function (Controller, JSONModel, ValueState, DateTypeRange) {
    "use strict";

    return Controller.extend("znxr09.timesheet.controller.App", {
        _aAttendanceData: [],
        _sCurrentPernr: null,
        _iLoadedYear: null,

        formatter: {
            dayOfMonth: function (sDate) {
                if (!sDate) return "";
                var oDate = new Date(sDate);
                return oDate.getDate().toString();
            },
            date: function (sDate) {
                if (!sDate) return "";
                var oDate = new Date(sDate);
                var oFormat = sap.ui.core.format.DateFormat.getDateInstance({pattern: "yyyy-MM-dd"});
                return oFormat.format(oDate);
            },
            time: function (sTime) {
                if (!sTime) return "--:--";
                return sTime.substring(0, 8); // Assuming "HH:mm:ss"
            },
            statusText: function (iStatus) {
                if (iStatus === 1) return "OK/OK";
                if (iStatus === 2) return "LATE/OK";
                if (iStatus === 3) return "OK/EARLY";
                return "OK/OK";
            },
            statusState: function (iStatus) {
                if (iStatus === 1) return "Success";
                if (iStatus === 2) return "Warning";
                if (iStatus === 3) return "Warning";
                return "Success";
            },
            actualWorking: function (sStart, sEnd) {
                if (!sStart || !sEnd) return "0";
                // Mock logic: return a static value or a basic diff.
                return "1";
            }
        },

        onInit: function () {
            var oNow = new Date();
            var sInitialTab = this._getTabFromHash() || "dashboard";
            var oViewModel = new JSONModel({
                selectedTab: sInitialTab,
                sideExpanded: true,
                calendarBusy: false,
                attMonth: String(oNow.getMonth() + 1),
                attYear: String(oNow.getFullYear()),
                reqViewMode: "employee", // Default view mode for Requests tab
                reqDataMode: "",
                requestsBusy: false,
                isManager: false, // Will be set after fetching UserProfile
                reqCountAll: 0,
                reqCountPending: 0,
                reqCountApproved: 0,
                reqCountRejected: 0
            });
            this.getView().setModel(oViewModel, "view");

            // Attach after rendering to load data
            this.getView().attachEventOnce("afterRendering", function () {
                this._loadAttendanceData();
            }.bind(this));

            // Subscribe to cross-app navigation events from Launchpad
            sap.ui.getCore().getEventBus().subscribe("Launchpad", "NavToRequests", function(sChannel, sEvent, oData) {
                this.getView().getModel("view").setProperty("/selectedTab", "requests");
                this._persistTabInHash("requests");
                if (oData && oData.mode) {
                    this.getView().getModel("view").setProperty("/reqViewMode", oData.mode);
                }
                
                // Ensure SideNavigation selection is updated visually
                var oSideNav = this.byId("sideNav");
                if (oSideNav) {
                    oSideNav.setSelectedKey("requests");
                }
                this._loadRequests();
            }, this);
        },

        onSideNavButtonPress: function () {
            var oToolPage = this.byId("toolPage");
            var bExpanded = !oToolPage.getSideExpanded();
            oToolPage.setSideExpanded(bExpanded);
            this.getView().getModel("view").setProperty("/sideExpanded", bExpanded);
        },

        onSideNavSelect: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            if (sKey === "toggleNavigation") {
                this.onSideNavButtonPress();
                this.byId("sideNav").setSelectedKey(
                    this.getView().getModel("view").getProperty("/selectedTab")
                );
                return;
            }
            if (sKey === "dashboard" && !this.getView().getModel("view").getProperty("/isManager")) {
                this.byId("sideNav").setSelectedKey("attendance");
                this.getView().getModel("view").setProperty("/selectedTab", "attendance");
                return;
            }
            this.getView().getModel("view").setProperty("/selectedTab", sKey);
            this._persistTabInHash(sKey);
        },

        _getTabFromHash: function () {
            var aParts = (window.location.hash || "")
                .replace(/^#\/?/, "")
                .split("/")
                .filter(Boolean);
            var aAllowedTabs = ["dashboard", "attendance", "calendar", "requests", "history"];

            return aParts[0] === "timesheet" && aAllowedTabs.indexOf(aParts[1]) >= 0
                ? aParts[1]
                : "";
        },

        _persistTabInHash: function (sTab) {
            var aAllowedTabs = ["dashboard", "attendance", "calendar", "requests", "history"];
            if (aAllowedTabs.indexOf(sTab) < 0) {
                return;
            }
            var sHash = "#/timesheet/" + sTab;
            if (window.location.hash !== sHash) {
                window.history.replaceState(
                    window.history.state,
                    document.title,
                    window.location.pathname + window.location.search + sHash
                );
            }
        },

        onAttendanceSearch: function () {
            this._updateAttendanceTable();
        },

        onExport: function () {
            var oTable = this.byId("attendanceTable");
            var oRowBinding = oTable.getBinding("items");
            var aCols = [
                { label: 'Date', property: 'Date', type: 'string' },
                { label: 'Checkin', property: 'Checkin', type: 'string' },
                { label: 'Checkout', property: 'Checkout', type: 'string' },
                { label: 'Status', property: 'StatusText', type: 'string' },
                { label: 'Actual Working', property: 'ActualWorking', type: 'string' },
                { label: 'Overtime (Hours)', property: 'Overtime', type: 'string' }
            ];

            sap.ui.require(["sap/ui/export/Spreadsheet"], function(Spreadsheet) {
                var oSettings = {
                    workbook: { columns: aCols },
                    dataSource: oRowBinding,
                    fileName: 'Attendance_Export.xlsx',
                    worker: false
                };
                var oSheet = new Spreadsheet(oSettings);
                oSheet.build().finally(function() {
                    oSheet.destroy();
                });
            });
        },

        onLogout: function () {
            window.location.href = "/auth/logout";
        },

        // ====== UTILITY ======
        formatTime: function (vTime) {
            if (!vTime) return "--:--";
            if (typeof vTime === "string") {
                if (vTime.indexOf("PT") === 0) {
                    var h = vTime.match(/(\d+)H/);
                    var m = vTime.match(/(\d+)M/);
                    return (h ? h[1].padStart(2, '0') : '00') + ':' + (m ? m[1].padStart(2, '0') : '00');
                }
                return vTime.substring(0, 5);
            }
            return "--:--";
        },

        getText: function(sKey, aArgs) {
            return this.getView().getModel('i18n').getResourceBundle().getText(sKey, aArgs);
        },

        parseAbapDate: function (vDate) {
            if (!vDate) return new Date();
            if (vDate instanceof Date) return vDate;
            var sStr = String(vDate);
            if (sStr.length === 8 && sStr.indexOf("-") === -1) {
                return new Date(parseInt(sStr.substring(0, 4)), parseInt(sStr.substring(4, 6)) - 1, parseInt(sStr.substring(6, 8)));
            }
            if (sStr.indexOf("-") !== -1) {
                var parts = sStr.split("-");
                return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            }
            return new Date(vDate);
        },

        toLocalISOString: function (oDate) {
            if (!oDate) return null;
            var pad = function(num) { return (num < 10 ? '0' : '') + num; };
            return oDate.getFullYear() +
                '-' + pad(oDate.getMonth() + 1) +
                '-' + pad(oDate.getDate()) +
                'T' + pad(oDate.getHours()) +
                ':' + pad(oDate.getMinutes()) +
                ':' + pad(oDate.getSeconds()) +
                '.000Z';
        },

        getDateKey: function (oDate) {
            return oDate.getFullYear() + '-' +
                String(oDate.getMonth() + 1).padStart(2, '0') + '-' +
                String(oDate.getDate()).padStart(2, '0');
        },

        getStatusInfo: function (iStatus, sShiftCode, oDate) {
            // Type08 = Green, Type01 = Yellow/Orange, Type03 = Red, Type06 = Blue, Type09 = Grey
            var sCode = (sShiftCode || "").toUpperCase();
            var bIsOff = !sShiftCode || sCode === "OFF" || sCode === "FREE" || sCode === "";

            // Day-off takes priority — SAP may incorrectly mark past weekends as Absent
            if (bIsOff) {
                return { text: "Off / No Schedule", state: ValueState.None, type: "Type09" };
            }

            switch (parseInt(iStatus, 10)) {
                case 1: return { text: this.getText("statusFullAttendance"), state: ValueState.Success, type: "Type08" };
                case 2: return { text: this.getText("statusLateLeaveEarly"), state: ValueState.Warning, type: "Type02" };
                case 3: return { text: this.getText("statusAbsent"), state: ValueState.Error, type: "Type03" };
                case 4: return { text: "Leave (Full Day)", state: ValueState.Success, type: "Type08" };
                case 5: return { text: "Leave (Partial)", state: ValueState.Warning, type: "Type02" };
                default:
                    // Past workdays with no status → Absent; Future/today → Scheduled
                    var oToday = new Date();
                    oToday.setHours(0, 0, 0, 0);
                    if (oDate && oDate < oToday) {
                        return { text: this.getText("statusAbsent"), state: ValueState.Error, type: "Type03" };
                    }
                    return { text: "Scheduled", state: ValueState.Information, type: "Type06" };
            }
        },

        // ====== DATA FETCH ======
        _loadAttendanceData: function () {
            var oModel = this.getOwnerComponent().getModel();
            if (!oModel) return;

            var oViewModel = this.getView().getModel("view");
            oViewModel.setProperty("/calendarBusy", true);
            this._aAttendanceData = [];

            // 1. Fetch current user email from local proxy
            jQuery.ajax({
                url: "/api/currentUser",
                method: "GET",
                success: function (oLocalUser) {
                    // Check authorization first
                    if (oLocalUser && oLocalUser.authorized === false) {
                        oViewModel.setProperty("/calendarBusy", false);
                        sap.m.MessageBox.warning(
                            oLocalUser.errorMessage || "Your email is not linked to any employee record. Please contact sso@nexora.com.",
                            {
                                title: "Something Went Wrong",
                                onClose: function () {
                                    window.location.href = "/launchpad/";
                                }
                            }
                        );
                        return;
                    }

                    var sEmail = String(oLocalUser.email || "").trim();
                    var sPernr = String(oLocalUser.pernr || "").trim();
                    var sSapUserId = String(oLocalUser.sapUserId || sEmail).trim();
                    if (!sPernr && !sSapUserId) {
                        oViewModel.setProperty("/calendarBusy", false);
                        this.byId("userInfoText").setText(this.getText("dataLoadUnavailable"));
                        return;
                    }
                    this._sCurrentUserEmail = sEmail;
                    var bIsManager = oLocalUser.isManager === true || oLocalUser.isManager === "X";
                    oViewModel.setProperty("/isManager", bIsManager);
                    if (!bIsManager && oViewModel.getProperty("/selectedTab") === "dashboard") {
                        oViewModel.setProperty("/selectedTab", "attendance");
                        this.byId("sideNav").setSelectedKey("attendance");
                        this._persistTabInHash("attendance");
                    }
                    try {
                        var sStoredReqMode = window.sessionStorage.getItem("znxr09.timesheet.reqViewMode");
                        if (sStoredReqMode) {
                            oViewModel.setProperty("/reqViewMode", sStoredReqMode);
                            window.sessionStorage.removeItem("znxr09.timesheet.reqViewMode");
                        }
                    } catch (e) {
                        // Keep default request mode when session storage is unavailable.
                    }

                    // /api/currentUser already resolves the authenticated identity to a
                    // personnel number. Start the independent schedule/request reads
                    // immediately so a secondary profile lookup cannot block all tabs.
                    if (sPernr) {
                        this._startEmployeeDataLoad(sPernr, {
                            Pernr: sPernr,
                            EmployeeName: oLocalUser.employeeName || oLocalUser.name || "",
                            DepartmentName: oLocalUser.department || ""
                        });
                        return;
                    }

                    // Compatibility fallback for an older currentUser response without
                    // Pernr. SAP UserProfile keys are case-sensitive; use sapUserId,
                    // never the lower-case OAuth e-mail address.
                    jQuery.ajax({
                        url: "/api/v1/UserProfile('" +
                            encodeURIComponent(sSapUserId.replace(/'/g, "''")) + "')",
                        method: "GET",
                        success: function(oProfile) {
                            var sResolvedPernr = String(oProfile.Pernr || "").trim();
                            if (!sResolvedPernr) {
                                oViewModel.setProperty("/calendarBusy", false);
                                this.byId("userInfoText").setText(this.getText("dataLoadUnavailable"));
                                return;
                            }
                            this._startEmployeeDataLoad(sResolvedPernr, oProfile);
                        }.bind(this),
                        error: function(err) {
                            oViewModel.setProperty("/calendarBusy", false);
                            this.byId("userInfoText").setText(this.getText("dataLoadUnavailable"));
                            console.error("[WorkCalendar] Failed to fetch UserProfile", err);
                        }.bind(this)
                    });

                }.bind(this),
                error: function (err) {
                    oViewModel.setProperty("/calendarBusy", false);
                    console.error("[WorkCalendar] Failed to fetch currentUser", err);
                }
            });
        },

        _startEmployeeDataLoad: function (sPernr, oProfile) {
            this._sCurrentPernr = sPernr;
            var iYear = new Date().getFullYear();
            this._iLoadedYear = iYear;

            var sName = oProfile.EmployeeName || "Employee";
            var sDepartment = oProfile.DepartmentName || oProfile.OrgUnitName || "";
            this.byId("userInfoText").setText(sName + (sDepartment ? " | " + sDepartment : ""));

            console.log("[WorkCalendar] Loading data for Pernr:", sPernr, "Year:", iYear);
            this._fetchWorkSchedule(sPernr, iYear, oProfile);
            this._loadRequests();
        },

        _fetchWorkSchedule: function (sPernr, iYear, oProfile) {
            var oModel = this.getOwnerComponent().getModel();
            var oViewModel = this.getView().getModel("view");
            oViewModel.setProperty("/calendarBusy", true);
            this._aAttendanceData = [];

            // Only filter by Pernr — SAP backend does NOT support ge/le on WorkDate (returns 501)
            // We will filter by year client-side after receiving all data
            var oPernrFilter = new sap.ui.model.Filter("Pernr", sap.ui.model.FilterOperator.EQ, sPernr);

            // Table will be populated via JSON model after data is loaded (see _updateAttendanceTable)

            // Fetch data for Calendar — only Pernr filter, no date/orderby
            var oListBinding = oModel.bindList("/WorkSchedule", null, null, [oPernrFilter]);

            oListBinding.requestContexts(0, 400).then(function (aContexts) {
                oViewModel.setProperty("/calendarBusy", false);
                console.log("[WorkCalendar] Received", aContexts.length, "records for year", iYear);

                if (oProfile) {
                    var sName = oProfile.EmployeeName || "Unknown Employee";
                    var sDept = oProfile.DepartmentName || "";
                    this.byId("userInfoText").setText(sName + (sDept ? " | " + sDept : ""));
                } else if (aContexts.length > 0) {
                    var oFirst = aContexts[0].getObject();
                    var sName = oFirst.EmployeeName || "Employee";
                    var sDept = oFirst.DepartmentName || "Department";
                    this.byId("userInfoText").setText(sName + " | " + sDept);
                }

                aContexts.forEach(function (oCtx) {
                    var oRow = oCtx.getObject();
                    var oDate = this.parseAbapDate(oRow.WorkDate);
                    this._aAttendanceData.push({
                        date: oDate,
                        dateKey: this.getDateKey(oDate),
                        pernr: oRow.Pernr,
                        shiftCode: oRow.ShiftCode,
                        startTime: this.formatTime(oRow.StartTime),
                        endTime: this.formatTime(oRow.EndTime),
                        actualStart: this.formatTime(oRow.ActualStartTime),
                        actualEnd: this.formatTime(oRow.ActualEndTime),
                        isHoliday: oRow.IsHoliday,
                        leaveType: oRow.LeaveType,
                        status: oRow.AttendanceStatus
                    });
                }.bind(this));

                // Sort client-side by date before applying calendar colors
                this._aAttendanceData.sort(function(a, b) {
                    return a.date - b.date;
                });
                this._applyCalendarColors();
                this._updateAttendanceTable();
            }.bind(this)).catch(function (oError) {
                oViewModel.setProperty("/calendarBusy", false);
                console.error("[WorkCalendar] Failed to load WorkSchedule", oError);
            }.bind(this));
        },

        _updateAttendanceTable: function () {
            var oViewModel = this.getView().getModel("view");
            var iMonth = parseInt(oViewModel.getProperty("/attMonth"), 10);
            var iYear = parseInt(oViewModel.getProperty("/attYear"), 10);

            // Filter: only workdays (not OFF/FREE) AND matching selected month/year
            var aWorkdays = this._aAttendanceData.filter(function (oData) {
                var sCode = (oData.shiftCode || "").toUpperCase();
                var bIsWorkday = sCode !== "OFF" && sCode !== "FREE" && sCode !== "";
                var bMatchMonth = oData.date.getMonth() + 1 === iMonth;
                var bMatchYear = oData.date.getFullYear() === iYear;
                return bIsWorkday && bMatchMonth && bMatchYear;
            });

            var aRawRequests = this._aRawRequests || [];

            var aTableData = aWorkdays.map(function (oData, iIndex) {
                var oInfo = this.getStatusInfo(oData.status, oData.shiftCode, oData.date);
                var bNoData = oData.actualStart === "--:--" || oData.actualEnd === "--:--" || (oData.actualStart === "00:00" && oData.actualEnd === "00:00");
                
                var sDateKey = oData.dateKey;
                var fOvertime = 0;
                var fLeave = 0;
                var iTotalReq = 0;
                var iAcceptReq = 0;

                aRawRequests.forEach(function(r) {
                    var sStart = r.StartDate ? r.StartDate.substring(0,10) : "";
                    var sEnd = r.EndDate ? r.EndDate.substring(0,10) : "";
                    if (sDateKey >= sStart && sDateKey <= sEnd) {
                        if (r.Status !== "04") { // Exclude Cancelled
                            iTotalReq++;
                            if (r.Status === "02") iAcceptReq++;
                        }
                        if (r.Status === "02") {
                            if (r.RequestType === "OVERTIME") {
                                fOvertime += parseFloat(r.Duration) || 0;
                            } else if (r.RequestType === "DAYOFF") {
                                fLeave += parseFloat(r.Duration) || 0;
                            }
                        }
                    }
                });

                var fActualWorking = 0;
                if (!bNoData) {
                    var aIn = oData.actualStart.split(":");
                    var aOut = oData.actualEnd.split(":");
                    var dIn = new Date(); dIn.setHours(aIn[0], aIn[1], 0);
                    var dOut = new Date(); dOut.setHours(aOut[0], aOut[1], 0);
                    if (dOut < dIn) dOut.setDate(dOut.getDate() + 1);
                    var fActualHours = (dOut - dIn) / (1000 * 60 * 60);

                    var aSchIn = (oData.startTime && oData.startTime !== "--:--") ? oData.startTime.split(":") : ["08", "00"];
                    var aSchOut = (oData.endTime && oData.endTime !== "--:--") ? oData.endTime.split(":") : ["17", "30"];
                    var dSchIn = new Date(); dSchIn.setHours(aSchIn[0], aSchIn[1], 0);
                    var dSchOut = new Date(); dSchOut.setHours(aSchOut[0], aSchOut[1], 0);
                    if (dSchOut < dSchIn) dSchOut.setDate(dSchOut.getDate() + 1);
                    var fSchHours = (dSchOut - dSchIn) / (1000 * 60 * 60);

                    if (fSchHours > 0) {
                        fActualWorking = Math.min(1, Math.max(0, fActualHours / fSchHours));
                    } else {
                        fActualWorking = 1;
                    }
                }
                
                // Format to 2 decimals if fractional, otherwise whole number
                var sActualWorking = fActualWorking === 1 ? "1" : (fActualWorking === 0 ? "0" : fActualWorking.toFixed(2));

                return {
                    No: iIndex + 1,
                    Date: oData.dateKey,
                    Checkin: oData.actualStart,
                    Checkout: oData.actualEnd,
                    StatusText: oInfo.text,
                    StatusState: oInfo.state,
                    ActualWorking: sActualWorking,
                    Overtime: fOvertime.toFixed(2),
                    CreditLeave: fLeave.toFixed(3),
                    UnpaidLeave: "0.000",
                    Request: iAcceptReq + "/" + iTotalReq
                };
            }.bind(this));

            var oAttModel = new JSONModel({ rows: aTableData });
            this.getView().setModel(oAttModel, "att");
            console.log("[MyAttendance] Showing", aTableData.length, "rows for", iMonth + "/" + iYear);
        },

        _applyCalendarColors: function () {
            var oCalendar = this.byId("attendanceCalendar");
            oCalendar.removeAllSpecialDates();

            this._aAttendanceData.forEach(function (oData) {
                var oInfo = this.getStatusInfo(oData.status, oData.shiftCode, oData.date);
                var bIsHoliday = oData.isHoliday;
                var sCode = (oData.shiftCode || "").toUpperCase();
                var bIsOff = !oData.shiftCode || sCode === "OFF" || sCode === "FREE" || sCode === "";
                
                var sType = oInfo.type;
                if (bIsHoliday && bIsOff) {
                    sType = "Type09"; // Off
                }

                oCalendar.addSpecialDate(new DateTypeRange({
                    startDate: oData.date,
                    type: sType,
                    tooltip: oData.shiftCode || "Off"
                }));
            }.bind(this));
        },

        // ====== TOOLBAR ACTIONS ======
        onSortAttendanceOpen: function () {
            var oTable = this.byId("attendanceTable");
            var oBinding = oTable.getBinding("items");
            if (!oBinding) return;

            var bDescending = this._bSortDescending === undefined ? true : !this._bSortDescending;
            this._bSortDescending = bDescending;

            var aSorters = [new sap.ui.model.Sorter("Date", bDescending)];
            oBinding.sort(aSorters);
        },

        onExport: function () {
            sap.m.MessageToast.show("Export functionality coming soon...");
        },

        // ====== CALENDAR EVENTS ======
        onStartDateChange: function(oEvent) {
            // When user navigates calendar, check if year changed → reload data
            var oCalendar = oEvent.getSource();
            var oStartDate = oCalendar.getStartDate();
            var iNewYear = oStartDate.getFullYear();

            if (this._iLoadedYear && iNewYear !== this._iLoadedYear && this._sCurrentPernr) {
                console.log("[WorkCalendar] Year changed to", iNewYear, "— reloading data");
                this._iLoadedYear = iNewYear;
                this._fetchWorkSchedule(this._sCurrentPernr, iNewYear, null);
            }
        },

        onDateSelect: function (oEvent) {
            var oCalendar = oEvent.getSource();
            var aSelectedDates = oCalendar.getSelectedDates();
            if (aSelectedDates.length > 0) {
                var oDate = aSelectedDates[0].getStartDate();
                var sDateKey = this.getDateKey(oDate);
                
                var oData = this._aAttendanceData.find(function(item) {
                    return item.dateKey === sDateKey;
                });

                if (oData) {
                    this._showDetail(oData);
                } else {
                    this._hideDetail();
                }
            } else {
                this._hideDetail();
            }
        },

        onCreateRequestFromCalendar: function () {
            var oCalendar = this.byId("attendanceCalendar");
            var aSelectedDates = oCalendar.getSelectedDates();
            var oDate = aSelectedDates.length > 0
                ? aSelectedDates[0].getStartDate()
                : new Date();
            var sDateKey = this.getDateKey(oDate);
            var oAttendance = (this._aAttendanceData || []).find(function (oItem) {
                return oItem.dateKey === sDateKey;
            });
            var bHasActualTime = oAttendance && oAttendance.status !== 3;

            this._showCreateRequestDialog({
                Date: sDateKey,
                Checkin: bHasActualTime ? (oAttendance.actualStart || "") : "",
                Checkout: bHasActualTime ? (oAttendance.actualEnd || "") : ""
            });
        },

        _showDetail: function (oData) {
            this.byId("placeholderDetail").setVisible(false);
            this.byId("detailPanel").setVisible(true);

            var oInfo = this.getStatusInfo(oData.status, oData.shiftCode, oData.date);

            // Format date string to English (e.g. DD/MM/YYYY)
            var sDateStr = String(oData.date.getDate()).padStart(2, '0') + '/' +
                           String(oData.date.getMonth() + 1).padStart(2, '0') + '/' +
                           oData.date.getFullYear();

            this.byId("detDate").setText(sDateStr);
            this.byId("detShift").setText(oData.shiftCode || "Off");
            
            this.byId("detStart").setText(oData.startTime);
            this.byId("detEnd").setText(oData.endTime);

            if (oData.status === 4 || oData.status === 5) {
                var sLeaveText = (oData.status === 4) ? "Full Day Leave" : "Partial Leave";
                this.byId("detActStart").setText(sLeaveText + " (" + (oData.leaveType || "") + ")");
                this.byId("detActEnd").setText("");
            } else {
                this.byId("detActStart").setText(oData.status === 3 ? "No Data" : oData.actualStart);
                this.byId("detActEnd").setText(oData.status === 3 ? "No Data" : oData.actualEnd);
            }

            this.byId("detStatus").setText(oInfo.text);
            this.byId("detStatus").setState(oInfo.state);
        },

        _hideDetail: function () {
            this.byId("placeholderDetail").setVisible(true);
            this.byId("detailPanel").setVisible(false);
        },

        // ============================================================
        // REQUESTS & APPROVAL WORKFLOW
        // ============================================================

        onCreateRequest: function (oEvent) {
            var oButton = oEvent.getSource();
            var oContext = oButton.getBindingContext("att");
            var oRowData = oContext ? oContext.getObject() : null;

            this._showCreateRequestDialog(oRowData);
        },

        _showCreateRequestDialog: function (oRowData) {
            if (!this.oRequestDialog) {
                sap.ui.core.Fragment.load({
                    id: this.getView().getId(),
                    name: "znxr09.timesheet.view.RequestDialog",
                    controller: this
                }).then(function (oDialog) {
                    this.oRequestDialog = oDialog;
                    this.getView().addDependent(this.oRequestDialog);
                    this._openRequestDialog(oRowData);
                }.bind(this));
            } else {
                this._openRequestDialog(oRowData);
            }
        },

        _openRequestDialog: function (oRowData) {
            // Reset fields
            var oView = this.getView();
            oView.byId("requestTabBar").setSelectedKey("DAYOFF");
            
            this._oCurrentApprover = null;
            this._setApproverFields("Fetching...");
            this._loadApprover();

            // Pre-fill Date if opened from a specific row
            var oDate;
            if (oRowData && oRowData.Date) {
                var parts = oRowData.Date.split("-");
                oDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                oView.byId("otActStart").setValue(oRowData.Checkin);
                oView.byId("otActEnd").setValue(oRowData.Checkout);
            } else {
                oDate = new Date();
                oView.byId("otActStart").setValue("");
                oView.byId("otActEnd").setValue("");
            }

            // Set Date for Edit Timesheet and Overtime
            oView.byId("etDate").setDateValue(oDate);
            oView.byId("otDate").setDateValue(oDate);

            // Set Start/End Time for Day Off and WFH (Default 08:00 to 17:30)
            var oStart = new Date(oDate.getTime());
            oStart.setHours(8, 0, 0, 0);
            var oEnd = new Date(oDate.getTime());
            oEnd.setHours(17, 30, 0, 0);

            oView.byId("doStartDate").setDateValue(oStart);
            oView.byId("doEndDate").setDateValue(oEnd);
            oView.byId("wfhStartDate").setDateValue(oStart);
            oView.byId("wfhEndDate").setDateValue(oEnd);
            
            // Trigger calculation for Day Off and WFH duration
            this.onCalcDuration();

            this.oRequestDialog.open();
        },

        _setApproverFields: function (sValue) {
            var oView = this.getView();
            ["doApprover", "etApprover", "otApprover", "wfhApprover"].forEach(function (sId) {
                var oInput = oView.byId(sId);
                if (oInput) {
                    oInput.setValue(sValue);
                }
            });
        },

        _loadApprover: function (sDuration, sRequestType) {
            if (!this._sCurrentPernr) {
                this._setApproverFields("No employee profile");
                return;
            }

            var sUrl = "/api/attendance/approver?pernr=" + encodeURIComponent(this._sCurrentPernr);
            if (sDuration !== undefined && sRequestType) {
                sUrl += "&duration=" + encodeURIComponent(sDuration) + "&requestType=" + encodeURIComponent(sRequestType);
            }

            if (this.oRequestDialog) {
                this.oRequestDialog.setBusyIndicatorDelay(0);
                this.oRequestDialog.setBusy(true);
            }

            jQuery.ajax({
                url: sUrl,
                method: "GET",
                success: function (oData) {
                    if (this.oRequestDialog) this.oRequestDialog.setBusy(false);
                    this._oCurrentApprover = oData || null;
                    var sDisplay = oData && oData.approverName
                        ? oData.approverName
                        : (oData && oData.approverId ? oData.approverId : "No approver found");
                    this._setApproverFields(sDisplay);
                }.bind(this),
                error: function (jqXHR) {
                    if (this.oRequestDialog) this.oRequestDialog.setBusy(false);
                    this._oCurrentApprover = null;
                    var sMsg = jqXHR.responseJSON && jqXHR.responseJSON.error
                        ? jqXHR.responseJSON.error
                        : "No approver found";
                    this._setApproverFields(sMsg);
                }.bind(this)
            });
        },

        onCloseRequestDialog: function () {
            if (this.oRequestDialog) {
                this.oRequestDialog.close();
            }
        },

        onRequestTabSelect: function (oEvent) {
            this.onCalcDuration();
        },

        onCalcDuration: function () {
            var oView = this.getView();
            var sTab = oView.byId("requestTabBar").getSelectedKey();

            if (sTab === "DAYOFF" || sTab === "WFH") {
                var sPrefix = sTab === "DAYOFF" ? "do" : "wfh";
                var oStart = oView.byId(sPrefix + "StartDate").getDateValue();
                var oEnd = oView.byId(sPrefix + "EndDate").getDateValue();
                if (oStart && oEnd) {
                    var diffDays = 0;
                    var currentDate = new Date(oStart.getTime());
                    var endDate = new Date(oEnd.getTime());
                    endDate.setHours(23, 59, 59, 999);

                    // Iterate and count weekdays
                    while (currentDate <= endDate) {
                        var dayOfWeek = currentDate.getDay(); // 0 = Sunday, 6 = Saturday
                        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                            diffDays++;
                        }
                        currentDate.setDate(currentDate.getDate() + 1);
                    }
                    if (diffDays === 0 && oStart <= endDate) diffDays = 0;

                    oView.byId(sPrefix + "Duration").setValue(diffDays);

                    // Re-load approver if duration might change skip-level logic
                    this._loadApprover(diffDays, sTab);
                }
            } else if (sTab === "OVERTIME") {
                var sStartT = oView.byId("otStartTime").getValue(); // HH:mm
                var sEndT = oView.byId("otEndTime").getValue();
                
                if (sStartT && sEndT) {
                    var dStart = new Date("1970-01-01T" + sStartT + ":00");
                    var dEnd = new Date("1970-01-01T" + sEndT + ":00");
                    if (dEnd < dStart) dEnd.setDate(dEnd.getDate() + 1); // Cross midnight
                    
                    var diffHours = (dEnd - dStart) / (1000 * 60 * 60);
                    oView.byId("otDuration").setValue(diffHours.toFixed(2));
                    
                    var breakHrs = 0;
                    if (diffHours > 12) breakHrs = 2.0;
                    else if (diffHours > 8) breakHrs = 1.5;
                    else if (diffHours > 4) breakHrs = 1.0;
                    
                    oView.byId("otBreak").setValue(breakHrs.toFixed(1));
                }
                this._loadApprover(0, sTab);
            } else if (sTab === "EDIT_TIMESHEET") {
                this._loadApprover(0, sTab);
            }
        },

        onSubmitRequest: function () {
            var oView = this.getView();
            var sTab = oView.byId("requestTabBar").getSelectedKey();
            var oPayload = {
                RequestType: sTab,
                Pernr: this._sCurrentPernr // Needs to be fetched/set
            };

            if (this._oCurrentApprover && this._oCurrentApprover.approverId) {
                oPayload.ApproverId = this._oCurrentApprover.approverId;
            }

            if (sTab === "DAYOFF" || sTab === "WFH") {
                var sPrefix = sTab === "DAYOFF" ? "do" : "wfh";
                var doStart = oView.byId(sPrefix + "StartDate").getDateValue();
                var doEnd = oView.byId(sPrefix + "EndDate").getDateValue();
                var doReason = oView.byId(sPrefix + "Reason").getValue();
                if (!doStart || !doEnd || !doReason) return sap.m.MessageToast.show(this.getText("msgFillRequired"));
                
                oPayload.StartDate = this.getDateKey(doStart);
                oPayload.EndDate = this.getDateKey(doEnd);
                oPayload.Reason = doReason;
            } else if (sTab === "EDIT_TIMESHEET") {
                var etDate = oView.byId("etDate").getDateValue();
                var etStart = oView.byId("etStartTime").getValue();
                var etEnd = oView.byId("etEndTime").getValue();
                var etReason = oView.byId("etReason").getValue();
                if (!etDate || !etStart || !etEnd || !etReason) return sap.m.MessageToast.show(this.getText("msgFillRequired"));
                if (this._countEditTimesheetRequestsInMonth(etDate) >= 3) {
                    return sap.m.MessageBox.error("You have reached the monthly limit of 3 Edit Timesheet requests.");
                }
                
                oPayload.StartDate = this.getDateKey(etDate);
                oPayload.EndDate = this.getDateKey(etDate); // Same day
                oPayload.CorrectedStartTime = etStart;
                oPayload.CorrectedEndTime = etEnd;
                oPayload.Reason = etReason;
            } else if (sTab === "OVERTIME") {
                var otDate = oView.byId("otDate").getDateValue();
                var otStart = oView.byId("otStartTime").getValue();
                var otEnd = oView.byId("otEndTime").getValue();
                var otReason = oView.byId("otReason").getValue();
                if (!otDate || !otStart || !otEnd || !otReason) return sap.m.MessageToast.show(this.getText("msgFillRequired"));
                
                // Construct Date + Time
                var dtStart = new Date(otDate);
                var dtEnd = new Date(otDate);
                var aStartParts = otStart.split(":");
                var aEndParts = otEnd.split(":");
                dtStart.setHours(aStartParts[0], aStartParts[1], 0);
                dtEnd.setHours(aEndParts[0], aEndParts[1], 0);
                if (dtEnd < dtStart) dtEnd.setDate(dtEnd.getDate() + 1);

                oPayload.StartDate = this.getDateKey(dtStart);
                oPayload.EndDate = this.getDateKey(dtEnd);
                oPayload.Reason = otReason;
            }

            sap.ui.core.BusyIndicator.show(0);
            
            jQuery.ajax({
                url: "/api/v3/AttendanceRequest",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify(oPayload),
                success: function () {
                    sap.ui.core.BusyIndicator.hide();
                    var sSuccessText = this.getText("msgReqSubmitted");
                    sap.ui.require(["sap/m/MessageToast"], function(MessageToast) {
                        MessageToast.show(sSuccessText);
                    });
                    this.onCloseRequestDialog();
                    this.onRefreshRequests();
                }.bind(this),
                error: function (jqXHR) {
                    sap.ui.core.BusyIndicator.hide();
                    console.error("Create request failed:", jqXHR);
                    var sMsg = "Unknown Error";
                    if (jqXHR.responseJSON && jqXHR.responseJSON.error) {
                        sMsg = jqXHR.responseJSON.error.message;
                    } else if (jqXHR.responseText) {
                        sMsg = jqXHR.responseText;
                    }
                    var sErrorText = this.getText("msgReqFailed") + "\n" + sMsg;
                    sap.ui.require(["sap/m/MessageBox"], function(MessageBox) {
                        MessageBox.error(sErrorText);
                    });
                }.bind(this)
            });
        },

        _countEditTimesheetRequestsInMonth: function (oDate) {
            if (!oDate) return 0;
            var iMonth = oDate.getMonth();
            var iYear = oDate.getFullYear();
            var sCurrentPernr = this._sCurrentPernr;
            return (this._aRawRequests || []).filter(function (oReq) {
                if (oReq.Pernr !== sCurrentPernr || oReq.RequestType !== "EDIT_TIMESHEET" || oReq.Status === "04") {
                    return false;
                }
                var sDate = (oReq.StartDate || oReq.CorrectedDate || "").substring(0, 10);
                if (!sDate) return false;
                var aParts = sDate.split("-");
                if (aParts.length !== 3) return false;
                var oReqDate = new Date(parseInt(aParts[0], 10), parseInt(aParts[1], 10) - 1, parseInt(aParts[2], 10));
                return oReqDate.getFullYear() === iYear && oReqDate.getMonth() === iMonth;
            }).length;
        },

        // ====== MY REQUESTS & HISTORY ======
        onRefreshRequests: function() {
            this._loadRequests();
        },

        _loadRequests: function() {
            var oViewModel = this.getView().getModel("view");
            var sPernr = this._sCurrentPernr;
            var sMode = oViewModel.getProperty("/reqViewMode") || "employee";
            var iRequestId = (this._iRequestLoadSequence || 0) + 1;
            this._iRequestLoadSequence = iRequestId;

            if (this._oRequestsXhr && this._oRequestsXhr.readyState !== 4) {
                this._oRequestsXhr.abort();
            }

            oViewModel.setProperty("/requestsBusy", true);
            oViewModel.setProperty("/reqDataMode", "");
            oViewModel.setProperty("/reqCountAll", 0);
            oViewModel.setProperty("/reqCountPending", 0);
            oViewModel.setProperty("/reqCountApproved", 0);
            oViewModel.setProperty("/reqCountRejected", 0);
            this.getView().setModel(new JSONModel({ rows: [] }), "reqList");

            if (sMode === "employee" && !sPernr) {
                oViewModel.setProperty("/requestsBusy", false);
                return;
            }

            var sUrl = sMode === "manager"
                ? "/api/manager/attendance-requests?status=ALL"
                : "/api/v3/AttendanceRequest?$filter=Pernr eq '" + sPernr + "'&$orderby=CreatedAt desc";
            
            // Fetch requests for current pernr
            this._oRequestsXhr = jQuery.ajax({
                url: sUrl,
                method: "GET",
                success: function(oData) {
                    if (iRequestId !== this._iRequestLoadSequence ||
                            sMode !== oViewModel.getProperty("/reqViewMode")) {
                        return;
                    }

                    var aResults = oData.value || [];
                    var aReq = [];
                    var aHist = [];
                    var iPending = 0, iApproved = 0, iRejected = 0;
                    
                    aResults.forEach(function(oReq, i) {
                        var sStatusText = oReq.Status === '01' ? 'Pending' : (oReq.Status === '02' ? 'Approved' : (oReq.Status === '03' ? 'Rejected' : 'Cancelled'));
                        var oMapped = {
                            RequestId: oReq.RequestId,
                            No: i + 1,
                            TypeIcon: oReq.RequestType === 'DAYOFF' ? 'sap-icon://calendar' : (oReq.RequestType === 'OVERTIME' ? 'sap-icon://overtime' : (oReq.RequestType === 'WFH' ? 'sap-icon://home' : 'sap-icon://edit')),
                            TypeText: oReq.RequestType === 'DAYOFF' ? 'Day Off' : (oReq.RequestType === 'OVERTIME' ? 'Overtime' : (oReq.RequestType === 'WFH' ? 'Work From Home' : 'Edit Timesheet')),
                            DateRange: oReq.StartDate ? oReq.StartDate.substring(0,10) + ' to ' + oReq.EndDate.substring(0,10) : '',
                            DurationText: oReq.Duration + ' ' + (oReq.DurationUnit === 'TAG' ? 'Day(s)' : 'Hour(s)'),
                            Status: oReq.Status,
                            StatusText: sStatusText,
                            StatusState: oReq.Status === '01' ? 'Warning' : (oReq.Status === '02' ? 'Success' : (oReq.Status === '03' ? 'Error' : 'None')),
                            EmployeeName: oReq.EmployeeName || oReq.Pernr || '',
                            ApproverName: oReq.ApproverName || (oReq.ApproverId ? oReq.ApproverId.toLowerCase() : 'Manager'),
                            ApproverId: oReq.ApproverId || '',
                            Reason: oReq.Reason || '',
                            CreatedDate: oReq.CreatedAt ? oReq.CreatedAt.substring(0,10) : '',
                            SapPostStatus: oReq.SapPostStatus || 'N/A',
                            SapPostState: oReq.SapPostStatus === 'SUCCESS' ? 'Success' : (oReq.SapPostStatus === 'ERROR' ? 'Error' : (oReq.SapPostStatus === 'CANCELLED' ? 'None' : 'Warning'))
                        };
                        
                        if (oReq.Status === '01') iPending++;
                        else if (oReq.Status === '02') iApproved++;
                        else if (oReq.Status === '03') iRejected++;
                        
                        // We show active requests in My Requests
                        if (oReq.Status === '01' || oReq.Status === '02' || oReq.Status === '03') {
                            aReq.push(oMapped);
                        }
                        aHist.push(oMapped);
                    });
                    
                    oViewModel.setProperty("/reqCountAll", aReq.length);
                    oViewModel.setProperty("/reqCountPending", iPending);
                    oViewModel.setProperty("/reqCountApproved", iApproved);
                    oViewModel.setProperty("/reqCountRejected", iRejected);
                    
                    this.getView().setModel(new JSONModel({ rows: aReq }), "reqList");
                    this.getView().setModel(new JSONModel({ rows: aHist }), "histList");
                    oViewModel.setProperty("/reqDataMode", sMode);
                    oViewModel.setProperty("/requestsBusy", false);

                    // Save raw requests for attendance table calculation
                    this._aRawRequests = aResults;
                    this._updateAttendanceTable();

                }.bind(this),
                error: function(err) {
                    if (iRequestId !== this._iRequestLoadSequence) {
                        return;
                    }
                    console.error("[MyRequests] Failed to load requests", err);
                    oViewModel.setProperty("/reqDataMode", "");
                    oViewModel.setProperty("/requestsBusy", false);
                }.bind(this),
                complete: function() {
                    if (iRequestId === this._iRequestLoadSequence) {
                        this._oRequestsXhr = null;
                    }
                }.bind(this)
            });
        },

        onApproverPress: function (oEvent) {
            var oLink = oEvent.getSource();
            var oContext = oLink.getBindingContext("reqList") || oLink.getBindingContext("histList");
            if (!oContext) {
                sap.ui.require(["sap/m/MessageToast"], function(MessageToast) {
                    MessageToast.show("Could not find binding context.");
                });
                return;
            }
            
            var oRow = oContext.getObject();
            var sApproverId = oRow.ApproverId || oRow.ApproverName;
            
            if (!sApproverId || sApproverId === "Manager") {
                sap.ui.require(["sap/m/MessageToast"], function(MessageToast) {
                    MessageToast.show("No contact details available.");
                });
                return;
            }
            
            oLink.setBusy(true);
            
            jQuery.ajax({
                url: "/api/v1/UserProfile('" + encodeURIComponent(sApproverId) + "')",
                method: "GET",
                success: function (oData) {
                    oLink.setBusy(false);
                    var oProfile = oData.d || oData || {};
                    
                    var sEmail = oProfile.UserId || sApproverId;
                    
                    var oModel = new sap.ui.model.json.JSONModel({
                        EmployeeName: oProfile.EmployeeName || sApproverId,
                        PositionName: oProfile.PositionName || "Manager",
                        OrgUnitName: oProfile.OrgUnitName || "N/A",
                        UserId: sEmail ? sEmail.toLowerCase() : "N/A",
                        Pernr: oProfile.Pernr || "N/A"
                    });
                    
                    if (!this._oApproverQuickView) {
                        sap.ui.core.Fragment.load({
                            id: this.getView().getId(),
                            name: "znxr09.timesheet.view.ApproverQuickView",
                            controller: this
                        }).then(function (oQuickView) {
                            this._oApproverQuickView = oQuickView;
                            this.getView().addDependent(this._oApproverQuickView);
                            this._oApproverQuickView.setModel(oModel, "approver");
                            this._oApproverQuickView.openBy(oLink);
                        }.bind(this));
                    } else {
                        this._oApproverQuickView.setModel(oModel, "approver");
                        this._oApproverQuickView.openBy(oLink);
                    }
                }.bind(this),
                error: function () {
                    oLink.setBusy(false);
                    sap.ui.require(["sap/m/MessageToast"], function(MessageToast) {
                        MessageToast.show("Could not load contact details.");
                    });
                }
            });
        },

        onReqViewToggle: function (oEvent) {
            var sKey = oEvent.getParameter("item").getKey();
            this.getView().getModel("view").setProperty("/reqViewMode", sKey);
            var oStatusFilter = this.byId("reqStatusFilter");
            if (oStatusFilter) {
                oStatusFilter.setSelectedKey("ALL");
            }
            this._loadRequests();
        },

        onReqStatusFilter: function (oEvent) {
            var sKey = oEvent.getParameter("key");
            var oBinding = this.byId("requestsTable").getBinding("items");
            if (sKey === "ALL") {
                oBinding.filter([]);
            } else {
                oBinding.filter([new sap.ui.model.Filter("Status", sap.ui.model.FilterOperator.EQ, sKey)]);
            }
        },

        // ====== APPROVAL ACTIONS ======
        onApproveRequest: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("reqList"); // Assuming you bind the JSON model 'reqList'
            var sReqId = oContext.getProperty("RequestId");
            this._callAction("approveAttRequest", sReqId);
        },

        onRejectRequest: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("reqList");
            var sReqId = oContext.getProperty("RequestId");
            var that = this;
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            sap.ui.require(["sap/m/Dialog", "sap/m/Button", "sap/m/TextArea", "sap/m/Label", "sap/m/MessageToast"], function(Dialog, Button, TextArea, Label, MessageToast) {
                var oTextArea = new TextArea({
                    width: "100%",
                    placeholder: oBundle.getText("lblRejectReasonPlaceholder"),
                    rows: 4
                });

                var oDialog = new Dialog({
                    title: oBundle.getText("ttlRejectReq"),
                    type: "Message",
                    contentWidth: "400px",
                    content: [
                        new Label({ text: oBundle.getText("lblReason"), labelFor: oTextArea }),
                        oTextArea
                    ],
                    beginButton: new Button({
                        text: oBundle.getText("btnConfirm"),
                        type: "Reject",
                        press: function () {
                            var sReason = oTextArea.getValue().trim();
                            if (!sReason) {
                                MessageToast.show(oBundle.getText("msgEnterRejectReason"));
                                return;
                            }
                            oDialog.close();
                            that._callAction("rejectAttRequest", sReqId, sReason);
                        }
                    }),
                    endButton: new Button({
                        text: oBundle.getText("btnCancel"),
                        press: function () {
                            oDialog.close();
                        }
                    }),
                    afterClose: function() {
                        oDialog.destroy();
                    }
                });

                that.getView().addDependent(oDialog);
                oDialog.open();
            });
        },

        onCancelRequest: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("reqList");
            var sReqId = oContext.getProperty("RequestId");
            this._callAction("cancelAttRequest", sReqId);
        },

        _callAction: function(sAction, sReqId, sReason) {
            sap.ui.core.BusyIndicator.show(0);
            var oModel = this.getOwnerComponent().getModel("attReq");
            var oAction = oModel.bindContext("/" + sAction + "(...)");
            oAction.setParameter("RequestId", sReqId);
            if (sReason) oAction.setParameter("RejectionReason", sReason);

            oAction.execute().then(function () {
                sap.ui.core.BusyIndicator.hide();
                sap.m.MessageToast.show("Action successful");
                this.onRefreshRequests();
            }.bind(this)).catch(function (oError) {
                sap.ui.core.BusyIndicator.hide();
                sap.m.MessageBox.error("Action failed: " + oError.message);
            });
        },


    });
});
