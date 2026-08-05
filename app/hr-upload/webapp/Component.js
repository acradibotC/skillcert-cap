sap.ui.define([
    "sap/ui/core/UIComponent",
    "sap/ui/model/json/JSONModel"
], function (UIComponent, JSONModel) {
    "use strict";

    sap.ui.loader.config({
        paths: {
            "znxr09/znxr09f300": "/profile/webapp"
        }
    });

    function initialsFromName(sName) {
        return String(sName || "")
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .slice(-2)
            .map(function (sPart) { return sPart.charAt(0).toUpperCase(); })
            .join("");
    }

    return UIComponent.extend("znxr09.hrupload.Component", {
        metadata: { manifest: "json" },
        init: function () {
            UIComponent.prototype.init.apply(this, arguments);

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
                isHrAdmin: false,
                canUseHrTools: false
            });
            this.setModel(oUserModel, "user");

            var fnResolveUser;
            this.pUserLoaded = new Promise(function (resolve) {
                fnResolveUser = resolve;
            });

            jQuery.ajax({
                url: "/api/currentUser",
                method: "GET",
                headers: {
                    "Accept": "application/json"
                },
                success: function (oData) {
                    var bAuthorized = Boolean(oData && oData.authorized !== false && oData.email && oData.pernr);
                    var sName = oData && (oData.name || oData.email) || "";
                    oUserModel.setData({
                        authorized: bAuthorized,
                        loadState: bAuthorized ? "ready" : "denied",
                        userId: oData && (oData.userId || oData.email) || "",
                        email: oData && oData.email || "",
                        sapUserId: oData && (oData.sapUserId || oData.email) || "",
                        pernr: oData && oData.pernr || "",
                        name: sName,
                        initials: initialsFromName(sName),
                        position: oData && oData.position || "",
                        department: oData && oData.department || "",
                        phone: oData && oData.phone || "",
                        roles: Array.isArray(oData && oData.roles) ? oData.roles : [],
                        isManager: oData && oData.isManager === true,
                        isHrAdmin: oData && oData.isHrAdmin === true,
                        canUseHrTools: oData && oData.canUseHrTools === true
                    });
                    fnResolveUser(bAuthorized);
                },
                error: function () {
                    oUserModel.setProperty("/loadState", "error");
                    fnResolveUser(false);
                }
            });
        }
    });
});
