sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageBox",
    "sap/m/MessageToast"
], function (Controller, JSONModel, MessageBox, MessageToast) {
    "use strict";

    return Controller.extend("znxr09.znxr09f300.controller.CertDetail", {

        onInit: function () {
            this.getOwnerComponent().getRouter()
                .getRoute("certDetail")
                .attachPatternMatched(this._onRouteMatched, this);
        },

        /**
         * Helper: get i18n ResourceBundle
         */
        _getBundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        },

        /**
         * Formatter for composite binding with message parameters.
         * Usage in XML: formatter:'.formatMessage'
         */
        formatMessage: function () {
            var aArgs = Array.prototype.slice.call(arguments);
            var sPattern = aArgs.shift();
            if (!sPattern) { return ""; }
            return sPattern.replace(/\{(\d+)\}/g, function (sMatch, sIndex) {
                return aArgs[parseInt(sIndex, 10)] !== undefined ? aArgs[parseInt(sIndex, 10)] : sMatch;
            });
        },

        _onRouteMatched: function (oEvent) {
            var sRequestId = oEvent.getParameter("arguments").certIndex;
            var oView = this.getView();
            
            // OData V4: UUID type must NOT have single quotes in the key predicate
            var sPath = "/Request(RequestId=" + sRequestId + ")";
            // Hide layout until data is received
            var oLayout = this.byId("objectPageLayout");
            if (oLayout) {
                oLayout.setVisible(false);
            }

            sap.ui.core.BusyIndicator.show(0);
            oView.bindElement({
                path: sPath,
                model: "odata",
                events: {
                    dataRequested: function () {
                        sap.ui.core.BusyIndicator.show(0);
                    },
                    dataReceived: function () {
                        sap.ui.core.BusyIndicator.hide();
                        if (oLayout) {
                            oLayout.setVisible(true);
                        }
                    }
                }
            });
        },

        onNavBack: function () {
            this.getOwnerComponent().getRouter().navTo("skillList");
        },

        onApprove: function () {
            var that = this;
            var oBundle = this._getBundle();
            
            MessageBox.confirm(oBundle.getText("msgConfirmApproveCert"), {
                title: oBundle.getText("msgConfirmApproveTitle"),
                actions: [MessageBox.Action.YES, MessageBox.Action.NO],
                emphasizedAction: MessageBox.Action.YES,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.YES) {
                        that._processApproval();
                    }
                }
            });
        },

        onReject: function () {
            var that = this;
            var oBundle = this._getBundle();
            
            var oTextArea = new sap.m.TextArea({
                width: "100%",
                placeholder: oBundle.getText("msgRejectReasonPlaceholder"),
                rows: 4
            });

            var oDialog = new sap.m.Dialog({
                title: oBundle.getText("msgRejectCertTitle"),
                type: "Message",
                state: "Warning",
                content: [
                    new sap.m.Label({ text: oBundle.getText("msgConfirmRejectCert"), labelFor: oTextArea }),
                    oTextArea
                ],
                beginButton: new sap.m.Button({
                    type: "Emphasized",
                    text: oBundle.getText("btnConfirmReject"),
                    press: function () {
                        var sReason = oTextArea.getValue();
                        if (!sReason || !sReason.trim()) {
                            MessageBox.error(oBundle.getText("msgErrRejectReasonRequired"));
                            return;
                        }
                        that._processRejection(sReason.trim());
                        oDialog.close();
                    }
                }),
                endButton: new sap.m.Button({
                    text: oBundle.getText("btnCancel"),
                    press: function () {
                        oDialog.close();
                    }
                }),
                afterClose: function () {
                    oDialog.destroy();
                }
            });

            oDialog.open();
        },

        _processApproval: function () {
            var oView = this.getView();
            var oContext = oView.getBindingContext("odata");
            var oBundle = this._getBundle();

            sap.ui.core.BusyIndicator.show(0);
            var oAction = oContext.getModel().bindContext("com.sap.gateway.srvd.zui_nxr_skillreq_o4.v0001.approveRequest(...)", oContext);
            
            oAction.execute().then(function() {
                sap.ui.core.BusyIndicator.hide();
                MessageToast.show(oBundle.getText("msgCertApproved"));
                oContext.getModel().refresh();
            }).catch(function(oError) {
                sap.ui.core.BusyIndicator.hide();
                MessageBox.error(oError.message || "Approval failed");
            });
        },

        _processRejection: function (sReason) {
            var oView = this.getView();
            var oContext = oView.getBindingContext("odata");
            var oBundle = this._getBundle();

            sap.ui.core.BusyIndicator.show(0);
            var oAction = oContext.getModel().bindContext("com.sap.gateway.srvd.zui_nxr_skillreq_o4.v0001.rejectRequest(...)", oContext);
            oAction.setParameter("RejectionReason", sReason);
            
            oAction.execute().then(function() {
                sap.ui.core.BusyIndicator.hide();
                MessageToast.show(oBundle.getText("msgCertRejected"));
                oContext.getModel().refresh();
            }).catch(function(oError) {
                sap.ui.core.BusyIndicator.hide();
                MessageBox.error(oError.message || "Rejection failed");
            });
        }
    });
});
