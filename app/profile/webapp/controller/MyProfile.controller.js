sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "znxr09/znxr09f300/model/profileFormatter",
    "znxr09/znxr09f300/util/ProfileApi"
], function (Controller, JSONModel, formatter, ProfileApi) {
    "use strict";

    return Controller.extend("znxr09.znxr09f300.controller.MyProfile", {
        formatter: formatter,

        onInit: function () {
            this.getView().setModel(new JSONModel({
                busy: true,
                errorKey: "",
                hasData: false
            }), "profileUi");
            this.getView().setModel(new JSONModel({}), "profile");

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
                hasData: false
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
                        EffectiveEditable: false,
                        StatusText: ""
                    });
                });
                oProfile.Initials = this._initials(oProfile.EmployeeName);
                this.getView().getModel("profile").setData(oProfile);

                var oUserModel = this.getOwnerComponent().getModel("user");
                oUserModel.setProperty("/name", oProfile.EmployeeName || oUserModel.getProperty("/name"));
                oUserModel.setProperty("/initials", oProfile.Initials);
                oUserModel.setProperty("/position", oProfile.PositionName || "");
                oUserModel.setProperty("/department", oProfile.OrgUnitName || "");

                oUiModel.setData({ busy: false, errorKey: "", hasData: true });
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

        profileErrorText: function (sKey) {
            return sKey ? this._bundle().getText(sKey) : "";
        },

        onRefreshProfile: function () {
            this.refresh();
        }
    });
});
