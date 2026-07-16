sap.ui.define([], function () {
    "use strict";

    function requestList(oModel, sPath, aFilters, aSorters, mParameters, iLimit) {
        var oBinding = oModel.bindList(
            sPath,
            null,
            aSorters || [],
            aFilters || [],
            mParameters || {}
        );
        return oBinding.requestContexts(0, iLimit || 200).then(function (aContexts) {
            return aContexts.map(function (oContext) {
                return Object.assign({}, oContext.getObject());
            });
        });
    }

    function requestFirst(oModel, sPath, mParameters) {
        return requestList(oModel, sPath, [], [], mParameters, 1).then(function (aRows) {
            return aRows[0] || null;
        });
    }

    function executeAction(oModel, sActionName, mParameters) {
        var oOperation = oModel.bindContext("/" + sActionName + "(...)", null, {
            "$$groupId": "$direct"
        });
        Object.keys(mParameters || {}).forEach(function (sParameter) {
            oOperation.setParameter(sParameter, mParameters[sParameter]);
        });
        return oOperation.execute().then(function () {
            var oResultContext = oOperation.getBoundContext();
            if (!oResultContext) {
                return null;
            }
            return oResultContext.requestObject().catch(function () {
                return oResultContext.getObject();
            });
        });
    }

    function errorInfo(oError) {
        var oInfo = {
            status: Number(oError && (oError.status || oError.statusCode)) || 0,
            message: oError && oError.message ? String(oError.message) : "",
            code: ""
        };
        var sBody = oError && (oError.responseText || oError.cause && oError.cause.responseText);
        if (sBody) {
            try {
                var oPayload = JSON.parse(sBody);
                var oBackendError = oPayload.error || oPayload;
                oInfo.code = oBackendError.code || "";
                oInfo.message = oBackendError.message &&
                    (oBackendError.message.value || oBackendError.message) || oInfo.message;
            } catch (oParseError) {
                // Keep the sanitized framework message. Never log the response body,
                // because profile errors may contain personal data.
            }
        }
        return oInfo;
    }

    function idempotencyKey() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return "profile-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    }

    return {
        requestList: requestList,
        requestFirst: requestFirst,
        executeAction: executeAction,
        errorInfo: errorInfo,
        idempotencyKey: idempotencyKey
    };
});
