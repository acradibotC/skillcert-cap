sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Sorter",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
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
    formatter,
    validator,
    ProfileApi
) {
    "use strict";

    var FIELD_PROPERTY = {
        ID_NUMBER: "IdNumber",
        TELEPHONE: "Telephone",
        WORK_EMAIL: "WorkEmail",
        ADDRESS: "PermanentAddress",
        CURR_ADDRESS: "CurrentAddress",
        TAX_CODE: "TaxCode",
        PAY_METHOD: "PayMethod",
        BANK_COUNTRY: "BankCountry",
        BANK_KEY: "BankKey",
        BANK_ACCT: "BankAccount"
    };

    var CONTROL_BY_FIELD = {
        ID_NUMBER: "profileIdNumberInput",
        TELEPHONE: "profileTelephoneInput",
        WORK_EMAIL: "profileWorkEmailInput",
        ADDRESS: "profilePermanentAddressInput",
        CURR_ADDRESS: "profileCurrentAddressInput",
        TAX_CODE: "profileTaxCodeInput",
        PAY_METHOD: "profilePaymentMethodSelect",
        BANK_COUNTRY: "profileBankCountryInput",
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
                ]
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
                ], {}, 100)
            ]).then(function (aResults) {
                var oProfile = aResults[0];
                if (!oProfile) {
                    this._setLoadError("profileErrorNoProfile");
                    return;
                }

                oProfile.states = {};
                aResults[1].forEach(function (oField) {
                    oProfile.states[oField.FieldCode] = Object.assign({}, oField, {
                        EffectiveEditable: oField.Editable === true && oField.Locked !== true,
                        StatusText: ""
                    });
                });
                this._decorateProfile(oProfile);
                this.getView().getModel("profile").setData(oProfile);
                var aRequests = aResults[2] || [];
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
                        (!oControl.getVisible || oControl.getVisible());
                });
                if (oFirstEditable && oFirstEditable.focus) {
                    oFirstEditable.focus();
                }
            }.bind(this), 0);
        },

        onEditProfile: function () {
            var oProfile = this.getView().getModel("profile").getData();
            var oValues = {};
            var oOriginal = {};
            var mStates = {};

            Object.keys(FIELD_PROPERTY).forEach(function (sCode) {
                var sValue = oProfile[FIELD_PROPERTY[sCode]] || "";
                oValues[sCode] = sValue;
                oOriginal[sCode] = sValue;
                mStates[sCode] = Object.assign({}, oProfile.states[sCode] || {}, {
                    EffectiveEditable: Boolean(oProfile.states[sCode] &&
                        oProfile.states[sCode].Editable === true &&
                        oProfile.states[sCode].Locked !== true)
                });
            });

            this._startProfileEdit({
                values: oValues,
                original: oOriginal,
                states: mStates,
                remark: "",
                isRevision: false,
                requestId: "",
                expectedVersion: 0,
                isBankTransfer: this._isBankTransfer(oValues.PAY_METHOD),
                busy: false
            });
        },

        onReviseProfileRequest: function (oEvent) {
            var oContext = oEvent.getSource().getBindingContext("profileRequests");
            if (!oContext) {
                return;
            }
            var oRequest = Object.assign({}, oContext.getObject());
            var oProfile = this.getView().getModel("profile").getData();
            var oValues = {};
            var oOriginal = {};
            var mStates = {};

            Object.keys(FIELD_PROPERTY).forEach(function (sCode) {
                var sValue = oProfile[FIELD_PROPERTY[sCode]] || "";
                oValues[sCode] = sValue;
                oOriginal[sCode] = sValue;
                mStates[sCode] = Object.assign({}, oProfile.states[sCode] || {}, {
                    EffectiveEditable: false
                });
            });

            this.getView().getModel("profileUi").setProperty("/busy", true);
            ProfileApi.requestList(this._model(), "/MyProfileRequestItems", [
                new Filter("RequestId", FilterOperator.EQ, oRequest.ID),
                new Filter("IsCurrent", FilterOperator.EQ, true)
            ], [new Sorter("Sequence", false)], {}, 100).then(function (aItems) {
                aItems.forEach(function (oItem) {
                    var sCode = oItem.FieldCode;
                    if (!FIELD_PROPERTY[sCode]) {
                        return;
                    }
                    oValues[sCode] = oItem.NewValue || "";
                    mStates[sCode].EffectiveEditable = true;
                });
                this._startProfileEdit({
                    values: oValues,
                    original: oOriginal,
                    states: mStates,
                    remark: oRequest.Remark || "",
                    isRevision: true,
                    requestId: oRequest.ID,
                    expectedVersion: Number(oRequest.Version),
                    isBankTransfer: this._isBankTransfer(oValues.PAY_METHOD),
                    busy: false
                });
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

        _clearControlState: function (oControl) {
            if (oControl && oControl.setValueState) {
                oControl.setValueState("None");
                oControl.setValueStateText("");
            }
        },

        onCancelProfileEdit: function () {
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
