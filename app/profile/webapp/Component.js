sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator"
], function (UIComponent, JSONModel, Filter, FilterOperator) {
    "use strict";

    function initialsFromName(sName) {
        return String(sName || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(-2)
            .map(function (sPart) { return sPart.charAt(0).toUpperCase(); })
            .join("");
    }

    function hasRole(aRoles, sRole) {
        return (aRoles || []).some(function (vRole) {
            var sValue = typeof vRole === "string" ? vRole : (vRole && (vRole.name || vRole.role));
            return String(sValue || "").toUpperCase() === sRole;
        });
    }

    return UIComponent.extend("znxr09.znxr09f300.Component", {

        metadata: {
            manifest: "json"
        },

        init: function () {
            UIComponent.prototype.init.apply(this, arguments);

            var oDefaultModel = this.getModel();
            if (oDefaultModel) {
                this.setModel(oDefaultModel, "odata");
            }

            var oUserModel = new JSONModel({
                authorized: false,
                loadState: "loading",
                userId: "",
                email: "",
                sapUserId: "",
                pernr: "",
                name: "",
                initials: "",
                position: "",
                department: "",
                phone: "",
                roles: [],
                isManager: false,
                isHrAdmin: false
            });
            this.setModel(oUserModel, "user");

            var fnResolveUser;
            this.pUserLoaded = new Promise(function (resolve) {
                fnResolveUser = resolve;
            });

            var that = this;
            var bResolved = false;
            var fnFinish = function (bAuthorized, aTeam) {
                if (bResolved) {
                    return;
                }
                bResolved = true;
                that.setModel(new JSONModel({ teamMembers: aTeam || [] }), "team");
                oUserModel.setProperty("/loadState", bAuthorized ? "ready" : "denied");
                fnResolveUser(Boolean(bAuthorized));
            };

            var fnLoadProfileAndHierarchy = function () {
                var sEmail = oUserModel.getProperty("/email");
                var sSapUserId = oUserModel.getProperty("/sapUserId") || sEmail;
                var oODataModel = that.getModel("odata");

                if (!sSapUserId || !oODataModel) {
                    fnFinish(true, []);
                    return;
                }

                var oContext = oODataModel.bindContext("/UserProfile('" +
                    String(sSapUserId).replace(/'/g, "''") + "')");

                oContext.requestObject().then(function (oProfile) {
                    if (!oProfile) {
                        fnFinish(true, []);
                        return;
                    }

                    var sName = oProfile.EmployeeName || oUserModel.getProperty("/name");
                    oUserModel.setProperty("/pernr", oProfile.Pernr || oUserModel.getProperty("/pernr"));
                    oUserModel.setProperty("/name", sName);
                    oUserModel.setProperty("/initials", initialsFromName(sName));
                    oUserModel.setProperty("/position", oProfile.PositionName || oProfile.PositionId || "");
                    oUserModel.setProperty("/department", oProfile.OrgUnitName || oProfile.OrgUnitId || "");

                    var bIsManager = Boolean(oProfile.IsManager || oUserModel.getProperty("/isManager"));
                    oUserModel.setProperty("/isManager", bIsManager);
                    if (!bIsManager) {
                        fnFinish(true, []);
                        return;
                    }

                    var oListBinding = oODataModel.bindList("/TeamMembers", null, null, [
                        new Filter("ManagerUserId", FilterOperator.EQ, sSapUserId)
                    ]);

                    return oListBinding.requestContexts(0, 100).then(function (aContexts) {
                        var aTeam = aContexts.map(function (oTeamContext) {
                            var oMember = oTeamContext.getObject();
                            return {
                                pernr: oMember.EmployeePernr,
                                userId: oMember.EmployeeUserId || oMember.EmployeePernr,
                                name: oMember.EmployeeName,
                                position: oMember.PositionName || oMember.PositionId || "",
                                department: oMember.OrgUnitName || oMember.OrgUnitId || "",
                                email: oMember.EmployeeEmail || "",
                                phone: oMember.EmployeePhone || "",
                                avatarUrl: "sap-icon://employee"
                            };
                        });
                        fnFinish(true, aTeam);
                    });
                }).catch(function (oError) {
                    // The authenticated identity remains valid even when the optional
                    // skill-service profile enrichment is temporarily unavailable.
                    console.warn("User profile enrichment failed", oError && oError.message);
                    fnFinish(true, []);
                });
            };

            jQuery.ajax({
                url: "/api/currentUser",
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                success: function (oData) {
                    var bAuthorized = Boolean(oData && oData.authorized !== false && oData.email && oData.pernr);
                    if (!bAuthorized) {
                        oUserModel.setProperty("/loadState", "denied");
                        fnFinish(false, []);
                        return;
                    }

                    var aRoles = Array.isArray(oData.roles) ? oData.roles : [];
                    var sName = oData.name || oData.email;
                    oUserModel.setData({
                        authorized: true,
                        loadState: "loading",
                        userId: oData.userId || oData.email,
                        email: oData.email,
                        sapUserId: oData.sapUserId || oData.email,
                        pernr: oData.pernr,
                        name: sName,
                        initials: initialsFromName(sName),
                        position: oData.position || "",
                        department: oData.department || "",
                        phone: oData.phone || "",
                        roles: aRoles,
                        isManager: oData.isManager === true,
                        isHrAdmin: oData.isHrAdmin === true ||
                            hasRole(aRoles, "HR_ADMIN") ||
                            hasRole(aRoles, "PROFILE_HR_ADMIN")
                    });
                    fnLoadProfileAndHierarchy();
                },
                error: function (oRequest, sStatus) {
                    // Fail closed. Development mocks must be enabled explicitly by the
                    // test harness; production code never invents a user or PERNR.
                    console.warn("Current-user resolution failed", sStatus,
                        oRequest && oRequest.status);
                    oUserModel.setProperty("/loadState", "error");
                    fnFinish(false, []);
                }
            });

            this.getRouter().initialize();
        }
    });
});
