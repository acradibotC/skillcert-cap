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
            var oTeamModel = new JSONModel({
                teamMembers: [],
                loadState: "loading",
                error: ""
            });
            this.setModel(oTeamModel, "team");
            var pTeamMembersLoad = null;

            var fnResolveAuthorization = function (bAuthorized) {
                if (bResolved) {
                    return;
                }
                bResolved = true;
                oUserModel.setProperty("/loadState", bAuthorized ? "ready" : "denied");
                fnResolveUser(Boolean(bAuthorized));
            };

            var fnFinish = function (bAuthorized, aTeam) {
                var aCurrentTeam = oTeamModel.getProperty("/teamMembers") || [];
                // A transient empty response must not erase a list that was
                // already loaded successfully for this authenticated manager.
                var aNextTeam = (aTeam && aTeam.length === 0 && aCurrentTeam.length > 0)
                    ? aCurrentTeam
                    : (aTeam || []);
                oTeamModel.setData({
                    teamMembers: aNextTeam,
                    loadState: "ready",
                    error: ""
                });
                fnResolveAuthorization(bAuthorized);
            };

            var fnFailTeamLoad = function (oError) {
                var sMessage = oError && (oError.message || oError.statusText);
                oTeamModel.setProperty("/loadState", "error");
                oTeamModel.setProperty("/error", sMessage || "Unable to load team members from SAP.");
                // Authentication is already valid. Resolve the app without hiding
                // the team-service failure as an empty, successful list.
                fnResolveAuthorization(true);
            };

            var fnLoadProfileAndHierarchy = function (bForceReload) {
                // The component already starts this load after /api/currentUser.
                // Re-entering the Team tab must share that promise instead of
                // starting a second request whose empty result can overwrite a
                // successfully loaded list.
                if (pTeamMembersLoad) {
                    return pTeamMembersLoad;
                }

                var sEmail = oUserModel.getProperty("/email");
                var sSapUserId = oUserModel.getProperty("/sapUserId") || sEmail;
                var oODataModel = that.getModel("odata");

                if (!sSapUserId || !oODataModel) {
                    fnFinish(true, []);
                    return;
                }

                oTeamModel.setProperty("/loadState", "loading");
                oTeamModel.setProperty("/error", "");

                var oContext = oODataModel.bindContext("/UserProfile('" +
                    String(sSapUserId).replace(/'/g, "''") + "')");

                var pLoad = oContext.requestObject().then(function (oProfile) {
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

                    var sIsManager = String(oProfile.IsManager == null ? "" : oProfile.IsManager)
                        .trim().toUpperCase();
                    var bIsManager = sIsManager === "X" || sIsManager === "TRUE" ||
                        oUserModel.getProperty("/isManager") === true;
                    oUserModel.setProperty("/isManager", bIsManager);
                    if (!bIsManager) {
                        fnFinish(true, []);
                        return;
                    }

                    // ManagerUserId is the SAP user ID, not the employee number.
                    // Use one exact, server-side equality filter at a time. SAP
                    // rejects/ignores the nested OR filter used here previously,
                    // and its result could make a valid team look empty.
                    // Keep the authenticated PERNR as a compatibility candidate
                    // for older CDS projections that exposed the manager key as
                    // personnel number instead of the annotated system ID.
                    var aManagerIds = [
                        oProfile.UserId,
                        sSapUserId,
                        oUserModel.getProperty("/userId"),
                        oUserModel.getProperty("/pernr"),
                        sEmail
                    ]
                        .filter(Boolean)
                        .reduce(function (aIds, sId) {
                            var sValue = String(sId).trim();
                            [sValue, sValue.toUpperCase(), sValue.toLowerCase()].forEach(function (sVariant) {
                                if (sVariant && aIds.indexOf(sVariant) < 0) {
                                    aIds.push(sVariant);
                                }
                            });
                            return aIds;
                        }, []);

                    var fnReadTeamMembers = function (iIndex) {
                        if (iIndex >= aManagerIds.length) {
                            fnFinish(true, []);
                            return Promise.resolve([]);
                        }
                        var oListBinding = oODataModel.bindList("/TeamMembers", null, null, [
                            new Filter("ManagerUserId", FilterOperator.EQ, aManagerIds[iIndex])
                        ]);
                        return oListBinding.requestContexts(0, 100).then(function (aContexts) {
                            if (!aContexts || aContexts.length === 0) {
                                return fnReadTeamMembers(iIndex + 1);
                            }
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
                            return aTeam;
                        });
                    };
                    return fnReadTeamMembers(0);
                }).catch(function (oError) {
                    console.warn("User profile enrichment failed", oError && oError.message);
                    fnFailTeamLoad(oError);
                });
                pTeamMembersLoad = pLoad.then(function (aTeam) {
                    pTeamMembersLoad = null;
                    return aTeam;
                }, function (oError) {
                    pTeamMembersLoad = null;
                    throw oError;
                });
                return pTeamMembersLoad;
            };

            // Exposed for Team Management when the user re-enters the tab or
            // presses Retry after a transient SAP/OData failure.
            this.reloadTeamMembers = function () {
                // Keep the current list while refreshing. Only an explicit retry
                // starts a new request; tab navigation shares an in-flight load.
                var bForceReload = Boolean(arguments[0]);
                var aCurrentTeam = oTeamModel.getProperty("/teamMembers") || [];
                if (!bForceReload && oTeamModel.getProperty("/loadState") === "ready" &&
                    aCurrentTeam.length > 0) {
                    return Promise.resolve(aCurrentTeam);
                }
                return fnLoadProfileAndHierarchy(bForceReload);
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
