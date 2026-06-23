const fs = require('fs');
let content = fs.readFileSync('app/timesheet/webapp/controller/App.controller.js', 'utf8');

const geti18nText = `        getText: function(sKey, aArgs) {
            return this.getView().getModel('i18n').getResourceBundle().getText(sKey, aArgs);
        },
`;

if (!content.includes('getText: function')) {
    content = content.replace('parseAbapDate: function (sDate) {', geti18nText + '\n        parseAbapDate: function (sDate) {');
}

const replacements = {
  '"Dashboard content will be developed later."': 'this.getText("txtDashboardComing")',
  '"Coming soon"': 'this.getText("txtReportsComing")',
  '"Please fill all required fields."': 'this.getText("msgFillRequired")',
  '"Request submitted successfully."': 'this.getText("msgReqSubmitted")',
  '"Failed to submit request:\\n"': 'this.getText("msgReqFailed") + "\\n"',
  '"Are you sure you want to cancel this request?"': 'this.getText("msgConfirmCancel")',
  '"Are you sure you want to approve this request?"': 'this.getText("msgConfirmApprove")',
  '"Are you sure you want to reject this request?"': 'this.getText("msgConfirmReject")',
  '"Request cancelled successfully."': 'this.getText("msgReqCancelled")',
  '"Request approved."': 'this.getText("msgReqApproved")',
  '"Request rejected."': 'this.getText("msgReqRejected")',

  'text: "Pending"': 'text: this.getText("statusPending")',
  'text: "Approved"': 'text: this.getText("statusApproved")',
  'text: "Rejected"': 'text: this.getText("statusRejected")',
  'text: "Cancelled"': 'text: this.getText("statusCancelled")',

  'text: "Day Off"': 'text: this.getText("reqTypeDayOff")',
  'text: "Edit Timesheet"': 'text: this.getText("reqTypeEdit")',
  'text: "Overtime"': 'text: this.getText("reqTypeOvertime")',

  'text: "Absent"': 'text: this.getText("statusAbsent")',
  'text: "Full Attendance"': 'text: this.getText("statusFullAttendance")',
  'text: "Late / Leave Early"': 'text: this.getText("statusLateLeaveEarly")',

  '" Day(s)"': ' " " + this.getText("txtDayS")',
  '" Hour(s)"': ' " " + this.getText("txtHourS")'
};

for (const [key, value] of Object.entries(replacements)) {
  content = content.split(key).join(value);
}

fs.writeFileSync('app/timesheet/webapp/controller/App.controller.js', content);
console.log('App.controller.js successfully updated using script.');
