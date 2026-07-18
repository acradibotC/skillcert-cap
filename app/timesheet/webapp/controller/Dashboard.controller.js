sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/json/JSONModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox"
], function (Controller, JSONModel, MessageToast, MessageBox) {
    "use strict";

    function isoDate(date) { return date.toISOString().slice(0, 10); }

    return Controller.extend("znxr09.timesheet.controller.Dashboard", {
        onInit: function () {
            var now = new Date();
            var start = new Date(now.getFullYear(), now.getMonth(), 1);
            this.getView().setModel(new JSONModel({
                busy: false,
                periodFrom: isoDate(start), periodTo: isoDate(now),
                dataAsOf: "",
                summary: { totalEmployees: 0, avgActualHours: 0, fullAttendanceRate: 0, lateEarlyRate: 0, absentRate: 0 },
                byOrgUnit: [], employees: []
            }), "dashboard");
            this.loadDashboard();
        },

        onSearch: function () { this.loadDashboard(); },

        loadDashboard: function () {
            var model = this.getView().getModel("dashboard");
            var from = model.getProperty("/periodFrom");
            var to = model.getProperty("/periodTo");
            if (!from || !to || from > to) { MessageBox.error("Please select a valid period."); return; }
            model.setProperty("/busy", true);
            jQuery.ajax({
                url: "/api/v6/dashboard?periodFrom=" + encodeURIComponent(from) + "&periodTo=" + encodeURIComponent(to),
                method: "GET"
            }).done(function (data) {
                model.setData(Object.assign({ busy: false }, data));
            }).fail(function (xhr) {
                model.setProperty("/busy", false);
                model.setProperty("/byOrgUnit", []);
                model.setProperty("/employees", []);
                MessageBox.error((xhr.responseJSON && xhr.responseJSON.error) || "Dashboard data is unavailable.");
            });
        },

        onExport: function (event) {
            var format = event.getParameter("item").getKey();
            var model = this.getView().getModel("dashboard");
            var url = "/api/v6/dashboard/export?format=" + encodeURIComponent(format) +
                "&periodFrom=" + encodeURIComponent(model.getProperty("/periodFrom")) +
                "&periodTo=" + encodeURIComponent(model.getProperty("/periodTo"));
            window.open(url, "_blank", "noopener");
            MessageToast.show("Preparing " + format.toUpperCase() + " export...");
        }
    });
});
