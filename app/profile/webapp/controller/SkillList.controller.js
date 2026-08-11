sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/ui/model/json/JSONModel"
], function (Controller, Filter, FilterOperator, Fragment, MessageBox, MessageToast, JSONModel) {
    "use strict";

    return Controller.extend("znxr09.znxr09f300.controller.SkillList", {

        onInit: function () {
            var oViewModel = new JSONModel({
                certCount: 0,
                pendingCount: 0,
                approvedCount: 0,
                rejectedCount: 0,
                teamCertCount: 0,
                selectedTab: "myProfile",
                sideExpanded: true
            });
            this.getView().setModel(oViewModel, "view");
            // Attach click events to Dashboard cards using Event Delegates
            var attachCardEvent = function (sId, sStatus) {
                var oCard = this.byId(sId);
                if (oCard) {
                    oCard.addEventDelegate({
                        onclick: function () {
                            this.onFilterCard(sStatus);
                        }.bind(this)
                    });
                }
            }.bind(this);
            
            attachCardEvent("cardTotal", "All");
            attachCardEvent("cardPending", "01");
            attachCardEvent("cardApproved", "02");
            attachCardEvent("cardRejected", "03");

            // Wait for user loaded to initialize filters before fetching OData
            this.getOwnerComponent().pUserLoaded.then(function(bAuthorized) {
                if (!bAuthorized) {
                    return;
                }
                var oSkillsTable = this.byId("mySkillsTable");
                var oCertsTable = this.byId("myCertsTable");
                if (oSkillsTable) {
                    this._applyTableFilters(oSkillsTable, "");
                }
                if (oCertsTable) {
                    this._applyTableFilters(oCertsTable, "");
                }
                this._updateMyCounts();
                this._consumeLaunchpadTabTarget();
            }.bind(this));

            sap.ui.getCore().getEventBus().subscribe(
                "Launchpad",
                "NavToProfileTab",
                this._onLaunchpadProfileTab,
                this
            );
        },

        /**
         * Helper: get i18n ResourceBundle
         */
        _getBundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        },

        /**
         * Formatter for composite binding with message parameters.
         * Usage in XML: formatter:'.formatMessage'
         * e.g. {parts:['i18n>userEmployeeId','user>/pernr'], formatter:'.formatMessage'}
         */
        formatMessage: function () {
            var aArgs = Array.prototype.slice.call(arguments);
            var sPattern = aArgs.shift();
            if (!sPattern) { return ""; }
            return sPattern.replace(/\{(\d+)\}/g, function (sMatch, sIndex) {
                return aArgs[parseInt(sIndex, 10)] !== undefined ? aArgs[parseInt(sIndex, 10)] : sMatch;
            });
        },

        onFilterCard: function (sStatus) {
            var sKey = this.getView().getModel("view").getProperty("/selectedTab");
            var oTable;
            if (sKey === "mySkills") {
                oTable = this.byId("mySkillsTable");
            } else if (sKey === "myCerts") {
                oTable = this.byId("myCertsTable");
            } else {
                return; // not on a filterable tab
            }

            // Save global status filter
            this._sCurrentStatusFilter = sStatus;
            
            // Trigger the search logic to re-apply all filters including the status
            var oSearchField = oTable.getHeaderToolbar().getContent().find(function(c) { return c.isA("sap.m.SearchField"); });
            if (oSearchField) {
                // Fire liveChange manually to trigger onSearchCerts
                oSearchField.fireLiveChange({ newValue: oSearchField.getValue() });
            } else {
                this._applyTableFilters(oTable, "");
            }
        },

        _updateMyCounts: function () {
            var oUserModel = this.getOwnerComponent().getModel("user");
            var sPernr = oUserModel.getProperty("/pernr");
            var oModel = this.getOwnerComponent().getModel("odata");
            
            if (!oModel) return;

            var fnGetCount = function(sStatus) {
                var sFilter = "Pernr eq '" + sPernr + "'";
                if (sStatus) {
                    sFilter += " and Status eq '" + sStatus + "'";
                }
                var sUrl = oModel.getServiceUrl() + "Request/$count?$filter=" + encodeURIComponent(sFilter);
                
                return new Promise(function(resolve) {
                    $.ajax({
                        url: sUrl,
                        method: "GET",
                        success: function(res) {
                            resolve(parseInt(res, 10) || 0);
                        },
                        error: function() {
                            resolve(0);
                        }
                    });
                });
            };

            Promise.all([
                fnGetCount(),       // Total
                fnGetCount("01"),   // Pending
                fnGetCount("02"),   // Approved
                fnGetCount("03")    // Rejected
            ]).then(function(aCounts) {
                var oViewModel = this.getView().getModel("view");
                oViewModel.setProperty("/certCount", aCounts[0]);
                oViewModel.setProperty("/pendingCount", aCounts[1]);
                oViewModel.setProperty("/approvedCount", aCounts[2]);
                oViewModel.setProperty("/rejectedCount", aCounts[3]);
            }.bind(this)).catch(function(e){
                console.error("Failed to load counts", e);
            });
        },

        onMySkillsUpdateFinished: function (oEvent) {
            var oTable = oEvent.getSource();
            var oBinding = oTable.getBinding("items");
            var sFlag = "_bFiltered_" + oTable.getId();
            
            if (!this[sFlag]) {
                this[sFlag] = true;
                this.getOwnerComponent().pUserLoaded.then(function() {
                    var oUserModel = this.getOwnerComponent().getModel("user");
                    var sPernr = oUserModel.getProperty("/pernr");
                    
                    // Force strict Control filters since XML filters might be ignored on initial load
                    var oSearchField = oTable.getHeaderToolbar().getContent().find(function(c) { return c.isA("sap.m.SearchField"); });
                    var sQuery = oSearchField ? oSearchField.getValue() : "";
                    this._applyTableFilters(oTable, sQuery);
                    
                    this._updateMyCounts();
                }.bind(this));
            }
        },

        _applyTableFilters: function (oTable, sQuery) {
            if (!oTable) return;
            var sTableId = oTable.getId();
            var oBinding = oTable.getBinding("items");
            if (!oBinding) return;
            
            var oUserModel = this.getOwnerComponent().getModel("user");
            var sPernr = oUserModel.getProperty("/pernr");
            
            var aBaseFilters = [
                new Filter("Pernr", FilterOperator.EQ, sPernr)
            ];
            
            if (sTableId.indexOf("mySkillsTable") >= 0) {
                aBaseFilters.push(new Filter("QualName", FilterOperator.NE, ""));
            } else if (sTableId.indexOf("myCertsTable") >= 0) {
                aBaseFilters.push(new Filter("CertName", FilterOperator.NE, ""));
            }

            if (this._sCurrentStatusFilter && this._sCurrentStatusFilter !== "All") {
                aBaseFilters.push(new Filter("Status", FilterOperator.EQ, this._sCurrentStatusFilter));
            }

            if (sQuery) {
                aBaseFilters.push(new Filter({
                    filters: [
                        new Filter("CertName", FilterOperator.Contains, sQuery),
                        new Filter("Source", FilterOperator.Contains, sQuery),
                        new Filter("QualName", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }
            
            if (aBaseFilters.length > 0) {
                oBinding.filter(new Filter({ filters: aBaseFilters, and: true }));
            } else {
                oBinding.filter([]);
            }

            this._activateTableBinding(oTable);
        },

        _activateTableBinding: function (oTable, bForceRefresh) {
            if (!oTable) {
                return;
            }

            var oBinding = oTable.getBinding("items");
            if (!oBinding) {
                return;
            }

            if (oBinding.isSuspended && oBinding.isSuspended()) {
                oBinding.resume();
                return;
            }

            if (bForceRefresh && oBinding.refresh) {
                oBinding.refresh();
            }
        },

        _refreshPersonalTable: function (sTableId, bForceRefresh) {
            var oTable = this.byId(sTableId);
            if (!oTable) {
                return;
            }

            var oSearchField = oTable.getHeaderToolbar().getContent().find(function(c) {
                return c.isA("sap.m.SearchField");
            });
            var sQuery = oSearchField ? oSearchField.getValue() : "";
            this._applyTableFilters(oTable, sQuery);
            this._activateTableBinding(oTable, !!bForceRefresh);
        },


        onSearchCerts: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            
            var sKey = this.getView().getModel("view").getProperty("/selectedTab");
            var oTable;
            if (sKey === "mySkills") {
                oTable = this.byId("mySkillsTable");
            } else if (sKey === "myCerts") {
                oTable = this.byId("myCertsTable");
            }
            this._applyTableFilters(oTable, sQuery);
        },



        onCertPress: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oItem.getBindingContext("odata");
            if (!oContext) {
                console.warn("Skill/certification navigation skipped: no binding context");
                return;
            }
            var sRequestId = oContext.getProperty("RequestId");
            if (!sRequestId) {
                console.warn("Skill/certification navigation skipped: RequestId is empty");
                return;
            }

            this.getOwnerComponent().getRouter().navTo("certDetail", {
                certIndex: encodeURIComponent(String(sRequestId))
            });
        },

        onAddCert: function () {
            this._openCreateDialog("CERT");
        },

        onAddSkill: function () {
            this._openCreateDialog("SKILL");
        },

        _openCreateDialog: function (sRequestType) {
            var oView = this.getView();
            var sModelName = sRequestType === "CERT" ? "newCert" : "newSkill";
            var sDialogId = sRequestType === "CERT" ? "certCreateDialog" : "skillCreateDialog";
            var sFragmentName = sRequestType === "CERT" ? "CertCreateDialog" : "SkillCreateDialog";
            var sPromiseName = "_p" + sFragmentName;

            var oNewData = new JSONModel({
                requestType: sRequestType,
                mapToSkill: false,
                mapToCert: false,
                certName: "",
                certSource: "",
                certUrl: "",
                issuedDate: "",
                qualiId: "",
                qualNameTyped: "",
                proficiency: 1,
                yearsExp: 0
            });
            oView.setModel(oNewData, sModelName);

            var oDialog = this.byId(sDialogId);
            if (oDialog) {
                this[sPromiseName] = Promise.resolve(oDialog);
            } else {
                this[sPromiseName] = null;
            }

            var that = this;
            var oBundle = this._getBundle();
            if (!this[sPromiseName]) {
                this[sPromiseName] = Fragment.load({
                    id: oView.getId(),
                    name: "znxr09.znxr09f300.view." + sFragmentName,
                    controller: this
                }).then(function (oDialogInstance) {
                    oView.addDependent(oDialogInstance);
                    return oDialogInstance;
                }).catch(function (oError) {
                    that[sPromiseName] = null;
                    MessageBox.error(oBundle.getText("msgErrorDialogLoad", [oError.message]));
                    console.error("Fragment.load error: ", oError);
                });
            }
            this[sPromiseName].then(function(oDialogInstance) {
                if (oDialogInstance) {
                    oDialogInstance.open();
                }
            });
        },

        onCancelCert: function () {
            this._closeDialog("certCreateDialog", "_pCertCreateDialog");
        },

        onCancelSkill: function () {
            this._closeDialog("skillCreateDialog", "_pSkillCreateDialog");
        },

        _closeDialog: function (sDialogId, sPromiseName) {
            var oDialog = this.byId(sDialogId);
            if (oDialog) {
                oDialog.close();
            } else if (this[sPromiseName]) {
                this[sPromiseName].then(function(oDialogInstance) {
                    if (oDialogInstance) {
                        oDialogInstance.close();
                    }
                });
            }
        },

        onSaveCert: function () {
            this._saveRequest("newCert", this.onCancelCert.bind(this));
        },

        onSaveSkill: function () {
            this._saveRequest("newSkill", this.onCancelSkill.bind(this));
        },

        onProficiencyChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oBindingInfo = oSource.getBindingInfo("selectedKey");
            var sModelName = oBindingInfo.parts[0].model;
            
            var sKey = oSource.getSelectedKey();
            var oModel = this.getView().getModel(sModelName);
            
            var fYears = 0;
            switch(sKey) {
                case "1": fYears = 0; break;
                case "2": fYears = 1; break;
                case "3": fYears = 3; break;
                case "4": fYears = 5; break;
            }
            oModel.setProperty("/yearsExp", fYears);
        },

        onYearsExpChange: function (oEvent) {
            var oSource = oEvent.getSource();
            var oBindingInfo = oSource.getBindingInfo("value");
            var sModelName = oBindingInfo.parts[0].model;
            
            var fYears = parseFloat(oSource.getValue()) || 0;
            var oModel = this.getView().getModel(sModelName);
            
            var sProfKey = "1";
            if (fYears >= 5) {
                sProfKey = "4";
            } else if (fYears >= 3) {
                sProfKey = "3";
            } else if (fYears >= 1) {
                sProfKey = "2";
            } else {
                sProfKey = "1";
            }
            oModel.setProperty("/proficiency", sProfKey);
        },

        _saveRequest: function (sModelName, fnCancel) {
            var that = this;
            var oNewModel = this.getView().getModel(sModelName);
            var oData = oNewModel.getData();
            var oBundle = this._getBundle();

            var bHasCert = (oData.requestType === "CERT") || (oData.requestType === "SKILL" && oData.mapToCert);
            var bHasSkill = (oData.requestType === "SKILL") || (oData.requestType === "CERT" && oData.mapToSkill);

            // Validation
            if (bHasCert) {
                if (!oData.certName || !oData.certName.trim()) {
                    MessageBox.error(oBundle.getText("msgErrCertNameRequired"));
                    return;
                }
                if (!oData.certSource) {
                    MessageBox.error(oBundle.getText("msgErrCertSourceRequired"));
                    return;
                }
                if (!oData.certUrl || !oData.certUrl.trim()) {
                    MessageBox.error(oBundle.getText("msgErrCertUrlRequired"));
                    return;
                }
                // Validate URL format on FE before calling backend
                if (!this._isValidUrl(oData.certUrl.trim())) {
                    MessageBox.error("Invalid URL format. Please enter a valid URL starting with http:// or https://");
                    return;
                }
            }

            if (bHasSkill && !oData.qualiId) {
                MessageBox.error(oBundle.getText("msgErrSkillRequired"));
                return;
            }

            var oUserModel = this.getOwnerComponent().getModel("user");
            // var aCatalog = this.getOwnerComponent().getModel().getProperty("/qualificationCatalog") || [];

            var sQualiId = "";
            var sQualiName = "";
            var sProficiencyText = "";
            var iProficiency = 0;
            var fYearsExp = 0;

            if (bHasSkill) {
                sQualiId = oData.qualiId || "";
                sQualiName = oData.qualNameTyped || "";
                
                iProficiency = parseInt(oData.proficiency, 10);
                var aProfMap = { 1: "Beginner", 2: "Intermediate", 3: "Advanced", 4: "Expert" };
                sProficiencyText = aProfMap[iProficiency] || "Beginner";
                fYearsExp = parseInt(oData.yearsExp, 10) || 0;
            }

            var sIssuedDate = (bHasCert && oData.issuedDate) ? oData.issuedDate : null;
            var sExpiryDate = (bHasCert && oData.expiryDate) ? oData.expiryDate : null;
            
            // Logic: Default expiry date to 1 year after issued date if empty
            if (bHasCert && sIssuedDate && !sExpiryDate) {
                var oDate = new Date(sIssuedDate);
                oDate.setFullYear(oDate.getFullYear() + 1);
                // Format as YYYY-MM-DD
                var yyyy = oDate.getFullYear();
                var mm = String(oDate.getMonth() + 1).padStart(2, '0');
                var dd = String(oDate.getDate()).padStart(2, '0');
                sExpiryDate = yyyy + "-" + mm + "-" + dd;
            }

            var oNewRequest = {
                ReqType: oData.requestType,
                Pernr: oUserModel.getProperty("/pernr"),
                CertName: bHasCert ? oData.certName.trim() : "",
                Source: bHasCert ? oData.certSource : "",
                CertUrl: bHasCert ? oData.certUrl.trim() : "",
                IssuedDate: sIssuedDate,
                ExpiryDate: sExpiryDate,
                QualiId: sQualiId,
                QualName: sQualiName,
                Proficiency: iProficiency,
                ProficiencyText: sProficiencyText,
                YearsExp: fYearsExp
            };

            // Use OData V4 ListBinding for create
            var oListBinding = this.getView().getModel("odata").bindList("/Request");

            // NOTE: oContext.created() promise does NOT reject on backend 400 errors in OData V4
            // because the framework logs "will be repeated automatically" and keeps the context pending.
            // The correct approach is to use the "createCompleted" event which fires on both success & failure.
            oListBinding.attachEventOnce("createCompleted", function (oEvent) {
                sap.ui.core.BusyIndicator.hide();

                var bSuccess = oEvent.getParameter("success");

                if (bSuccess) {
                    var sMsg = oData.requestType === "CERT"
                        ? oBundle.getText("msgCertSubmitted")
                        : oBundle.getText("msgSkillSubmitted");
                    MessageToast.show(sMsg);
                    that._updateMyCounts();

                    ["mySkillsTable", "myCertsTable"].forEach(function (sId) {
                        that._refreshPersonalTable(sId, true);
                    });

                    if (fnCancel) fnCancel();

                } else {
                    // Backend validation failed (400) — extract message from SAP Message Manager
                    var sErrorMsg = "Failed to save.";
                    try {
                        var oMsgMgr = sap.ui.getCore().getMessageManager();
                        var aMessages = oMsgMgr.getMessageModel().getData() || [];
                        // Find the latest error message
                        var aErrors = aMessages.filter(function (m) {
                            return m.type === "Error" || m.getType && m.getType() === "Error";
                        });
                        if (aErrors.length > 0) {
                            var oLastErr = aErrors[aErrors.length - 1];
                            sErrorMsg = (typeof oLastErr.getMessage === "function")
                                ? oLastErr.getMessage()
                                : (oLastErr.message || oLastErr.text || sErrorMsg);
                        }
                    } catch (e) { /* keep default message */ }

                    // Delete the failed transient context to stop OData V4 from retrying
                    var oFailedCtx = oEvent.getParameter("context");
                    if (oFailedCtx && oFailedCtx.isTransient && oFailedCtx.isTransient()) {
                        oFailedCtx.delete("$direct").catch(function () {});
                    }

                    MessageBox.error(sErrorMsg);
                }
            });

            // Trigger the create (BusyIndicator before so it shows during the HTTP round-trip)
            sap.ui.core.BusyIndicator.show(0);
            oListBinding.create(oNewRequest, /*bSkipRefresh=*/true);
        },

        onLogout: function () {
            window.location.href = "/auth/logout";
        },

        onSideNavButtonPress: function () {
            var oToolPage = this.byId("toolPage");
            var bSideExpanded = !oToolPage.getSideExpanded();
            oToolPage.setSideExpanded(bSideExpanded);
            this.getView().getModel("view").setProperty("/sideExpanded", bSideExpanded);
        },

        onSideNavSelect: function (oEvent) {
            // Remove focus to prevent "Blocked aria-hidden" warning in Chrome when switching tabs
            if (document.activeElement && document.activeElement.blur) {
                document.activeElement.blur();
            }

            var oItem = oEvent.getParameter("item");
            var sKey = oItem.getKey();
            var oViewModel = this.getView().getModel("view");

            if (sKey === "toggleNavigation") {
                var sSelectedTab = oViewModel.getProperty("/selectedTab");
                this.onSideNavButtonPress();
                this.byId("sideNav").setSelectedKey(sSelectedTab);
                return;
            }

            this._selectProfileTab(sKey);
        },

        _onLaunchpadProfileTab: function (sChannel, sEvent, oData) {
            this._selectProfileTab(oData && oData.tab);
        },

        _consumeLaunchpadTabTarget: function () {
            var sTab = "";
            try {
                sTab = window.sessionStorage.getItem("znxr09.profile.selectedTab") || "";
                if (sTab) {
                    window.sessionStorage.removeItem("znxr09.profile.selectedTab");
                }
            } catch (e) {
                sTab = "";
            }

            if (!sTab) {
                try {
                    sTab = new URL(window.location.href).searchParams.get("tab") || "";
                } catch (e) {
                    sTab = "";
                }
            }

            if (sTab) {
                this._selectProfileTab(sTab);
            }
        },

        _selectProfileTab: function (sKey) {
            if (!sKey) {
                return;
            }

            var oViewModel = this.getView().getModel("view");

            if (sKey === "profileApprovals") {
                oViewModel.setProperty("/selectedTab", "myProfile");
                return;
            }

            oViewModel.setProperty("/selectedTab", sKey);
            
            var oTable;
            if (sKey === "mySkills") {
                oTable = this.byId("mySkillsTable");
            } else if (sKey === "myCerts") {
                oTable = this.byId("myCertsTable");
            }
            if (oTable) {
                var oSearchField = oTable.getHeaderToolbar().getContent().find(function(c) { return c.isA("sap.m.SearchField"); });
                var sQuery = oSearchField ? oSearchField.getValue() : "";
                this._applyTableFilters(oTable, sQuery);
            }
        },

        onTeamListUpdateFinished: function (oEvent) {
            var oList = oEvent.getSource();
            var aItems = oList.getItems();
            if (aItems.length > 0 && !oList.getSelectedItem()) {
                var oFirstItem = aItems[0];
                oList.setSelectedItem(oFirstItem);
                this._showEmployeeDetails(oFirstItem);
            }
        },

        onEmployeeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource().getSelectedItem();
            this._showEmployeeDetails(oItem);
        },

        _showEmployeeDetails: function (oItem) {
            if (!oItem) {
                return;
            }
            var oContext = oItem.getBindingContext("team");
            if (!oContext) {
                return;
            }
            var oEmployee = Object.assign({}, oContext.getObject());
            var sPernr = oEmployee.pernr;

            // Set detailEmployee model
            var oDetailModel = new JSONModel(oEmployee);
            this.getView().setModel(oDetailModel, "detailEmployee");

            // Filter Skills Table (Kỹ năng hiện có)
            var oSkillsTable = this.byId("teamEmployeeSkillsTable");
            if (oSkillsTable) {
                var oSkillsBinding = oSkillsTable.getBinding("items");
                if (oSkillsBinding) {
                    var aSkillFilters = [
                        new Filter("Pernr", FilterOperator.EQ, sPernr),
                        new Filter("Status", FilterOperator.EQ, "02"),
                        new Filter("QualName", FilterOperator.NE, "")
                    ];
                    oSkillsBinding.filter(new Filter(aSkillFilters, true));
                }
            }

            // Filter Certs Table (Chứng chỉ hiện có)
            var oCertsTable = this.byId("teamEmployeeCertsTable");
            if (oCertsTable) {
                var oCertsBinding = oCertsTable.getBinding("items");
                if (oCertsBinding) {
                    var aCertFilters = [
                        new Filter("Pernr", FilterOperator.EQ, sPernr),
                        new Filter("Status", FilterOperator.EQ, "02"),
                        new Filter("CertName", FilterOperator.NE, "")
                    ];
                    oCertsBinding.filter(new Filter(aCertFilters, true));
                }
            }

            // Filter Requests Table (Yêu cầu chứng chỉ & kỹ năng)
            var oRequestsTable = this.byId("teamEmployeeRequestsTable");
            if (oRequestsTable) {
                var oRequestsBinding = oRequestsTable.getBinding("items");
                if (oRequestsBinding) {
                    var aRequestFilters = [
                        new Filter("Pernr", FilterOperator.EQ, sPernr),
                        new Filter("Status", FilterOperator.NE, "02")
                    ];
                    oRequestsBinding.filter(new Filter(aRequestFilters, true));
                }
            }

            // Show details container, hide placeholder
            this.byId("employeeDetailContainer").setVisible(true);
            this.byId("teamSelectPlaceholder").setVisible(false);
        },

        onSearchTeamMembers: function (oEvent) {
            var sQuery = oEvent.getParameter("newValue");
            var oList = this.byId("teamList");
            var oBinding = oList.getBinding("items");
            var aFilters = [];

            if (sQuery) {
                aFilters.push(new Filter({
                    filters: [
                        new Filter("name", FilterOperator.Contains, sQuery),
                        new Filter("pernr", FilterOperator.Contains, sQuery),
                        new Filter("position", FilterOperator.Contains, sQuery)
                    ],
                    and: false
                }));
            }
            oBinding.filter(aFilters);
        },

        onApproveTeamRequest: function (oEvent) {
            var oButton = oEvent.getSource();
            var oContext = oButton.getBindingContext("odata");
            var oBundle = this._getBundle();
            var that = this;

            MessageBox.confirm(oBundle.getText("msgConfirmApprove"), {
                title: oBundle.getText("msgConfirmApproveTitle"),
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        sap.ui.core.BusyIndicator.show(0);
                        var oAction = oContext.getModel().bindContext("/approveRequest(...)");
                        oAction.setParameter("RequestId", oContext.getProperty("RequestId"));
                        
                        oAction.execute().then(function() {
                            sap.ui.core.BusyIndicator.hide();
                            MessageToast.show(oBundle.getText("msgApproveSuccess"));
                            oContext.getModel().refresh();
                            that._refreshTeamDetail();
                        }).catch(function(oError) {
                            sap.ui.core.BusyIndicator.hide();
                            MessageBox.error(oError.message || "Approval failed.");
                        });
                    }
                }
            });
        },

        onRejectTeamRequest: function (oEvent) {
            var oButton = oEvent.getSource();
            var oContext = oButton.getBindingContext("odata");
            var oBundle = this._getBundle();
            var that = this;
            
            var oTextArea = new sap.m.TextArea({
                width: "100%",
                placeholder: oBundle.getText("msgRejectReasonPlaceholder"),
                rows: 4
            });

            var oDialog = new sap.m.Dialog({
                title: oBundle.getText("msgRejectDialogTitle"),
                type: "Message",
                state: "Warning",
                content: [
                    new sap.m.Label({ text: oBundle.getText("msgRejectReasonLabel"), labelFor: oTextArea }),
                    oTextArea
                ],
                beginButton: new sap.m.Button({
                    type: "Emphasized",
                    text: oBundle.getText("btnConfirmReject"),
                    press: function () {
                        var sReason = oTextArea.getValue();
                        if (!sReason || !sReason.trim()) {
                            MessageBox.error(oBundle.getText("msgErrRejectReasonRequired"));
                            return;
                        }
                        
                        sap.ui.core.BusyIndicator.show(0);
                        var oAction = oContext.getModel().bindContext("/rejectRequest(...)");
                        oAction.setParameter("RequestId", oContext.getProperty("RequestId"));
                        oAction.setParameter("RejectionReason", sReason.trim());
                        
                        oAction.execute().then(function() {
                            sap.ui.core.BusyIndicator.hide();
                            MessageToast.show(oBundle.getText("msgRejectSuccess"));
                            oContext.getModel().refresh();
                            that._refreshTeamDetail();
                            oDialog.close();
                        }).catch(function(oError) {
                            sap.ui.core.BusyIndicator.hide();
                            MessageBox.error(oError.message || "Rejection failed.");
                            oDialog.close();
                        });
                    }
                }),
                endButton: new sap.m.Button({
                    text: oBundle.getText("btnCancel"),
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oDialog.open();
        },

        onWithdrawRequest: function (oEvent) {
            var oButton = oEvent.getSource();
            var oContext = oButton.getBindingContext("odata");
            var oBundle = this._getBundle();
            var that = this;

            MessageBox.confirm(oBundle.getText("msgConfirmWithdraw"), {
                title: oBundle.getText("msgConfirmWithdrawTitle"),
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        sap.ui.core.BusyIndicator.show(0);
                        oContext.delete().then(function() {
                            sap.ui.core.BusyIndicator.hide();
                            MessageToast.show(oBundle.getText("msgWithdrawSuccess"));
                            that._updateMyCounts();
                        }).catch(function(oError) {
                            sap.ui.core.BusyIndicator.hide();
                            MessageBox.error(oError.message || "Withdraw failed.");
                        });
                    }
                }
            });
        },

        _refreshTeamDetail: function () {
            // Re-select the currently selected employee to refresh detail tables
            var oList = this.byId("teamList");
            if (oList) {
                var oSelectedItem = oList.getSelectedItem();
                if (oSelectedItem) {
                    this._showEmployeeDetails(oSelectedItem);
                }
            }
        },

        /**
         * Validate URL format (must start with http:// or https://)
         */
        _isValidUrl: function (sUrl) {
            return /^https?:\/\/[a-zA-Z0-9\-\.]+\.[a-zA-Z]{2,}(\/\S*)?$/.test(sUrl);
        },

        onExit: function () {
            sap.ui.getCore().getEventBus().unsubscribe(
                "Launchpad",
                "NavToProfileTab",
                this._onLaunchpadProfileTab,
                this
            );
        }
    });
});
