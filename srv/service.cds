using { ZUI_NXR_SKILLREQ_O4 as external } from './external/ZUI_NXR_SKILLREQ_O4';
using { ZUI_NXR_WORKSCHEDULE_O4 as cal_external } from './external/ZUI_NXR_WORKSCHEDULE_O4';

service SkillService @(path: '/api/v1') {
    entity Request as projection on external.Request;
    entity UserProfile as projection on external.UserProfile;
    entity TeamMembers as projection on external.TeamMembers;
    entity QualificationCatalog as projection on external.QualificationCatalog;

    @readonly
    entity certSources {
        key ![key]: String;
        text: String;
    }

    // Bound actions in V4 must be explicitly defined if we want to expose them?
    // Actually in CAP V4 proxying, actions are not automatically proxied unless bound to the projection or redefined.
    // Let's redefine them for Request:
    action approveRequest(RequestId: String) returns Request;
    action rejectRequest(RequestId: String, RejectionReason: String) returns Request;
}

service CalendarService @(path: '/api/v2') {
    entity WorkSchedule as projection on cal_external.WorkSchedule;
}

service AuthService @(path: '/auth') {
    function me() returns String; // Custom endpoint to get current user info
}

// ============================================================
// Attendance Request Service — Approval Workflow (Local DB)
// ============================================================
using { ZUI_NXR_ATTREQ_O4 as att_external } from './external/ZUI_NXR_ATTREQ_O4';

service AttendanceService @(path: '/api/v3') {
    entity AttendanceRequest as projection on att_external.AttendanceRequest;

    // Approval actions
    action approveAttRequest(RequestId: UUID)                              returns AttendanceRequest;
    action rejectAttRequest(RequestId: UUID, RejectionReason: String(500)) returns AttendanceRequest;
    action cancelAttRequest(RequestId: UUID)                               returns AttendanceRequest;

    // Read-only helper: request type catalog
    @readonly entity requestTypes {
        key code : String;
        text     : String;
        icon     : String;
    }
}

// ============================================================
// Worktime Upload Service — HR Bulk Upload
// ============================================================
service WorktimeUploadService @(path: '/api/v4') {
    // Custom actions for upload workflow
    action uploadBatch(records: array of WorktimePayload) returns UploadResult;
    action checkExisting(months: array of String)          returns ExistingResult;

    type WorktimePayload {
        Pernr         : String(8);
        WorkDate      : String(8);
        FirstEntry    : String(6);
        LastExit      : String(6);
        Iot           : Decimal(5,2);
        Iotwf         : Decimal(5,2);
        Iwa           : Decimal(5,2);
        NumberOfEntry : Integer;
        NumberOfExit  : Integer;
    }

    type UploadResult {
        success : Integer;
        failed  : Integer;
        message : String;
    }

    type ExistingResult {
        count   : Integer;
        months  : String;
    }
}
