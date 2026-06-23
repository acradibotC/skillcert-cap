sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
    "use strict";

    return UIComponent.extend("znxr09.znxr09f300.Component", {

        metadata: {
            manifest: "json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);

            // Alias default model to "odata"
            var oDefaultModel = this.getModel();
            if (oDefaultModel) {
                this.setModel(oDefaultModel, "odata");
            }

            // Set up current user model
            var oUserModel = new JSONModel({
                pernr: "",
                name: "",
                position: "",
                department: "",
                isManager: false
            });
            this.setModel(oUserModel, "user");

            var fnResolveUser;
            this.pUserLoaded = new Promise(function(resolve) {
                fnResolveUser = resolve;
            });
            
            var that = this;
            var fnEvaluateHierarchy = function() {
                var sUserId = oUserModel.getProperty("/userId");
                var sPernr = oUserModel.getProperty("/pernr");
                var bIsManager = false;
                var aTeam = [];
                
                var fnFinish = function() {
                    oUserModel.setProperty("/isManager", bIsManager);
                    var oTeamModel = new JSONModel({ teamMembers: aTeam });
                    that.setModel(oTeamModel, "team");
                    fnResolveUser();
                };

                if (!sUserId) {
                    fnFinish();
                    return;
                }

                // NOTE: We are now querying the backend OData using the user's Email
                var oODataModel = that.getModel(); // Default unnamed model in manifest.json
                if (oODataModel) {
                    var sEmail = oUserModel.getProperty("/email") || "";
                    if (!sEmail) {
                        fnFinish();
                        return;
                    }
                    var oContext = oODataModel.bindContext("/UserProfile('" + sEmail + "')");
                    oContext.requestObject().then(function(oProfile) {
                        if (oProfile) {
                            // Update the current user model with real profile data
                            if (oProfile.Pernr) oUserModel.setProperty("/pernr", oProfile.Pernr);
                            if (oProfile.EmployeeName) oUserModel.setProperty("/name", oProfile.EmployeeName);
                            if (oProfile.PositionName || oProfile.PositionId) {
                                oUserModel.setProperty("/position", oProfile.PositionName || oProfile.PositionId);
                            }
                            if (oProfile.OrgUnitName || oProfile.OrgUnitId) {
                                oUserModel.setProperty("/department", oProfile.OrgUnitName || oProfile.OrgUnitId);
                            }

                            if (oProfile.IsManager) {
                                bIsManager = true;
                                
                                // Fetch team members from backend dynamically using Email
                                var oListBinding = oODataModel.bindList("/TeamMembers", null, null, [
                                    new sap.ui.model.Filter("ManagerUserId", "EQ", sEmail)
                                ]);
                                
                                oListBinding.requestContexts(0, 100).then(function(aContexts) {
                                    aTeam = aContexts.map(function(c) {
                                        var oCtx = c.getObject();
                                        return {
                                            pernr: oCtx.EmployeePernr,
                                            userId: oCtx.EmployeeUserId || oCtx.EmployeePernr, // fallback if no user id
                                            name: oCtx.EmployeeName,
                                            position: oCtx.PositionName || oCtx.PositionId,
                                            department: oCtx.OrgUnitName || oCtx.OrgUnitId || "",
                                            email: oCtx.EmployeeEmail || "N/A",
                                            phone: oCtx.EmployeePhone || "N/A",
                                            avatarUrl: "sap-icon://employee"
                                        };
                                    });
                                    fnFinish();
                                }).catch(function(e) {
                                    console.warn("Failed to fetch Team Members from backend", e);
                                    fnFinish();
                                });
                                
                                return; // Async fnFinish will be called
                            }
                        }
                        fnFinish();
                    }).catch(function(e) {
                        console.warn("Failed to fetch UserProfile from backend, fallback to false", e);
                        fnFinish();
                    });
                } else {
                    fnFinish();
                }
            };

            // Try to get user from Custom CAP API Endpoint
            $.ajax({
                url: "/api/currentUser",
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                success: function (oData) {
                    console.log("Custom CAP User Info:", oData); 
                    if (oData && oData.email) {
                        oUserModel.setProperty("/userId", oData.userId);
                        oUserModel.setProperty("/email", oData.email);
                        oUserModel.setProperty("/name", oData.name || oData.email);
                        oUserModel.setProperty("/pernr", oData.pernr);
                        oUserModel.setProperty("/isManager", oData.isManager || false);
                    }
                    fnEvaluateHierarchy();
                },
                error: function (jqXHR, textStatus, errorThrown) {
                    console.warn("Failed to fetch CAP User Info. Fallback to default.", textStatus, errorThrown);
                    // For mock/development without server running
                    oUserModel.setProperty("/email", "test@gmail.com");
                    oUserModel.setProperty("/pernr", "00000271");
                    oUserModel.setProperty("/isManager", true);
                    fnEvaluateHierarchy();
                }
            });
            this.setModel(oUserModel, "user");

            // Initialize router
            this.getRouter().initialize();
        }
    });
});
