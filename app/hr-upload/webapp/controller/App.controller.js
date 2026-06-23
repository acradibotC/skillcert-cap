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
            // Dynamically load SheetJS for Launchpad compatibility
            if (typeof XLSX === "undefined") {
                var oScript = document.createElement("script");
                oScript.src = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";
                oScript.type = "text/javascript";
                document.head.appendChild(oScript);
            }

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
            this._rawFile = null;
        },

        onNavBack: function () {
            window.history.back();
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
            reader.readAsArrayBuffer(this._rawFile);
        },

        _processExcelData: function (arrayBuffer) {
            // Use SheetJS (XLSX) library loaded from CDN
            if (typeof XLSX === "undefined") {
                MessageBox.error("Excel parser library (SheetJS) is not loaded. Please refresh and try again.");
                return;
            }

            var workbook = XLSX.read(arrayBuffer, { type: "array" });
            var sheetName = workbook.SheetNames[0];
            var worksheet = workbook.Sheets[sheetName];
            var rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

            if (rawData.length < 2) {
                MessageBox.warning("The Excel file contains no data rows (only header or empty).");
                return;
            }

            // Skip header row (row 0)
            var aRecords = [];
            var iErrors = 0;

            for (var i = 1; i < rawData.length; i++) {
                var row = rawData[i];
                // Skip completely empty rows
                if (!row || row.every(function(cell) { return cell === "" || cell === null || cell === undefined; })) continue;

                var record = this._convertRow(row, i + 1);
                if (record._hasError) iErrors++;
                aRecords.push(record);
            }

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
        _convertRow: function (row, rowIndex) {
            var errors = [];
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            // --- PERNR: pad to 8 digits ---
            var sPernr = String(row[0] || "").trim();
            if (!sPernr) {
                errors.push(oBundle.getText("errPernrEmpty"));
            } else {
                while (sPernr.length < 8) sPernr = "0" + sPernr;
            }

            // --- Work Date conversion ---
            var sDate = String(row[1] || "").trim();
            var sDateInternal = this._parseDate(sDate);
            var sDateDisplay = sDate;
            if (!sDateInternal) {
                errors.push(oBundle.getText("errDateInvalid"));
            } else {
                sDateDisplay = sDateInternal.substring(0, 4) + "-" + sDateInternal.substring(4, 6) + "-" + sDateInternal.substring(6, 8);
            }

            // --- Time conversion ---
            var sEntry = this._parseTimeUpload(row[2]);
            var sExit = this._parseTimeUpload(row[3]);

            var sEntryDisplay = sEntry ? sEntry.substring(0,2) + ":" + sEntry.substring(2,4) + ":" + sEntry.substring(4,6) : "";
            var sExitDisplay = sExit ? sExit.substring(0,2) + ":" + sExit.substring(2,4) + ":" + sExit.substring(4,6) : "";

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
                Iot: parseFloat(row[4]) || 0,
                Iotwf: parseFloat(row[5]) || 0,
                Iwa: parseFloat(row[6]) || 0,
                NumberOfEntry: parseInt(row[7]) || 0,
                NumberOfExit: parseInt(row[8]) || 0
            };
        },

        _parseTimeUpload: function (sTime) {
            if (!sTime && sTime !== 0) return "";
            var s = String(sTime).trim();
            
            // If it's a decimal (fraction of a day from Excel raw format)
            if (!isNaN(s) && Number(s) >= 0 && Number(s) < 1 && s.indexOf(":") === -1) {
                var totalSeconds = Math.round(Number(s) * 86400);
                var h = Math.floor(totalSeconds / 3600);
                var m = Math.floor((totalSeconds % 3600) / 60);
                var sec = totalSeconds % 60;
                return ("0" + h).slice(-2) + ("0" + m).slice(-2) + ("0" + sec).slice(-2);
            }
            
            // If it contains ":"
            if (s.indexOf(":") !== -1) {
                var parts = s.split(":");
                var h = ("0" + (parts[0] || "0")).slice(-2);
                var m = ("0" + (parts[1] || "0")).slice(-2);
                var sec = ("0" + (parts[2] || "0")).slice(-2);
                return h + m + sec;
            }
            
            // If it's already HHMMSS or HMMSS (numbers only)
            var sClean = s.replace(/\D/g, "");
            while (sClean.length > 0 && sClean.length < 6) sClean = "0" + sClean;
            return sClean;
        },

        /**
         * Parse date string into YYYYMMDD.
         * Supports: DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYYMMDD, Excel serial number
         */
        _parseDate: function (sDate) {
            if (!sDate) return null;

            // Excel serial number (numeric)
            if (!isNaN(sDate) && Number(sDate) > 10000) {
                var excelEpoch = new Date(1899, 11, 30);
                var d = new Date(excelEpoch.getTime() + Number(sDate) * 86400000);
                var mm = ("0" + (d.getMonth() + 1)).slice(-2);
                var dd = ("0" + d.getDate()).slice(-2);
                return d.getFullYear() + mm + dd;
            }

            var s = String(sDate).trim();

            // DD.MM.YYYY or DD/MM/YYYY
            var m1 = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
            if (m1) return m1[3] + ("0" + m1[2]).slice(-2) + ("0" + m1[1]).slice(-2);

            // YYYY-MM-DD
            var m2 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (m2) return m2[1] + m2[2] + m2[3];

            // YYYYMMDD
            if (/^\d{8}$/.test(s)) return s;

            return null;
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

            // Recount errors
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

            // Collect unique YYYYMM months
            var oMonths = {};
            aRecords.forEach(function (rec) {
                if (rec.WorkDate) {
                    var sMonth = rec.WorkDate.substring(0, 6);
                    oMonths[sMonth] = true;
                }
            });
            var aMonthKeys = Object.keys(oMonths);
            if (aMonthKeys.length === 0) {
                MessageToast.show("No valid dates to check.");
                return;
            }

            var sMonthList = aMonthKeys.map(function (m) {
                return m.substring(4, 6) + "/" + m.substring(0, 4);
            }).join(", ");

            // Call backend to check existing count
            var that = this;
            var sUrl = "/api/v4/checkExisting";
            jQuery.ajax({
                url: sUrl,
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({ months: aMonthKeys }),
                success: function (result) {
                    var iCount = result.count || 0;
                    if (iCount > 0) {
                        MessageBox.confirm(
                            oBundle.getText("msgExistingData", [iCount, sMonthList]),
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
                        MessageBox.information(oBundle.getText("msgNoExisting", [sMonthList]));
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
                    WorkDate: rec.WorkDate,
                    FirstEntry: rec.FirstEntry,
                    LastExit: rec.LastExit,
                    Iot: rec.Iot,
                    Iotwf: rec.Iotwf,
                    Iwa: rec.Iwa,
                    NumberOfEntry: rec.NumberOfEntry,
                    NumberOfExit: rec.NumberOfExit
                };
            });

            var that = this;
            jQuery.ajax({
                url: "/api/v4/uploadBatch",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({ records: aPayload }),
                success: function (result) {
                    oModel.setProperty("/uploading", false);
                    oModel.setProperty("/uploadProgress", 100);
                    oModel.setProperty("/uploadProgressText", aRecords.length + " / " + aRecords.length);

                    var iSuccess = result.success || 0;
                    var iFailed = result.failed || 0;
                    if (iFailed === 0) {
                        MessageBox.success(oBundle.getText("msgUploadSuccess", [iSuccess]));
                    } else {
                        MessageBox.warning(oBundle.getText("msgUploadPartial", [iSuccess, iFailed]));
                    }
                },
                error: function (xhr) {
                    oModel.setProperty("/uploading", false);
                    var sErr = "";
                    try { sErr = JSON.parse(xhr.responseText).error || xhr.statusText; } catch(e) { sErr = xhr.statusText; }
                    MessageBox.error(oBundle.getText("msgUploadFailed") + "\n" + sErr);
                }
            });
        }
    });
});
