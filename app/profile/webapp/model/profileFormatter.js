sap.ui.define([
    "sap/ui/core/format/DateFormat"
], function (DateFormat) {
    "use strict";

    var SENSITIVE_FIELDS = {
        ID_NUMBER: true,
        TAX_CODE: true,
        BANK_ACCT: true
    };

    function formatterMask(vValue, sFieldCode, bReveal) {
        var sValue = vValue === null || vValue === undefined ? "" : String(vValue);
        if (!sValue) {
            return "—";
        }
        if (bReveal || !SENSITIVE_FIELDS[String(sFieldCode || "").toUpperCase()]) {
            return sValue;
        }
        var sLast = sValue.slice(-4);
        return "•".repeat(Math.max(4, Math.min(12, sValue.length - sLast.length))) + sLast;
    }

    return {
        statusState: function (sStatus) {
            return {
                "01": "Warning",
                "02": "Success",
                "03": "Error",
                "04": "Information"
            }[sStatus] || "None";
        },

        statusIcon: function (sStatus) {
            return {
                "01": "sap-icon://pending",
                "02": "sap-icon://accept",
                "03": "sap-icon://decline",
                "04": "sap-icon://edit"
            }[sStatus] || "";
        },

        displayValue: function (vValue) {
            return vValue === null || vValue === undefined || vValue === "" ? "—" : String(vValue);
        },

        formatDate: function (vValue) {
            if (!vValue) {
                return "—";
            }
            var oDate = vValue instanceof Date ? vValue : new Date(vValue);
            if (Number.isNaN(oDate.getTime())) {
                return String(vValue);
            }
            return DateFormat.getDateInstance({ style: "medium" }).format(oDate);
        },

        formatDateTime: function (vValue) {
            if (!vValue) {
                return "—";
            }
            var oDate = vValue instanceof Date ? vValue : new Date(vValue);
            if (Number.isNaN(oDate.getTime())) {
                return String(vValue);
            }
            return DateFormat.getDateTimeInstance({ style: "medium" }).format(oDate);
        },

        maskProfileValue: function (vValue, sFieldCode, bReveal) {
            return formatterMask(vValue, sFieldCode, bReveal);
        },

        maskBankAccount: function (vValue) {
            return formatterMask(vValue, "BANK_ACCT", false);
        },

        profileItemValue: function (vDisplayValue, vRawValue, sFieldCode, bReveal) {
            return formatterMask(vDisplayValue || vRawValue, sFieldCode, bReveal);
        }
    };
});
