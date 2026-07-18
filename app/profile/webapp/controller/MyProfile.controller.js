sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "znxr09/znxr09f300/model/profileFormatter",
    "znxr09/znxr09f300/model/profileValidator",
    "znxr09/znxr09f300/util/ProfileApi"
], function (
    Controller,
    JSONModel,
    Fragment,
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
                hasPreviewChanges: false
            }), "profileUi");
            this.getView().setModel(new JSONModel({}), "profile");
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
                hasPreviewChanges: false
            });
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
                ProfileApi.requestList(oModel, "/MyProfileFields", [], [], {}, 100)
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
                    hasPreviewChanges: false
                });
            }.bind(this)).catch(function (oError) {
                var oInfo = ProfileApi.errorInfo(oError);
                this._setLoadError(oInfo.status === 403 ?
                    "profileErrorUnauthorized" : "profileErrorServiceUnavailable");
            }.bind(this));
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

            this.getView().setModel(new JSONModel({
                values: oValues,
                original: oOriginal,
                states: mStates,
                remark: "",
                isRevision: false,
                isBankTransfer: this._isBankTransfer(oValues.PAY_METHOD),
                busy: false
            }), "profileEdit");

            if (!this._pEditDialog) {
                this._pEditDialog = Fragment.load({
                    id: this.getView().getId(),
                    name: "znxr09.znxr09f300.view.ProfileEditDialog",
                    controller: this
                }).then(function (oDialog) {
                    this.getView().addDependent(oDialog);
                    return oDialog;
                }.bind(this));
            }
            this._pEditDialog.then(function (oDialog) {
                oDialog.open();
            }).catch(function () {
                MessageBox.error(this._bundle().getText("profileErrorEditDialog"));
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

        onProfileDialogAfterOpen: function () {
            var oFirstEditable = Object.keys(CONTROL_BY_FIELD).map(function (sCode) {
                return this.byId(CONTROL_BY_FIELD[sCode]);
            }.bind(this)).find(function (oControl) {
                return oControl && (!oControl.getEnabled || oControl.getEnabled()) &&
                    (!oControl.getVisible || oControl.getVisible());
            });
            if (oFirstEditable && oFirstEditable.focus) {
                oFirstEditable.focus();
            }
        },

        _clearControlState: function (oControl) {
            if (oControl && oControl.setValueState) {
                oControl.setValueState("None");
                oControl.setValueStateText("");
            }
        },

        onCancelProfileEdit: function () {
            this.byId("profileEditDialog").close();
        },

        onProfileDialogAfterClose: function () {
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

            var oProfileModel = this.getView().getModel("profile");
            var oProfile = oProfileModel.getData();
            oResult.changes.forEach(function (oChange) {
                oProfile[FIELD_PROPERTY[oChange.FieldCode]] = oChange.NewValue;
            });
            oProfile.PayMethodText = "";
            if (!this._isBankTransfer(oProfile.PayMethod)) {
                oProfile.BankName = "";
            }
            this._decorateProfile(oProfile);
            oProfileModel.setData(oProfile);
            this.getView().getModel("profileUi").setProperty("/hasPreviewChanges", true);
            this.byId("profileEditDialog").close();
            MessageToast.show(this._bundle().getText("profilePreviewApplied"));
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

        onExit: function () {
            if (this._pEditDialog) {
                this._pEditDialog.then(function (oDialog) { oDialog.destroy(); });
                this._pEditDialog = null;
            }
        }
    });
});
