sap.ui.define([], function () {
    "use strict";

    var BANK_GROUP = ["PAY_METHOD", "BANK_COUNTRY", "BANK_KEY", "BANK_ACCT"];

    function text(vValue) {
        return vValue === null || vValue === undefined ? "" : String(vValue).trim();
    }

    function same(vLeft, vRight) {
        return text(vLeft) === text(vRight);
    }

    function isTransfer(oValues, oOptions) {
        if (typeof oOptions.isBankTransfer === "boolean") {
            return oOptions.isBankTransfer;
        }
        return text(oValues.PAY_METHOD) === text(oOptions.transferCode);
    }

    function isEditable(mStates, sCode) {
        if (!Object.prototype.hasOwnProperty.call(mStates, sCode)) {
            return false;
        }
        var oState = mStates[sCode] || {};
        if (typeof oState.EffectiveEditable === "boolean") {
            return oState.EffectiveEditable;
        }
        return oState.Editable === true && oState.Locked !== true;
    }

    function validateField(sCode, vValue, oValues, oOptions) {
        var sValue = text(vValue);
        var oState = (oOptions.states || {})[sCode] || {};
        var iMaxLength = Number(oState.MaxLength || 0);

        if (oState.Mandatory && !sValue) {
            return "profileValidationRequired";
        }
        if (iMaxLength > 0 && sValue.length > iMaxLength) {
            return "profileValidationMaxLength";
        }

        switch (sCode) {
        case "WORK_EMAIL":
            return sValue && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sValue) ?
                "profileValidationEmail" : "";
        case "MARITAL_STATUS":
            return sValue && !["0", "1", "2", "3"].includes(sValue) ?
                "profileValidationMaritalStatus" : "";
        case "TAX_CODE":
            return sValue && !/^\d{10}$/.test(sValue) ? "profileValidationTaxCode" : "";
        case "CURR_ADDRESS":
        case "ADDRESS":
            return sValue.length > 60 ? "profileValidationAddress" : "";
        case "TELEPHONE":
            return sValue && !/^[+\d][\d\s().-]{6,29}$/.test(sValue) ?
                "profileValidationTelephone" : "";
        case "BANK_ACCT":
            if (isTransfer(oValues, oOptions) && !/^\d{10,18}$/.test(sValue)) {
                return "profileValidationBankAccount";
            }
            return "";
        case "PAY_METHOD":
        case "BANK_COUNTRY":
        case "BANK_KEY":
            if (isTransfer(oValues, oOptions) && !sValue) {
                return "profileValidationRequired";
            }
            return "";
        default:
            return "";
        }
    }

    function buildChanges(oValues, oOriginal, oOptions) {
        var oChanges = {};
        var oStates = oOptions.states || {};

        Object.keys(oValues).forEach(function (sCode) {
            if (!isEditable(oStates, sCode)) {
                return;
            }
            if (!same(oValues[sCode], oOriginal[sCode])) {
                oChanges[sCode] = text(oValues[sCode]);
            }
        });

        var bBankChanged = BANK_GROUP.some(function (sCode) {
            return Object.prototype.hasOwnProperty.call(oChanges, sCode);
        });
        if (bBankChanged && isTransfer(oValues, oOptions)) {
            BANK_GROUP.forEach(function (sCode) {
                if (isEditable(oStates, sCode)) {
                    oChanges[sCode] = text(oValues[sCode]);
                }
            });
        }

        return Object.keys(oChanges).map(function (sCode) {
            return {
                FieldCode: sCode,
                NewValue: oChanges[sCode]
            };
        });
    }

    function validateProfileChange(oValues, oOriginal, oOptions) {
        var oErrors = {};
        var aCodes = Object.keys(oValues);
        aCodes.forEach(function (sCode) {
            if (!isEditable(oOptions.states || {}, sCode)) {
                return;
            }
            var sErrorKey = validateField(sCode, oValues[sCode], oValues, oOptions);
            if (sErrorKey) {
                oErrors[sCode] = sErrorKey;
            }
        });

        var aChanges = buildChanges(oValues, oOriginal, oOptions);
        if (!aChanges.length) {
            oErrors._form = "profileValidationNoChanges";
        }
        if (text(oOptions.remark).length > 500) {
            oErrors._remark = "profileValidationRemarkLength";
        }

        return {
            valid: Object.keys(oErrors).length === 0,
            errors: oErrors,
            changes: aChanges
        };
    }

    return {
        validateField: validateField,
        validateProfileChange: validateProfileChange,
        buildChanges: buildChanges
    };
});
