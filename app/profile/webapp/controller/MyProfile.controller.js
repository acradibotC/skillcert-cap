sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ui/model/Sorter",
    "sap/ui/core/Fragment",
    "sap/m/MessageBox",
    "sap/m/MessageToast",
    "znxr09/znxr09f300/model/profileFormatter",
    "znxr09/znxr09f300/model/profileValidator",
    "znxr09/znxr09f300/util/ProfileApi"
], function (
    Controller,
    JSONModel,
    Filter,
    FilterOperator,
    Sorter,
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
        BANK_COUNTRY: "profileBankSelect",
        BANK_KEY: "profileBankSelect",
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
                pendingCount: 0,
                revisionCount: 0
            }), "profileUi");
            this.getView().setModel(new JSONModel({}), "profile");
            this.getView().setModel(new JSONModel({ rows: [] }), "profileHistory");
            this.getView().setModel(new JSONModel({ paymentMethods: [], banks: [] }), "profileCatalog");

            this.getOwnerComponent().pUserLoaded.then(function (bAuthorized) {
                if (!bAuthorized) {
                    this._setLoadError("profileErrorUnauthorized");
                    return;
                }
                this.refresh();
            }.bind(this));
        },

        _bundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        },

        _model: function () {
            return this.getOwnerComponent().getModel("profileService");
        },

        _setLoadError: function (sKey) {
            this.getView().getModel("profileUi").setData({
                busy: false,
                errorKey: sKey,
                hasData: false,
                hasEditableField: false,
                pendingCount: 0,
                revisionCount: 0
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
                ProfileApi.requestList(oModel, "/MyProfileFields", [], [], {}, 100),
                ProfileApi.requestList(oModel, "/MyProfileRequests", [], [
                    new Sorter("SubmittedAt", true)
                ], {}, 100),
                ProfileApi.requestList(oModel, "/ProfilePaymentMethods", [], [
                    new Sorter("Code", false)
                ], {}, 50).catch(function () { return []; }),
                ProfileApi.requestList(oModel, "/ProfileBanks", [], [
                    new Sorter("BankName", false)
                ], {}, 500).catch(function () { return []; })
            ]).then(function (aResults) {
                var oProfile = aResults[0];
                if (!oProfile) {
                    this._setLoadError("profileErrorNoProfile");
                    return;
                }

                var aFields = aResults[1];
                var aRequests = aResults[2];
                aRequests.forEach(function (oRequest) {
                    if (!oRequest.StatusText) {
                        oRequest.StatusText = this._statusText(oRequest.Status);
                    }
                }.bind(this));
                var mStates = {};
                aFields.forEach(function (oField) {
                    var oState = Object.assign({}, oField);
                    oState.StatusText = this._statusText(oState.LockStatus);
                    oState.EffectiveEditable = oState.Editable === true &&
                        (oState.Locked !== true || oState.LockStatus === "04");
                    mStates[oField.FieldCode] = oState;
                }.bind(this));

                oProfile.states = mStates;
                oProfile.Initials = this._initials(oProfile.EmployeeName);
                this.getView().getModel("profile").setData(oProfile);
                this.getView().getModel("profileHistory").setData({ rows: aRequests });
                this.getView().getModel("profileCatalog").setData({
                    paymentMethods: aResults[3].map(function (oMethod) {
                        return Object.assign({}, oMethod, {
                            DisplayText: oMethod.Text || oMethod.Name || oMethod.Code
                        });
                    }),
                    banks: aResults[4].map(function (oBank) {
                        return Object.assign({}, oBank, {
                            SelectionKey: (oBank.BankCountry || "") + "|" + (oBank.BankKey || ""),
                            DisplayText: (oBank.BankName || oBank.BankKey || "") +
                                (oBank.BankKey ? " (" + oBank.BankKey + ")" : "")
                        });
                    })
                });

                var oUserModel = this.getOwnerComponent().getModel("user");
                oUserModel.setProperty("/name", oProfile.EmployeeName || oUserModel.getProperty("/name"));
                oUserModel.setProperty("/initials", oProfile.Initials);
                oUserModel.setProperty("/position", oProfile.PositionName || oProfile.PositionId || "");
                oUserModel.setProperty("/department", oProfile.OrgUnitName || oProfile.OrgUnitId || "");
                oUserModel.setProperty("/phone", oProfile.Telephone || "");

                oUiModel.setData({
                    busy: false,
                    errorKey: "",
                    hasData: true,
                    hasEditableField: Object.keys(mStates).some(function (sCode) {
                        return mStates[sCode].EffectiveEditable;
                    }),
                    pendingCount: aRequests.filter(function (oRequest) {
                        return oRequest.Status === "01";
                    }).length,
                    revisionCount: aRequests.filter(function (oRequest) {
                        return oRequest.Status === "04";
                    }).length
                });
            }.bind(this)).catch(function (oError) {
                var oInfo = ProfileApi.errorInfo(oError);
                this._setLoadError(oInfo.status === 403 ?
                    "profileErrorUnauthorized" : "profileErrorServiceUnavailable");
            }.bind(this));
        },

        _initials: function (sName) {
            return String(sName || "").trim().split(/\s+/).filter(Boolean).slice(-2)
                .map(function (sPart) { return sPart.charAt(0).toUpperCase(); }).join("");
        },

        _statusText: function (sStatus) {
            return sStatus ? this._bundle().getText({
                "01": "profileStatusPending",
                "02": "profileStatusApproved",
                "03": "profileStatusRejected",
                "04": "profileStatusRevision"
            }[sStatus] || "profileStatusUnknown") : "";
        },

        profileErrorText: function (sKey) {
            return sKey ? this._bundle().getText(sKey) : "";
        },

        onRefreshProfile: function () {
            this.refresh();
        },

        onEditProfile: function () {
            var oProfile = this.getView().getModel("profile").getData();
            var mStates = oProfile.states || {};
            var oRevisionState = Object.keys(mStates).map(function (sCode) {
                return mStates[sCode];
            }).find(function (oState) {
                return oState.LockStatus === "04" && oState.LockRequestId;
            });
            var oRevisionRequest = oRevisionState &&
                this.getView().getModel("profileHistory").getProperty("/rows").find(function (oRequest) {
                    return oRequest.ID === oRevisionState.LockRequestId;
                });

            if (!oRevisionRequest) {
                this._openProfileEdit(oProfile, null, []);
                return;
            }

            var oUiModel = this.getView().getModel("profileUi");
            oUiModel.setProperty("/busy", true);
            ProfileApi.requestList(this._model(), "/MyProfileRequestItems", [
                new Filter("RequestId", FilterOperator.EQ, oRevisionRequest.ID),
                new Filter("IsCurrent", FilterOperator.EQ, true)
            ], [new Sorter("Sequence", false)], {}, 100).then(function (aItems) {
                if (!aItems.length) {
                    throw new Error("Revision request items are unavailable.");
                }
                this._openProfileEdit(oProfile, oRevisionRequest, aItems);
            }.bind(this)).catch(function (oError) {
                MessageBox.error(this._errorText(oError));
            }.bind(this)).finally(function () {
                oUiModel.setProperty("/busy", false);
            });
        },

        _openProfileEdit: function (oProfile, oRevisionRequest, aRevisionItems) {
            var mBaseStates = oProfile.states || {};
            var oValues = {};
            Object.keys(FIELD_PROPERTY).forEach(function (sCode) {
                oValues[sCode] = oProfile[FIELD_PROPERTY[sCode]] || "";
            });
            (aRevisionItems || []).forEach(function (oItem) {
                if (Object.prototype.hasOwnProperty.call(oValues, oItem.FieldCode)) {
                    oValues[oItem.FieldCode] = oItem.NewValue || "";
                }
            });

            var bRevision = Boolean(oRevisionRequest);
            var mScopedStates = {};
            Object.keys(mBaseStates).forEach(function (sCode) {
                var oState = Object.assign({}, mBaseStates[sCode]);
                oState.EffectiveEditable = oState.Editable === true && (bRevision ?
                    oState.LockStatus === "04" && oState.LockRequestId === oRevisionRequest.ID :
                    oState.Locked !== true);
                mScopedStates[sCode] = oState;
            });

            var oOriginal = {};
            Object.keys(FIELD_PROPERTY).forEach(function (sCode) {
                oOriginal[sCode] = oProfile[FIELD_PROPERTY[sCode]] || "";
            });

            var oEditModel = new JSONModel({
                values: Object.assign({}, oValues),
                original: oOriginal,
                states: mScopedStates,
                remark: oRevisionRequest && oRevisionRequest.Remark || "",
                hrComment: oRevisionRequest && oRevisionRequest.HrComment || "",
                isRevision: bRevision,
                requestId: oRevisionRequest && oRevisionRequest.ID || "",
                expectedVersion: oRevisionRequest && oRevisionRequest.Version || 0,
                idempotencyKey: ProfileApi.idempotencyKey(),
                profileVersion: oProfile.ProfileVersion || "",
                selectedBank: (oValues.BANK_COUNTRY || "") + "|" + (oValues.BANK_KEY || ""),
                isBankTransfer: this._isTransfer(oValues.PAY_METHOD),
                busy: false
            });
            this.getView().setModel(oEditModel, "profileEdit");

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
            });
        },

        _isTransfer: function (sCode) {
            var aMethods = this.getView().getModel("profileCatalog").getProperty("/paymentMethods") || [];
            var oSelected = aMethods.find(function (oMethod) { return oMethod.Code === sCode; });
            return Boolean(oSelected && (oSelected.IsBankTransfer === true ||
                String(oSelected.Category || "").toUpperCase() === "BANK_TRANSFER")) ||
                sCode === "T" || sCode === "5";
        },

        onPaymentMethodChange: function (oEvent) {
            var sCode = oEvent.getSource().getSelectedKey();
            var oEditModel = this.getView().getModel("profileEdit");
            oEditModel.setProperty("/isBankTransfer", this._isTransfer(sCode));
            this._clearControlState(oEvent.getSource());
        },

        onBankSelectionChange: function (oEvent) {
            var aKey = String(oEvent.getSource().getSelectedKey() || "").split("|");
            var oEditModel = this.getView().getModel("profileEdit");
            oEditModel.setProperty("/values/BANK_COUNTRY", aKey[0] || "");
            oEditModel.setProperty("/values/BANK_KEY", aKey[1] || "");
            this._clearControlState(oEvent.getSource());
        },

        onProfileFieldChange: function (oEvent) {
            this._clearControlState(oEvent.getSource());
        },

        onProfileDialogAfterOpen: function () {
            var aIds = Object.keys(CONTROL_BY_FIELD).map(function (sCode) {
                return CONTROL_BY_FIELD[sCode];
            });
            var oFirstEditable = aIds.map(function (sId) {
                return this.byId(sId);
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
            var oEditButton = this.byId("editProfileButton");
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

            var sAction = oEdit.isRevision ? "resubmitProfileChange" : "submitProfileChange";
            var mParameters = oEdit.isRevision ? {
                RequestId: oEdit.requestId,
                ExpectedVersion: Number(oEdit.expectedVersion),
                IdempotencyKey: oEdit.idempotencyKey,
                ProfileVersion: oEdit.profileVersion,
                Remark: String(oEdit.remark || "").trim(),
                Changes: oResult.changes
            } : {
                IdempotencyKey: oEdit.idempotencyKey,
                ProfileVersion: oEdit.profileVersion,
                Remark: String(oEdit.remark || "").trim(),
                Changes: oResult.changes
            };

            oEditModel.setProperty("/busy", true);
            ProfileApi.executeAction(this._model(), sAction, mParameters).then(function () {
                oEditModel.setProperty("/busy", false);
                this.byId("profileEditDialog").close();
                MessageToast.show(this._bundle().getText(oEdit.isRevision ?
                    "profileResubmitSuccess" : "profileSubmitSuccess"));
                return this.refresh();
            }.bind(this)).catch(function (oError) {
                oEditModel.setProperty("/busy", false);
                MessageBox.error(this._errorText(oError));
            }.bind(this));
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

        _errorText: function (oError) {
            var oInfo = ProfileApi.errorInfo(oError);
            var sKey = {
                401: "profileErrorUnauthorized",
                403: "profileErrorForbidden",
                409: "profileErrorConflict",
                412: "profileErrorStale",
                503: "profileErrorServiceUnavailable"
            }[oInfo.status] || "profileErrorSubmit";
            return this._bundle().getText(sKey);
        },

        onExit: function () {
            if (this._pEditDialog) {
                this._pEditDialog.then(function (oDialog) { oDialog.destroy(); });
                this._pEditDialog = null;
            }
        }
    });
});
