sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Sorter",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "znxr09/znxr09f300/model/profileFormatter",
    "znxr09/znxr09f300/model/profileValidator",
    "znxr09/znxr09f300/util/ProfileApi"
], function (
    Controller,
    JSONModel,
    Sorter,
    Filter,
    FilterOperator,
    MessageBox,
    MessageToast,
    SelectDialog,
    StandardListItem,
    formatter,
    validator,
    ProfileApi
) {
    "use strict";

    var FIELD_PROPERTY = {
        TELEPHONE: "Telephone",
        WORK_EMAIL: "WorkEmail",
        ADDRESS: "PermanentAddress",
        CURR_ADDRESS: "CurrentAddress",
        MARITAL_STATUS: "MaritalStatusCode",
        PAY_METHOD: "PayMethod",
        BANK_COUNTRY: "BankCountry",
        BANK_KEY: "BankKey",
        BANK_ACCT: "BankAccount"
    };

    var CONTROL_BY_FIELD = {
        TELEPHONE: "profileTelephoneInput",
        ADDRESS: "profilePermanentAddressInput",
        CURR_ADDRESS: "profileCurrentAddressInput",
        MARITAL_STATUS: "profileMaritalStatusEditInput",
        PAY_METHOD: "profilePaymentMethodSelect",
        BANK_KEY: "profileBankKeyInput",
        BANK_ACCT: "profileBankAccountInput"
    };

    return Controller.extend("znxr09.znxr09f300.controller.MyProfile", {
        formatter: formatter,

        onInit: function () {
            this.getView().setModel(new JSONModel({
                busy: true,
                errorKey: "",
                hasData: false,
                hasEditableField: false,
                hasPendingRequest: false,
                isEditingProfile: false
            }), "profileUi");
            this.getView().setModel(new JSONModel({}), "profile");
            this.getView().setModel(new JSONModel({
                values: {},
                original: {},
                states: {},
                remark: "",
                isRevision: false,
                requestId: "",
                expectedVersion: 0,
                isBankTransfer: false,
                busy: false
            }), "profileEdit");
            this.getView().setModel(new JSONModel({ rows: [] }), "profileRequests");
            this.getView().setModel(new JSONModel({
                paymentMethods: [
                    { Code: "C", DisplayText: this._bundle().getText("profilePaymentCash") },
                    { Code: "T", DisplayText: this._bundle().getText("profilePaymentBankTransfer") }
                ],
                maritalStatuses: [],
                banks: [],
                loaded: {
                    maritalStatuses: false,
                    banks: false
                }
            }), "profileCatalog");

            this.getOwnerComponent().pUserLoaded.then(function (bAuthorized) {
                if (!bAuthorized) {
                    var sLoadState = this.getOwnerComponent().getModel("user").getProperty("/loadState");
                    this._setLoadError(sLoadState === "error" ?
                        "profileErrorServiceUnavailable" : "profileErrorUnauthorized");
                    return;
                }
                this.refresh();
            }.bind(this));
        },

        _model: function () {
            return this.getOwnerComponent().getModel("profileService");
        },

        _bundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        },

        _setLoadError: function (sKey) {
            this.getView().getModel("profileUi").setData({
                busy: false,
                errorKey: sKey,
                hasData: false,
                hasEditableField: false,
                hasPendingRequest: false,
                isEditingProfile: false
            });
            this.getView().getModel("profileRequests").setProperty("/rows", []);
        },

        refresh: function () {
            var oModel = this._model();
            var oUiModel = this.getView().getModel("profileUi");
            if (!oModel) {
                this._setLoadError("profileErrorServiceUnavailable");
                return Promise.resolve();
            }

            oUiModel.setProperty("/busy", true);
            oUiModel.setProperty("/errorKey", "");

            return Promise.all([
                ProfileApi.requestFirst(oModel, "/MyProfile"),
                ProfileApi.requestList(oModel, "/MyProfileFields", [], [], {}, 100),
                ProfileApi.requestList(oModel, "/MyProfileRequests", [], [
                    new Sorter("SubmittedAt", true)
                ], {}, 100),
                ProfileApi.requestList(oModel, "/ProfileBanks", [], [], {}, 200)
                    .then(function (aRows) { return { rows: aRows, loaded: true }; })
                    .catch(function () { return { rows: [], loaded: false }; }),
                ProfileApi.requestList(oModel, "/ProfileMaritalStatuses", [], [], {}, 50)
                    .then(function (aRows) { return { rows: aRows, loaded: true }; })
                    .catch(function () { return { rows: [], loaded: false }; })
            ]).then(function (aResults) {
                var oProfile = aResults[0];
                if (!oProfile) {
                    this._setLoadError("profileErrorNoProfile");
                    return;
                }

                oProfile.states = {};
                aResults[1].forEach(function (oField) {
                    var bClientEditable = oField.FieldCode !== "WORK_EMAIL" &&
                        oField.Editable === true && oField.Locked !== true;
                    oProfile.states[oField.FieldCode] = Object.assign({}, oField, {
                        Editable: oField.FieldCode === "WORK_EMAIL" ? false : oField.Editable,
                        EffectiveEditable: bClientEditable,
                        StatusText: ""
                    });
                });
                this._decorateProfile(oProfile);
                this.getView().getModel("profile").setData(oProfile);
                this._setProfileEditDisplayState(oProfile);
                var aRequests = aResults[2] || [];
                var oBankResult = aResults[3] || { rows: [], loaded: false };
                var oMaritalResult = aResults[4] || { rows: [], loaded: false };
                var aBanks = this._mapBanks(oBankResult.rows || []);
                var aMaritalStatuses = this._mapMaritalStatuses(oMaritalResult.rows || []);
                if (oProfile.BankKey && !aBanks.some(function (oBank) {
                    return String(oBank.BankCountry || "") === String(oProfile.BankCountry || "VN") &&
                        String(oBank.BankKey || "") === String(oProfile.BankKey || "");
                })) {
                    aBanks.unshift({
                        BankCountry: oProfile.BankCountry || "VN",
                        BankKey: oProfile.BankKey,
                        BankName: oProfile.BankName || oProfile.BankKey,
                        IsSimulation: false
                    });
                }
                var oCatalog = this.getView().getModel("profileCatalog");
                oCatalog.setProperty("/banks", aBanks);
                oCatalog.setProperty("/loaded/banks", oBankResult.loaded === true);
                if (oProfile.MaritalStatusCode && !aMaritalStatuses.some(function (oStatus) {
                    return String(oStatus.Code || "") === String(oProfile.MaritalStatusCode);
                })) {
                    aMaritalStatuses.unshift({
                        Code: oProfile.MaritalStatusCode,
                        DisplayText: oProfile.MaritalStatus || oProfile.MaritalStatusCode,
                        Language: "EN",
                        IsSimulation: false
                    });
                }
                oCatalog.setProperty("/maritalStatuses", aMaritalStatuses);
                oCatalog.setProperty("/loaded/maritalStatuses", oMaritalResult.loaded === true);
                aRequests.forEach(function (oRequest) {
                    oRequest.StatusText = this._statusText(oRequest.Status);
                }.bind(this));
                this.getView().getModel("profileRequests").setProperty("/rows", aRequests);

                var oUserModel = this.getOwnerComponent().getModel("user");
                oUserModel.setProperty("/name", oProfile.EmployeeName || oUserModel.getProperty("/name"));
                oUserModel.setProperty("/initials", oProfile.Initials);
                oUserModel.setProperty("/position", oProfile.PositionName || "");
                oUserModel.setProperty("/department", oProfile.OrgUnitName || "");

                oUiModel.setData({
                    busy: false,
                    errorKey: "",
                    hasData: true,
                    hasEditableField: Object.keys(oProfile.states).some(function (sCode) {
                        return oProfile.states[sCode].EffectiveEditable;
                    }),
                    hasPendingRequest: aRequests.some(function (oRequest) {
                        return oRequest.Status === "01" || oRequest.Status === "04";
                    }),
                    isEditingProfile: false
                });
            }.bind(this)).catch(function (oError) {
                var oInfo = ProfileApi.errorInfo(oError);
                this._setLoadError(oInfo.status === 403 ?
                    "profileErrorUnauthorized" : "profileErrorServiceUnavailable");
            }.bind(this));
        },

        _statusText: function (sStatus) {
            return this._bundle().getText({
                "01": "profileStatusPending",
                "02": "profileStatusApproved",
                "03": "profileStatusRejected",
                "04": "profileStatusRevision"
            }[sStatus] || "profileStatusUnknown");
        },

        _decorateProfile: function (oProfile) {
            // SAP user e-mail addresses are case-insensitive. Normalize the value for a
            // consistent display and keep the SAP-owned field outside the edit flow.
            oProfile.WorkEmail = String(oProfile.WorkEmail || "").trim().toLowerCase();
            oProfile.Initials = this._initials(oProfile.EmployeeName);
            oProfile.PaymentMethodDisplay = this._paymentMethodText(oProfile.PayMethod, oProfile.PayMethodText);
            oProfile.HasBankTransfer = this._isBankTransfer(oProfile.PayMethod, oProfile.PayMethodText);
            oProfile.IsCashPayment = String(oProfile.PayMethod || "").trim().toUpperCase() === "C";
            oProfile.HeroMeta = [oProfile.PositionName, oProfile.OrgUnitName].filter(Boolean)
                .concat([this._bundle().getText("profileEmployeeId") + ": " + oProfile.Pernr]).join(" | ");
        },

        _initials: function (sName) {
            return String(sName || "").trim().split(/\s+/).filter(Boolean).slice(-2)
                .map(function (sPart) { return sPart.charAt(0).toUpperCase(); }).join("");
        },

        _isBankTransfer: function (sCode, sText) {
            var sNormalizedCode = String(sCode || "").trim().toUpperCase();
            var sNormalizedText = String(sText || "").trim().toLowerCase();
            return ["T", "5"].indexOf(sNormalizedCode) >= 0 ||
                /bank|transfer|chuyển khoản/.test(sNormalizedText);
        },

        _paymentMethodText: function (sCode, sText) {
            if (sText) {
                return sText;
            }
            if (this._isBankTransfer(sCode, sText)) {
                return this._bundle().getText("profilePaymentBankTransfer");
            }
            if (String(sCode || "").trim().toUpperCase() === "C") {
                return this._bundle().getText("profilePaymentCash");
            }
            return "";
        },

        profileErrorText: function (sKey) {
            return sKey ? this._bundle().getText(sKey) : "";
        },

        onRefreshProfile: function () {
            this.refresh();
        },

        _buildProfileEditState: function (oProfile, oOptions) {
            var oValues = {};
            var oOriginal = {};
            var mStates = {};
            var bForceReadOnly = Boolean(oOptions && oOptions.forceReadOnly);

            Object.keys(FIELD_PROPERTY).forEach(function (sCode) {
                var vValue = oProfile[FIELD_PROPERTY[sCode]];
                if (sCode === "MARITAL_STATUS" && !vValue) {
                    vValue = {
                        Single: "0", Married: "1", Widowed: "2", Divorced: "3"
                    }[String(oProfile.MaritalStatus || "").trim()] || "";
                }
                var sValue = vValue === null || vValue === undefined ? "" : String(vValue);
                var oFieldState = Object.assign({}, (oProfile.states && oProfile.states[sCode]) || {});
                var bEditable = sCode !== "WORK_EMAIL" && oFieldState.Editable === true &&
                    oFieldState.Locked !== true;

                oValues[sCode] = sValue;
                oOriginal[sCode] = sValue;
                mStates[sCode] = Object.assign(oFieldState, {
                    Editable: sCode === "WORK_EMAIL" ? false : oFieldState.Editable,
                    EffectiveEditable: !bForceReadOnly && bEditable
                });
            });

            // Bank country is a fixed HR master-data context for this portal.
            // Keep it in the request payload, but do not expose it as an editable UI field.
            if (oValues.BANK_COUNTRY === "") {
                oValues.BANK_COUNTRY = "VN";
                oOriginal.BANK_COUNTRY = "VN";
            }

            return {
                values: oValues,
                original: oOriginal,
                states: mStates,
                remark: (oOptions && oOptions.remark) || "",
                isRevision: Boolean(oOptions && oOptions.isRevision),
                requestId: (oOptions && oOptions.requestId) || "",
                expectedVersion: Number((oOptions && oOptions.expectedVersion) || 0),
                isBankTransfer: this._isBankTransfer(oValues.PAY_METHOD),
                busy: false
            };
        },

        _setProfileEditDisplayState: function (oProfile) {
            this.getView().getModel("profileEdit").setData(this._buildProfileEditState(oProfile));
        },

        _startProfileEdit: function (oEditState) {
            this.getView().getModel("profileEdit").setData(oEditState);
            this.getView().getModel("profileUi").setProperty("/isEditingProfile", true);
            this._applyValidationErrors({});
            this._focusFirstEditableProfileField();
        },

        _focusFirstEditableProfileField: function () {
            window.setTimeout(function () {
                var oFirstEditable = Object.keys(CONTROL_BY_FIELD).map(function (sCode) {
                    return this.byId(CONTROL_BY_FIELD[sCode]);
                }.bind(this)).find(function (oControl) {
                    return oControl && (!oControl.getEnabled || oControl.getEnabled()) &&
                        (!oControl.getEditable || oControl.getEditable()) &&
                        (!oControl.getVisible || oControl.getVisible());
                });
                if (oFirstEditable && oFirstEditable.focus) {
                    oFirstEditable.focus();
                }
            }.bind(this), 0);
        },

        onEditProfile: function () {
            var oProfile = this.getView().getModel("profile").getData();
            this._startProfileEdit(this._buildProfileEditState(oProfile));
        },

        onReviseProfileRequest: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("profileRequests");
            if (!oContext) {
                return;
            }
            var oRequest = Object.assign({}, oContext.getObject());
            var oProfile = this.getView().getModel("profile").getData();
            var oEditState = this._buildProfileEditState(oProfile, {
                forceReadOnly: true,
                remark: oRequest.Remark || "",
                isRevision: true,
                requestId: oRequest.ID,
                expectedVersion: Number(oRequest.Version)
            });

            this.getView().getModel("profileUi").setProperty("/busy", true);
            ProfileApi.requestList(this._model(), "/MyProfileRequestItems", [
                new Filter("RequestId", FilterOperator.EQ, oRequest.ID),
                new Filter("IsCurrent", FilterOperator.EQ, true)
            ], [new Sorter("Sequence", false)], {}, 100).then(function (aItems) {
                aItems.forEach(function (oItem) {
                    var sCode = oItem.FieldCode;
                    if (!FIELD_PROPERTY[sCode] || sCode === "WORK_EMAIL") {
                        return;
                    }
                    oEditState.values[sCode] = oItem.NewValue || "";
                    oEditState.states[sCode].EffectiveEditable = true;
                });
                oEditState.isBankTransfer = this._isBankTransfer(oEditState.values.PAY_METHOD);
                this._startProfileEdit(oEditState);
            }.bind(this)).catch(function (oError) {
                MessageBox.error(this._bundle().getText(this._errorKey(oError)));
            }.bind(this)).finally(function () {
                this.getView().getModel("profileUi").setProperty("/busy", false);
            }.bind(this));
        },

        onPaymentMethodChange: function (oEvent) {
            var sCode = oEvent.getSource().getSelectedKey();
            var oEditModel = this.getView().getModel("profileEdit");
            var bTransfer = this._isBankTransfer(sCode);
            oEditModel.setProperty("/isBankTransfer", bTransfer);
            if (!bTransfer) {
                ["BANK_COUNTRY", "BANK_KEY", "BANK_ACCT"].forEach(function (sCode) {
                    oEditModel.setProperty("/values/" + sCode, "");
                });
            }
            this._clearControlState(oEvent.getSource());
        },

        onProfileFieldChange: function (oEvent) {
            this._clearControlState(oEvent.getSource());
        },

        _mapBanks: function (aRows) {
            return (aRows || []).map(function (oBank) {
                return {
                    BankCountry: String(oBank.BankCountry || oBank.Banks || "VN").trim() || "VN",
                    BankKey: String(oBank.BankKey || oBank.Bankl || "").trim(),
                    BankName: String(oBank.BankName || oBank.Banka || oBank.BankKey || "").trim(),
                    IsSimulation: oBank.IsSimulation === true
                };
            }).filter(function (oBank) {
                return Boolean(oBank.BankKey);
            });
        },

        _mapMaritalStatuses: function (aRows) {
            return (aRows || []).map(function (oStatus) {
                var sCode = String(oStatus.MaritalStatusCode || oStatus.Code || oStatus.Famst || "").trim();
                return {
                    Code: sCode,
                    DisplayText: String(oStatus.MaritalStatusText || oStatus.DisplayText || oStatus.Ftext || sCode).trim(),
                    Language: String(oStatus.Language || oStatus.Sprsl || "EN").trim(),
                    IsSimulation: oStatus.IsSimulation === true
                };
            }).filter(function (oStatus) {
                return Boolean(oStatus.Code);
            });
        },

        _loadProfileCatalog: function (sPath, sProperty, sLoadedProperty, fnMap, iLimit) {
            var oCatalog = this.getView().getModel("profileCatalog");
            if (oCatalog.getProperty(sLoadedProperty) === true) {
                return Promise.resolve(oCatalog.getProperty(sProperty) || []);
            }

            return ProfileApi.requestList(this._model(), sPath, [], [], {}, iLimit).then(function (aRows) {
                var aValues = fnMap.call(this, aRows || []);
                oCatalog.setProperty(sProperty, aValues);
                oCatalog.setProperty(sLoadedProperty, true);
                return aValues;
            }.bind(this));
        },

        onMaritalStatusValueHelp: function () {
            this._loadProfileCatalog(
                "/ProfileMaritalStatuses",
                "/maritalStatuses",
                "/loaded/maritalStatuses",
                this._mapMaritalStatuses,
                50
            ).then(function () {
                var oCatalog = this.getView().getModel("profileCatalog");
                var oDialog = new SelectDialog({
                    title: this._bundle().getText("profileMaritalStatus"),
                    noDataText: this._bundle().getText("profileNoValueHelpData"),
                    search: function (oEvent) {
                        var sQuery = oEvent.getParameter("value") || "";
                        var oBinding = oEvent.getSource().getBinding("items");
                        oBinding.filter(sQuery ? [new Filter([
                            new Filter("DisplayText", FilterOperator.Contains, sQuery),
                            new Filter("Code", FilterOperator.Contains, sQuery)
                        ], false)] : []);
                    },
                    confirm: function (oEvent) {
                        var oItem = oEvent.getParameter("selectedItem");
                        if (oItem) {
                            var oContext = oItem.getBindingContext("profileCatalog");
                            var oEditModel = this.getView().getModel("profileEdit");
                            oEditModel.setProperty("/values/MARITAL_STATUS", oContext.getProperty("Code"));
                            this._clearControlState(this.byId("profileMaritalStatusEditInput"));
                        }
                        oEvent.getSource().destroy();
                    }.bind(this),
                    cancel: function (oEvent) {
                        oEvent.getSource().destroy();
                    }
                });
                oDialog.setModel(oCatalog, "profileCatalog");
                oDialog.bindAggregation("items", {
                    path: "profileCatalog>/maritalStatuses",
                    template: new StandardListItem({
                        title: "{profileCatalog>DisplayText}",
                        description: "{profileCatalog>Code}",
                        type: "Active"
                    })
                });
                oDialog.open();
            }.bind(this), function () {
                MessageBox.error(this._bundle().getText("profileValueHelpUnavailable"));
            }.bind(this));
        },

        onBankKeyValueHelp: function () {
            this._loadProfileCatalog(
                "/ProfileBanks",
                "/banks",
                "/loaded/banks",
                this._mapBanks,
                200
            ).then(function () {
                var oCatalog = this.getView().getModel("profileCatalog");
                var oDialog = new SelectDialog({
                    title: this._bundle().getText("profileBankKey"),
                    noDataText: this._bundle().getText("profileNoValueHelpData"),
                    search: function (oEvent) {
                        var sQuery = oEvent.getParameter("value") || "";
                        var oBinding = oEvent.getSource().getBinding("items");
                        oBinding.filter(sQuery ? [new Filter([
                            new Filter("BankKey", FilterOperator.Contains, sQuery),
                            new Filter("BankName", FilterOperator.Contains, sQuery)
                        ], false)] : []);
                    },
                    confirm: function (oEvent) {
                        var oItem = oEvent.getParameter("selectedItem");
                        if (oItem) {
                            var oContext = oItem.getBindingContext("profileCatalog");
                            var oEditModel = this.getView().getModel("profileEdit");
                            oEditModel.setProperty("/values/BANK_COUNTRY", oContext.getProperty("BankCountry") || "VN");
                            oEditModel.setProperty("/values/BANK_KEY", oContext.getProperty("BankKey"));
                            this._clearControlState(this.byId("profileBankKeyInput"));
                        }
                        oEvent.getSource().destroy();
                    }.bind(this),
                    cancel: function (oEvent) {
                        oEvent.getSource().destroy();
                    }
                });
                oDialog.setModel(oCatalog, "profileCatalog");
                oDialog.bindAggregation("items", {
                    path: "profileCatalog>/banks",
                    template: new StandardListItem({
                        title: "{profileCatalog>BankName}",
                        description: "{profileCatalog>BankKey}",
                        type: "Active"
                    })
                });
                oDialog.open();
            }.bind(this), function () {
                MessageBox.error(this._bundle().getText("profileValueHelpUnavailable"));
            }.bind(this));
        },

        _clearControlState: function (oControl) {
            if (oControl && oControl.setValueState) {
                oControl.setValueState("None");
                oControl.setValueStateText("");
            }
        },

        onCancelProfileEdit: function () {
            var oEditModel = this.getView().getModel("profileEdit");
            var oEdit = oEditModel.getData();
            var oOriginal = Object.assign({}, oEdit.original || {});

            oEdit.values = Object.assign({}, oOriginal);
            oEdit.remark = "";
            oEdit.isRevision = false;
            oEdit.requestId = "";
            oEdit.expectedVersion = 0;
            oEdit.isBankTransfer = this._isBankTransfer(oOriginal.PAY_METHOD);
            oEdit.busy = false;
            oEditModel.setData(oEdit);

            this.getView().getModel("profileUi").setProperty("/isEditingProfile", false);
            this._applyValidationErrors({});
            var oEditButton = this.byId("profilePreviewEditButton");
            if (oEditButton) {
                oEditButton.focus();
            }
        },

        onSubmitProfileEdit: function () {
            var oEditModel = this.getView().getModel("profileEdit");
            var oEdit = oEditModel.getData();
            var oResult = validator.validateProfileChange(oEdit.values, oEdit.original, {
                states: oEdit.states,
                isBankTransfer: oEdit.isBankTransfer,
                remark: oEdit.remark
            });

            this._applyValidationErrors(oResult.errors);
            if (!oResult.valid) {
                var sFirstKey = oResult.errors._form || oResult.errors._remark ||
                    oResult.errors[Object.keys(oResult.errors)[0]];
                MessageBox.error(this._bundle().getText(sFirstKey));
                return;
            }

            oEditModel.setProperty("/busy", true);
            var mParameters = {
                IdempotencyKey: ProfileApi.idempotencyKey(),
                ProfileVersion: this.getView().getModel("profile").getProperty("/ProfileVersion"),
                Remark: oEdit.remark,
                Changes: oResult.changes
            };
            if (oEdit.isRevision) {
                mParameters.RequestId = oEdit.requestId;
                mParameters.ExpectedVersion = Number(oEdit.expectedVersion);
            }

            ProfileApi.executeAction(this._model(), oEdit.isRevision ? "resubmitProfileChange" : "submitProfileChange", mParameters).then(function () {
                this.getView().getModel("profileUi").setProperty("/isEditingProfile", false);
                MessageToast.show(this._bundle().getText(oEdit.isRevision ?
                    "profileResubmitSuccess" : "profileSubmitSuccess"));
                return this.refresh();
            }.bind(this)).catch(function (oError) {
                MessageBox.error(this._bundle().getText(this._errorKey(oError)));
            }.bind(this)).finally(function () {
                oEditModel.setProperty("/busy", false);
            });
        },

        _applyValidationErrors: function (mErrors) {
            Object.keys(CONTROL_BY_FIELD).forEach(function (sFieldCode) {
                var oControl = this.byId(CONTROL_BY_FIELD[sFieldCode]);
                if (!oControl || !oControl.setValueState) {
                    return;
                }
                var sKey = mErrors[sFieldCode] || "";
                oControl.setValueState(sKey ? "Error" : "None");
                oControl.setValueStateText(sKey ? this._bundle().getText(sKey) : "");
            }.bind(this));
        },

        _errorKey: function (oError) {
            var oInfo = ProfileApi.errorInfo(oError);
            return {
                PROFILE_FIELD_LOCKED: "profileErrorConflict",
                PROFILE_VERSION_STALE: "profileErrorStale",
                PROFILE_REQUEST_STALE: "profileErrorStale",
                PROFILE_CHANGE_INVALID: "profileErrorSubmit",
                PROFILE_IDEMPOTENCY_CONFLICT: "profileErrorConflict",
                SAP_PROFILE_WRITE_NOT_AVAILABLE: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_NOT_IMPLEMENTED: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_SERVICE_UNAVAILABLE: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_FAILED: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_REJECTED: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_EMPTY_PAYLOAD: "profileErrorSapApplyUnavailable"
            }[oInfo.code] || {
                400: "profileErrorSubmit",
                401: "profileErrorUnauthorized",
                403: "profileErrorForbidden",
                409: "profileErrorConflict",
                412: "profileErrorStale",
                501: "profileErrorSapApplyUnavailable",
                503: "profileErrorServiceUnavailable"
            }[oInfo.status] || "profileErrorSubmit";
        }
    });
});
