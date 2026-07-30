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
    ProfileApi
) {
    "use strict";

    return Controller.extend("znxr09.znxr09f300.controller.ProfileApprovalInbox", {
        formatter: formatter,

        onInit: function () {
            this.getView().setModel(new JSONModel({
                busy: false,
                loaded: false,
                errorKey: "",
                search: "",
                status: "01",
                pendingCount: 0,
                revealSensitive: false
            }), "hrUi");
            this.getView().setModel(new JSONModel({ allRows: [], rows: [] }), "hrInbox");
            this.getView().setModel(new JSONModel({
                request: {},
                items: [],
                events: [],
                comment: "",
                busy: false
            }), "hrDetail");
        },

        _bundle: function () {
            return this.getOwnerComponent().getModel("i18n").getResourceBundle();
        },

        _model: function () {
            return this.getOwnerComponent().getModel("profileService");
        },

        activate: function () {
            return this.getOwnerComponent().pUserLoaded.then(function (bAuthorized) {
                var oUserModel = this.getOwnerComponent().getModel("user");
                if (!bAuthorized || !oUserModel.getProperty("/isHrAdmin")) {
                    this.getView().getModel("hrUi").setProperty("/errorKey", "profileErrorForbidden");
                    return;
                }
                if (!this.getView().getModel("hrUi").getProperty("/loaded")) {
                    return this.refresh();
                }
            }.bind(this));
        },

        refresh: function () {
            var oUiModel = this.getView().getModel("hrUi");
            var oModel = this._model();
            if (!oModel) {
                oUiModel.setProperty("/errorKey", "profileErrorServiceUnavailable");
                return Promise.resolve();
            }

            oUiModel.setProperty("/busy", true);
            oUiModel.setProperty("/errorKey", "");
            return ProfileApi.requestList(oModel, "/ProfileApprovalRequests", [], [
                new Sorter("SubmittedAt", true)
            ], {}, 200).then(function (aRows) {
                aRows.forEach(function (oRequest) {
                    if (!oRequest.StatusText) {
                        oRequest.StatusText = this._statusText(oRequest.Status);
                    }
                }.bind(this));
                this.getView().getModel("hrInbox").setProperty("/allRows", aRows);
                oUiModel.setProperty("/pendingCount", aRows.filter(function (oRequest) {
                    return oRequest.Status === "01";
                }).length);
                oUiModel.setProperty("/loaded", true);
                this._applyFilters();
            }.bind(this)).catch(function (oError) {
                oUiModel.setProperty("/errorKey", this._errorKey(oError));
            }.bind(this)).finally(function () {
                oUiModel.setProperty("/busy", false);
            });
        },

        _statusText: function (sStatus) {
            return this._bundle().getText({
                "01": "profileStatusPending",
                "02": "profileStatusApproved",
                "03": "profileStatusRejected",
                "04": "profileStatusRevision"
            }[sStatus] || "profileStatusUnknown");
        },

        hrErrorText: function (sKey) {
            return sKey ? this._bundle().getText(sKey) : "";
        },

        onRefreshInbox: function () {
            this.refresh();
        },

        onInboxSearch: function (oEvent) {
            this.getView().getModel("hrUi").setProperty("/search",
                oEvent.getParameter("newValue") || oEvent.getParameter("query") || "");
            this._applyFilters();
        },

        onInboxStatusChange: function (oEvent) {
            this.getView().getModel("hrUi").setProperty("/status", oEvent.getSource().getSelectedKey());
            this._applyFilters();
        },

        _applyFilters: function () {
            var oUi = this.getView().getModel("hrUi").getData();
            var aRows = this.getView().getModel("hrInbox").getProperty("/allRows") || [];
            var sQuery = String(oUi.search || "").trim().toLowerCase();
            var aVisible = aRows.filter(function (oRequest) {
                var bStatus = !oUi.status || oUi.status === "ALL" || oRequest.Status === oUi.status;
                var sHaystack = [oRequest.RequestNo, oRequest.ID, oRequest.Pernr, oRequest.EmployeeName]
                    .join(" ").toLowerCase();
                return bStatus && (!sQuery || sHaystack.indexOf(sQuery) >= 0);
            });
            this.getView().getModel("hrInbox").setProperty("/rows", aVisible);
        },

        onOpenApprovalDetail: function (oEvent) {
            var oItem = oEvent.getParameter("listItem") || oEvent.getSource();
            var oContext = oItem.getBindingContext("hrInbox");
            if (!oContext) {
                return;
            }
            var oRequest = Object.assign({}, oContext.getObject());
            var oDetailModel = this.getView().getModel("hrDetail");
            oDetailModel.setData({
                request: oRequest,
                items: [],
                events: [],
                comment: oRequest.HrComment || "",
                busy: true
            });
            this.getView().getModel("hrUi").setProperty("/revealSensitive", false);

            if (!this._pDetailDialog) {
                this._pDetailDialog = Fragment.load({
                    id: this.getView().getId(),
                    name: "znxr09.znxr09f300.view.ProfileApprovalDetailDialog",
                    controller: this
                }).then(function (oDialog) {
                    this.getView().addDependent(oDialog);
                    return oDialog;
                }.bind(this));
            }

            this._pDetailDialog.then(function (oDialog) {
                oDialog.open();
                return Promise.all([
                    ProfileApi.requestList(this._model(), "/ProfileApprovalRequestItems", [
                        new Filter("RequestId", FilterOperator.EQ, oRequest.ID),
                        new Filter("IsCurrent", FilterOperator.EQ, true)
                    ], [new Sorter("Sequence", false)], {}, 200),
                    ProfileApi.requestList(this._model(), "/ProfileRequestEvents", [
                        new Filter("RequestId", FilterOperator.EQ, oRequest.ID)
                    ], [new Sorter("CreatedAt", true)], {}, 100).catch(function () { return []; })
                ]);
            }.bind(this)).then(function (aResults) {
                oDetailModel.setProperty("/items", aResults[0]);
                oDetailModel.setProperty("/events", aResults[1]);
            }).catch(function (oError) {
                MessageBox.error(this._bundle().getText(this._errorKey(oError)));
            }.bind(this)).finally(function () {
                oDetailModel.setProperty("/busy", false);
            });
        },

        onToggleSensitiveValues: function () {
            var oUiModel = this.getView().getModel("hrUi");
            oUiModel.setProperty("/revealSensitive", !oUiModel.getProperty("/revealSensitive"));
        },

        onCloseApprovalDetail: function () {
            this.byId("profileApprovalDetailDialog").close();
        },

        onRequestProfileChanges: function () {
            this._executeDecision("requestProfileChanges", true, "profileRequestChangesConfirm");
        },

        onRejectProfileChange: function () {
            this._executeDecision("rejectProfileChange", true, "profileRejectConfirm");
        },

        onApproveProfileChange: function () {
            this._executeDecision("approveProfileChange", false, "profileApproveConfirm");
        },

        _executeDecision: function (sActionName, bCommentRequired, sConfirmKey) {
            var oDetailModel = this.getView().getModel("hrDetail");
            var oDetail = oDetailModel.getData();
            var sComment = String(oDetail.comment || "").trim();
            if (bCommentRequired && !sComment) {
                MessageBox.error(this._bundle().getText("profileHrCommentRequired"));
                return;
            }
            if (sComment.length > 500) {
                MessageBox.error(this._bundle().getText("profileValidationRemarkLength"));
                return;
            }

            MessageBox.confirm(this._bundle().getText(sConfirmKey), {
                title: this._bundle().getText("profileDecisionConfirmTitle"),
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction !== MessageBox.Action.OK) {
                        return;
                    }
                    oDetailModel.setProperty("/busy", true);
                    ProfileApi.executeAction(this._model(), sActionName, {
                        RequestId: oDetail.request.ID,
                        ExpectedVersion: Number(oDetail.request.Version),
                        HrComment: sComment
                    }).then(function () {
                        MessageToast.show(this._bundle().getText({
                            requestProfileChanges: "profileRequestChangesSuccess",
                            rejectProfileChange: "profileRejectSuccess",
                            approveProfileChange: "profileApproveSuccess"
                        }[sActionName]));
                        this.byId("profileApprovalDetailDialog").close();
                        return this.refresh();
                    }.bind(this)).catch(function (oError) {
                        MessageBox.error(this._bundle().getText(this._errorKey(oError)));
                    }.bind(this)).finally(function () {
                        oDetailModel.setProperty("/busy", false);
                    });
                }.bind(this)
            });
        },

        _errorKey: function (oError) {
            var oInfo = ProfileApi.errorInfo(oError);
            return {
                SAP_PROFILE_WRITE_NOT_AVAILABLE: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_NOT_IMPLEMENTED: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_SERVICE_UNAVAILABLE: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_FAILED: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_REJECTED: "profileErrorSapApplyUnavailable",
                SAP_PROFILE_WRITE_EMPTY_PAYLOAD: "profileErrorSapApplyUnavailable"
            }[oInfo.code] || {
                401: "profileErrorUnauthorized",
                403: "profileErrorForbidden",
                409: "profileErrorConflict",
                412: "profileErrorStale",
                501: "profileErrorSapApplyUnavailable",
                503: "profileErrorServiceUnavailable"
            }[oInfo.status] || "profileErrorServiceUnavailable";
        },

        onExit: function () {
            if (this._pDetailDialog) {
                this._pDetailDialog.then(function (oDialog) { oDialog.destroy(); });
                this._pDetailDialog = null;
            }
        }
    });
});
