sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/Dialog",
    "sap/m/Button",
    "sap/m/Text"
], function (Controller, JSONModel, MessageBox, MessageToast, Dialog, Button, Text) {
    "use strict";

    return Controller.extend("znxr09.hrupload.controller.App", {

        onInit: function () {
            var oUploadModel = new JSONModel({
                fileSelected: false,
                fileName: "",
                fileSize: "",
                dataParsed: false,
                records: [],
                totalRows: 0,
                errorRows: 0,
                uploading: false,
                uploadProgress: 0,
                uploadProgressText: ""
            });
            this.getView().setModel(oUploadModel, "uploadModel");
            this.getView().setModel(new JSONModel({
                selectedTab: "upload",
                sideExpanded: true
            }), "hrTools");
            this._rawFile = null;

            // Preload SheetJS for the embedded Launchpad component. Do not show
            // an error yet: onParseFile retries and reports a user-facing error.
            this._ensureSheetJs().catch(function () {});

            this._onLaunchpadHrToolsTab = this._onLaunchpadHrToolsTab.bind(this);
            sap.ui.getCore().getEventBus().subscribe(
                "Launchpad",
                "NavToHrToolsTab",
                this._onLaunchpadHrToolsTab,
                this
            );

            this.getOwnerComponent().pUserLoaded.then(function () {
                this._selectHrToolTab(this._consumeHrToolsTabTarget() || "upload");
            }.bind(this));
        },

        onNavBack: function () {
            window.history.back();
        },

        _consumeHrToolsTabTarget: function () {
            var sTab = "";
            try {
                sTab = window.sessionStorage.getItem("znxr09.hrTools.selectedTab") || "";
                if (sTab) {
                    window.sessionStorage.removeItem("znxr09.hrTools.selectedTab");
                }
            } catch (e) {
                sTab = "";
            }

            if (!sTab) {
                try {
                    var oUrl = new URL(window.location.href);
                    sTab = oUrl.searchParams.get("tab") || "";
                } catch (e) {
                    sTab = "";
                }
            }

            return sTab;
        },

        _onLaunchpadHrToolsTab: function (sChannel, sEvent, oData) {
            this._selectHrToolTab(oData && oData.tab);
        },

        onHrToolTabSelect: function (oEvent) {
            this._selectHrToolTab(oEvent.getParameter("key"));
        },

        onHrSideNavSelect: function (oEvent) {
            var oItem = oEvent.getParameter("item");
            var sKey = oItem && oItem.getKey && oItem.getKey();
            if (sKey === "toggleNavigation") {
                this.onSideNavButtonPress();
                return;
            }
            this._selectHrToolTab(sKey);
        },

        onSideNavButtonPress: function () {
            var oHrToolsModel = this.getView().getModel("hrTools");
            oHrToolsModel.setProperty("/sideExpanded", !oHrToolsModel.getProperty("/sideExpanded"));
        },

        _selectHrToolTab: function (sKey) {
            var sSelectedKey = sKey === "profileApprovals" ? "profileApprovals" : "upload";
            var oUserModel = this.getOwnerComponent().getModel("user");
            if (sSelectedKey === "profileApprovals" &&
                    !(oUserModel && oUserModel.getProperty("/isHrAdmin"))) {
                sSelectedKey = "upload";
            }

            this.getView().getModel("hrTools").setProperty("/selectedTab", sSelectedKey);
            this._setLaunchpadTabRoute(sSelectedKey);

            if (sSelectedKey === "profileApprovals") {
                var oInboxView = this.byId("profileApprovalInboxView");
                if (oInboxView && oInboxView.getController && oInboxView.getController().activate) {
                    oInboxView.getController().activate();
                }
            }
        },

        _setLaunchpadTabRoute: function (sSelectedKey) {
            try {
                var oUrl = new URL(window.location.href);
                if (oUrl.searchParams.get("app") !== "hr-upload") {
                    return;
                }
                if (sSelectedKey && sSelectedKey !== "upload") {
                    oUrl.searchParams.set("tab", sSelectedKey);
                } else {
                    oUrl.searchParams.delete("tab");
                }
                window.history.replaceState(window.history.state, document.title, oUrl.pathname + oUrl.search + oUrl.hash);
            } catch (e) {
                // Route synchronization is best effort; the active tab model remains authoritative.
            }
        },

        _isSheetJsReady: function () {
            return !!(window.XLSX &&
                typeof window.XLSX.read === "function" &&
                window.XLSX.utils &&
                typeof window.XLSX.utils.sheet_to_json === "function" &&
                window.XLSX.SSF &&
                typeof window.XLSX.SSF.parse_date_code === "function");
        },

        _ensureSheetJs: function () {
            if (this._isSheetJsReady()) {
                return Promise.resolve(window.XLSX);
            }
            if (this._sheetJsPromise) {
                return this._sheetJsPromise;
            }

            var that = this;
            var oScript = document.createElement("script");
            oScript.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
            oScript.type = "text/javascript";
            oScript.async = true;
            oScript.setAttribute("data-znxr-sheetjs", "true");

            this._sheetJsPromise = new Promise(function (resolve, reject) {
                oScript.onload = function () {
                    if (that._isSheetJsReady()) {
                        resolve(window.XLSX);
                    } else {
                        reject(new Error("SheetJS loaded without the required Excel parser API."));
                    }
                };
                oScript.onerror = function () {
                    reject(new Error("Could not load the Excel parser library."));
                };
                document.head.appendChild(oScript);
            }).then(function (sheetJs) {
                // Cache only an in-flight load. If another script later
                // replaces window.XLSX, the next Parse must be able to reload.
                that._sheetJsPromise = null;
                return sheetJs;
            }).catch(function (error) {
                // A failed or partial load can leave window.XLSX as an empty
                // object. Clear the cached promise so the next Parse retries.
                that._sheetJsPromise = null;
                if (oScript.parentNode) {
                    oScript.parentNode.removeChild(oScript);
                }
                throw error;
            });

            return this._sheetJsPromise;
        },

        // ======================== File Selection ========================
        onFileSelected: function (oEvent) {
            var aFiles = oEvent.getParameter("files");
            if (!aFiles || aFiles.length === 0) return;
            var oFile = aFiles[0];
            this._rawFile = oFile;

            var sSize = oFile.size > 1024 * 1024
                ? (oFile.size / (1024 * 1024)).toFixed(2) + " MB"
                : (oFile.size / 1024).toFixed(1) + " KB";

            var oModel = this.getView().getModel("uploadModel");
            oModel.setProperty("/fileSelected", true);
            oModel.setProperty("/fileName", oFile.name);
            oModel.setProperty("/fileSize", sSize);
            oModel.setProperty("/dataParsed", false);
            oModel.setProperty("/records", []);
        },

        onClearFile: function () {
            this.byId("fileUploader").clear();
            this._rawFile = null;
            var oModel = this.getView().getModel("uploadModel");
            oModel.setProperty("/fileSelected", false);
            oModel.setProperty("/fileName", "");
            oModel.setProperty("/fileSize", "");
            oModel.setProperty("/dataParsed", false);
            oModel.setProperty("/records", []);
            oModel.setProperty("/totalRows", 0);
            oModel.setProperty("/errorRows", 0);
        },

        // ======================== Parse Excel ========================
        onParseFile: function () {
            if (!this._rawFile) {
                MessageToast.show("No file selected.");
                return;
            }
            sap.ui.core.BusyIndicator.show(0);
            var that = this;

            this._ensureSheetJs().then(function () {
                var reader = new FileReader();
                reader.onload = function (e) {
                    setTimeout(function() {
                        try {
                            that._processExcelData(e.target.result);
                        } catch (err) {
                            sap.ui.core.BusyIndicator.hide();
                            MessageBox.error("Failed to parse file: " + err.message);
                        }
                    }, 50);
                };
                reader.onerror = function () {
                    sap.ui.core.BusyIndicator.hide();
                    MessageBox.error("Error reading the file from disk.");
                };
                reader.readAsArrayBuffer(that._rawFile);
            }).catch(function (error) {
                sap.ui.core.BusyIndicator.hide();
                MessageBox.error("Excel parser is not available: " + error.message);
            });
        },

        _processExcelData: function (arrayBuffer) {
            // Use SheetJS (XLSX) library loaded from CDN
            if (!this._isSheetJsReady()) {
                throw new Error("Excel parser library (SheetJS) is not ready.");
            }

            var workbook = window.XLSX.read(arrayBuffer, { type: "array" });
            var sheetName = workbook.SheetNames[0];
            var worksheet = workbook.Sheets[sheetName];
            // Keep Excel numeric date serials intact. Converting a WorkDate
            // into a JavaScript Date makes a date-only field vulnerable to a
            // browser timezone shift (for example 2026-08-08 -> 2026-08-07).
            var rawData = window.XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true });
            var bDate1904 = !!(workbook.Workbook && workbook.Workbook.WBProps && workbook.Workbook.WBProps.date1904);

            if (rawData.length < 2) {
                MessageBox.warning("The Excel file contains no data rows (only header or empty).");
                return;
            }

            // Skip header row (row 0)
            var aRecords = [];

            for (var i = 1; i < rawData.length; i++) {
                var row = rawData[i];
                // Skip completely empty rows
                if (!row || row.every(function(cell) { return cell === "" || cell === null || cell === undefined; })) continue;

                var record = this._convertRow(row, i + 1, bDate1904);
                aRecords.push(record);
            }

            // The SAP staging key is PERNR + WorkDate. Flag duplicates before
            // the user can submit the batch so an overwrite is never ambiguous.
            this._markDuplicateRows(aRecords);

            var iErrors = aRecords.filter(function (record) { return record._hasError; }).length;

            var oModel = this.getView().getModel("uploadModel");
            oModel.setProperty("/records", aRecords);
            oModel.setProperty("/totalRows", aRecords.length);
            oModel.setProperty("/errorRows", iErrors);
            oModel.setProperty("/dataParsed", true);

            sap.ui.core.BusyIndicator.hide();

            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            MessageToast.show(oBundle.getText("msgParsed", [aRecords.length, iErrors]));
        },

        /**
         * Convert a single Excel row to internal record format.
         * Columns: 0=PERNR, 1=WorkDate, 2=FirstEntry, 3=LastExit,
         *          4=IOT, 5=IOTwF, 6=IWA, 7=#Entry, 8=#Exit
         */
        _convertRow: function (row, rowIndex, bDate1904) {
            var errors = [];
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            // --- PERNR: pad to 8 digits ---
            var sPernr = String(row[0] || "").trim();
            if (!sPernr) {
                errors.push(oBundle.getText("errPernrEmpty"));
            } else if (!/^\d{1,8}$/.test(sPernr)) {
                errors.push(oBundle.getText("errPernrInvalid"));
            } else {
                while (sPernr.length < 8) sPernr = "0" + sPernr;
            }

            // --- Work Date conversion ---
            var vDate = row[1];
            var sDate = vDate === undefined || vDate === null ? "" : String(vDate).trim();
            var sDateInternal = this._parseDate(vDate, bDate1904);
            var sDateDisplay = sDate;
            if (!sDateInternal) {
                errors.push(oBundle.getText("errDateInvalid"));
            } else {
                sDateDisplay = sDateInternal.substring(0, 4) + "-" + sDateInternal.substring(4, 6) + "-" + sDateInternal.substring(6, 8);
            }

            // --- Time conversion ---
            var sEntry = this._parseTimeUpload(row[2]);
            var sExit = this._parseTimeUpload(row[3]);
            if (!sEntry) errors.push(oBundle.getText("errFirstEntryInvalid"));
            if (!sExit) errors.push(oBundle.getText("errLastExitInvalid"));
            if (sEntry && sExit && sEntry === sExit) errors.push(oBundle.getText("errTimeRangeInvalid"));

            var sEntryDisplay = sEntry ? sEntry.substring(0,2) + ":" + sEntry.substring(2,4) + ":" + sEntry.substring(4,6) : "";
            var sExitDisplay = sExit ? sExit.substring(0,2) + ":" + sExit.substring(2,4) + ":" + sExit.substring(4,6) : "";

            var fIot = Number(row[4] || 0);
            var fIotwf = Number(row[5] || 0);
            var fIwa = Number(row[6] || 0);
            var iEntryCount = Number(row[7] || 0);
            var iExitCount = Number(row[8] || 0);
            if (!Number.isFinite(fIot) || fIot < 0 || fIot > 999.99 ||
                !Number.isFinite(fIotwf) || fIotwf < 0 || fIotwf > 999.99 ||
                !Number.isFinite(fIwa) || fIwa < 0 || fIwa > 999.99) {
                errors.push(oBundle.getText("errHoursInvalid"));
            }
            if (!Number.isInteger(iEntryCount) || iEntryCount < 0 || iEntryCount > 32767 ||
                !Number.isInteger(iExitCount) || iExitCount < 0 || iExitCount > 32767) {
                errors.push(oBundle.getText("errCountsInvalid"));
            }

            return {
                _rowIndex: rowIndex,
                _hasError: errors.length > 0,
                _errorMsg: errors.join("; "),
                Pernr: sPernr,
                WorkDate: sDateInternal || "",
                WorkDateDisplay: sDateDisplay,
                FirstEntry: sEntry,
                FirstEntryDisplay: sEntryDisplay,
                LastExit: sExit,
                LastExitDisplay: sExitDisplay,
                Iot: Number.isFinite(fIot) ? fIot : 0,
                Iotwf: Number.isFinite(fIotwf) ? fIotwf : 0,
                Iwa: Number.isFinite(fIwa) ? fIwa : 0,
                NumberOfEntry: Number.isInteger(iEntryCount) ? iEntryCount : 0,
                NumberOfExit: Number.isInteger(iExitCount) ? iExitCount : 0
            };
        },

        _parseTimeUpload: function (sTime) {
            if (!sTime && sTime !== 0) return "";
            var s = String(sTime).trim();

            // If it's a decimal (fraction of a day from Excel raw format)
            if (!isNaN(s) && Number(s) >= 0 && Number(s) < 1 && s.indexOf(":") === -1) {
                var totalSeconds = Math.round(Number(s) * 86400);
                if (totalSeconds >= 86400) return "";
                var h = Math.floor(totalSeconds / 3600);
                var m = Math.floor((totalSeconds % 3600) / 60);
                var sec = totalSeconds % 60;
                return ("0" + h).slice(-2) + ("0" + m).slice(-2) + ("0" + sec).slice(-2);
            }

            // If it contains ":"
            if (s.indexOf(":") !== -1) {
                var parts = s.split(":");
                if (parts.length < 2 || parts.length > 3) return "";
                var iHour = Number(parts[0]);
                var iMinute = Number(parts[1]);
                var iSecond = Number(parts[2] || 0);
                if (!Number.isInteger(iHour) || iHour < 0 || iHour > 23 ||
                    !Number.isInteger(iMinute) || iMinute < 0 || iMinute > 59 ||
                    !Number.isInteger(iSecond) || iSecond < 0 || iSecond > 59) return "";
                return ("0" + iHour).slice(-2) + ("0" + iMinute).slice(-2) + ("0" + iSecond).slice(-2);
            }

            // Numeric HHMM or HHMMSS.
            if (!/^\d{1,6}$/.test(s)) return "";
            var sClean;
            if (s.length <= 2) {
                sClean = ("00" + s).slice(-2) + "0000";
            } else if (s.length <= 4) {
                sClean = ("0000" + s).slice(-4) + "00";
            } else {
                sClean = ("000000" + s).slice(-6);
            }
            var iHours = Number(sClean.substring(0, 2));
            var iMinutes = Number(sClean.substring(2, 4));
            var iSeconds = Number(sClean.substring(4, 6));
            return iHours <= 23 && iMinutes <= 59 && iSeconds <= 59 ? sClean : "";
        },

        /**
         * Parse a date-only Excel value into YYYYMMDD.
         * Supports: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYYMMDD, Excel serial number
         */
        _parseDate: function (vDate, bDate1904) {
            if (vDate === undefined || vDate === null || vDate === "") return null;

            var s = String(vDate).trim();

            // Preserve a textual YYYYMMDD value as a date key rather than
            // mistaking it for an Excel serial number.
            if (/^\d{8}$/.test(s)) return this._isValidDateUpload(s) ? s : null;

            // SheetJS applies the Excel 1900 leap-year compatibility rule and
            // supports the optional 1904 date system. Do not construct a
            // JavaScript Date here: WorkDate has no time component and must
            // never be shifted by the browser timezone.
            if (!isNaN(s) && Number(s) > 10000) {
                var oDateCode = window.XLSX.SSF.parse_date_code(Number(s), { date1904: !!bDate1904 });
                if (!oDateCode || !oDateCode.y || !oDateCode.m || !oDateCode.d) return null;
                var sExcelDate = String(oDateCode.y).padStart(4, "0") +
                    String(oDateCode.m).padStart(2, "0") +
                    String(oDateCode.d).padStart(2, "0");
                return this._isValidDateUpload(sExcelDate) ? sExcelDate : null;
            }

            // DD.MM.YYYY or DD/MM/YYYY
            var m1 = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
            if (m1) {
                var sEuropeanDate = m1[3] + ("0" + m1[2]).slice(-2) + ("0" + m1[1]).slice(-2);
                return this._isValidDateUpload(sEuropeanDate) ? sEuropeanDate : null;
            }

            // YYYY-MM-DD
            var m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m2) {
                var sIsoDate = m2[1] + m2[2] + m2[3];
                return this._isValidDateUpload(sIsoDate) ? sIsoDate : null;
            }

            return null;
        },

        _isValidDateUpload: function (sDate) {
            if (!/^\d{8}$/.test(sDate)) return false;
            var iYear = Number(sDate.substring(0, 4));
            var iMonth = Number(sDate.substring(4, 6));
            var iDay = Number(sDate.substring(6, 8));
            var oDate = new Date(Date.UTC(iYear, iMonth - 1, iDay));
            return oDate.getUTCFullYear() === iYear &&
                oDate.getUTCMonth() === iMonth - 1 &&
                oDate.getUTCDate() === iDay;
        },

        _markDuplicateRows: function (aRecords) {
            var sDuplicateError = this.getView().getModel("i18n").getResourceBundle().getText("errDuplicateKey");
            var oSeenKeys = {};

            aRecords.forEach(function (record) {
                var aErrors = String(record._errorMsg || "").split("; ").filter(function (message) {
                    return message && message !== sDuplicateError;
                });
                record._errorMsg = aErrors.join("; ");
                record._hasError = aErrors.length > 0;
            });

            aRecords.forEach(function (record) {
                if (!record.Pernr || !record.WorkDate) return;
                var sKey = record.Pernr + "|" + record.WorkDate;
                if (oSeenKeys[sKey]) {
                    record._hasError = true;
                    record._errorMsg = [record._errorMsg, sDuplicateError].filter(Boolean).join("; ");
                    oSeenKeys[sKey]._hasError = true;
                    oSeenKeys[sKey]._errorMsg = [oSeenKeys[sKey]._errorMsg, sDuplicateError].filter(Boolean).join("; ");
                } else {
                    oSeenKeys[sKey] = record;
                }
            });
        },

        // ======================== Delete Selected Rows ========================
        onDeleteSelected: function () {
            var oTable = this.byId("previewTable");
            var aItems = oTable.getSelectedItems();
            if (aItems.length === 0) {
                MessageToast.show("No rows selected.");
                return;
            }

            var oModel = this.getView().getModel("uploadModel");
            var aRecords = oModel.getProperty("/records").slice();

            // Get indices from bindings
            var aIndices = aItems.map(function(oItem) {
                var sPath = oItem.getBindingContext("uploadModel").getPath(); // e.g. "/records/5"
                return parseInt(sPath.split("/")[2], 10);
            });

            // Remove in reverse order to maintain correct indices
            aIndices.sort(function(a, b) { return b - a; });
            aIndices.forEach(function(idx) { aRecords.splice(idx, 1); });

            // Re-evaluate duplicates because deleting one side of a duplicate
            // pair must clear the error on the remaining row.
            this._markDuplicateRows(aRecords);
            var iErrors = aRecords.filter(function(r) { return r._hasError; }).length;

            oModel.setProperty("/records", aRecords);
            oModel.setProperty("/totalRows", aRecords.length);
            oModel.setProperty("/errorRows", iErrors);
            oTable.removeSelections(true);

            MessageToast.show(aIndices.length + " row(s) removed.");
        },

        // ======================== Check Existing Data ========================
        onCheckExisting: function () {
            var oModel = this.getView().getModel("uploadModel");
            var aRecords = oModel.getProperty("/records");
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            if (!aRecords || aRecords.length === 0) {
                MessageToast.show("No data to check.");
                return;
            }
            if (oModel.getProperty("/errorRows") > 0) {
                MessageBox.error(oBundle.getText("msgFixErrors"));
                return;
            }

            var aKeys = aRecords.map(function (rec) {
                return {
                    Pernr: rec.Pernr,
                    WorkDate: rec.WorkDate.substring(0, 4) + "-" +
                        rec.WorkDate.substring(4, 6) + "-" +
                        rec.WorkDate.substring(6, 8)
                };
            });

            // Check only the employee/date keys in the file against actual
            // SAP attendance exposed by WorkSchedule (PA2002).
            var that = this;
            var sUrl = "/api/v4/checkExisting";
            jQuery.ajax({
                url: sUrl,
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({ records: aKeys }),
                success: function (result) {
                    var iCount = result.count || 0;
                    var sDateList = (result.dates || []).map(function (date) {
                        var parts = String(date).substring(0, 10).split("-");
                        return parts.length === 3 ? parts[2] + "/" + parts[1] + "/" + parts[0] : date;
                    }).join(", ");
                    if (iCount > 0) {
                        MessageBox.confirm(
                            oBundle.getText("msgExistingSapData", [iCount, sDateList]),
                            {
                                title: oBundle.getText("titleConfirmOverwrite"),
                                onClose: function (oAction) {
                                    if (oAction === MessageBox.Action.OK) {
                                        that._doUpload(aRecords);
                                    }
                                }
                            }
                        );
                    } else {
                        MessageBox.information(oBundle.getText("msgNoExistingSap"));
                    }
                },
                error: function () {
                    MessageBox.warning(oBundle.getText("msgCheckFailed"));
                }
            });
        },

        // ======================== Upload to SAP ========================
        onUploadToSAP: function () {
            var oModel = this.getView().getModel("uploadModel");
            var aRecords = oModel.getProperty("/records");
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            if (!aRecords || aRecords.length === 0) {
                MessageToast.show("No data to upload.");
                return;
            }
            if (oModel.getProperty("/errorRows") > 0) {
                MessageBox.error(oBundle.getText("msgFixErrors"));
                return;
            }

            // Final confirmation
            var that = this;
            MessageBox.confirm(
                oBundle.getText("msgConfirmUpload", [aRecords.length]),
                {
                    title: oBundle.getText("titleConfirmUpload"),
                    onClose: function (oAction) {
                        if (oAction === MessageBox.Action.OK) {
                            that._doUpload(aRecords);
                        }
                    }
                }
            );
        },

        _doUpload: function (aRecords) {
            var oModel = this.getView().getModel("uploadModel");
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            oModel.setProperty("/uploading", true);
            oModel.setProperty("/uploadProgress", 0);
            oModel.setProperty("/uploadProgressText", "0 / " + aRecords.length);

            // Prepare payload: clean internal fields
            var aPayload = aRecords.map(function (rec) {
                return {
                    Pernr: rec.Pernr,
                    WorkDate: rec.WorkDate.substring(0, 4) + "-" + rec.WorkDate.substring(4, 6) + "-" + rec.WorkDate.substring(6, 8),
                    FirstEntry: rec.FirstEntry.substring(0, 2) + ":" + rec.FirstEntry.substring(2, 4) + ":" + rec.FirstEntry.substring(4, 6),
                    LastExit: rec.LastExit.substring(0, 2) + ":" + rec.LastExit.substring(2, 4) + ":" + rec.LastExit.substring(4, 6),
                    Iot: rec.Iot,
                    Iotwf: rec.Iotwf,
                    Iwa: rec.Iwa,
                    NumberOfEntry: rec.NumberOfEntry,
                    NumberOfExit: rec.NumberOfExit
                };
            });

            var sSourceFileName = this._rawFile ? this._rawFile.name : "HR_UPLOAD";
            jQuery.ajax({
                url: "/api/v4/uploadBatch",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({
                    records: aPayload,
                    sourceFileName: sSourceFileName
                }),
                success: function (result) {
                    oModel.setProperty("/uploading", false);
                    oModel.setProperty("/uploadProgress", 100);
                    oModel.setProperty("/uploadProgressText", aRecords.length + " / " + aRecords.length);

                    var iSuccess = result.success || 0;
                    var iFailed = result.failed || 0;
                    if (iFailed === 0) {
                        MessageBox.success(oBundle.getText("msgUploadSuccess", [iSuccess, result.batchId || "-"]));
                    } else {
                        MessageBox.warning(oBundle.getText("msgUploadPartial", [iSuccess, iFailed, result.batchId || "-"]));
                    }
                },
                error: function (xhr) {
                    oModel.setProperty("/uploading", false);
                    var sErr = "";
                    try {
                        var oError = JSON.parse(xhr.responseText).error;
                        sErr = typeof oError === "string" ? oError : (oError && oError.message) || xhr.statusText;
                    } catch(e) {
                        sErr = xhr.statusText;
                    }
                    MessageBox.error(oBundle.getText("msgUploadFailed") + "\n" + sErr);
                }
            });
        },

        onExit: function () {
            sap.ui.getCore().getEventBus().unsubscribe(
                "Launchpad",
                "NavToHrToolsTab",
                this._onLaunchpadHrToolsTab,
                this
            );
        }
    });
});
