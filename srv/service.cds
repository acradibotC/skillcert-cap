using { ZUI_NXR_SKILLREQ_O4 as external } from './external/ZUI_NXR_SKILLREQ_O4';
using { ZUI_NXR_WORKSCHEDULE_O4 as cal_external } from './external/ZUI_NXR_WORKSCHEDULE_O4';
using { znxr09.db as profile_db } from '../db/profile';

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
    action approveAttRequest(RequestId: String)                            returns AttendanceRequest;
    action rejectAttRequest(RequestId: String, RejectionReason: String(500)) returns AttendanceRequest;
    action cancelAttRequest(RequestId: String)                             returns AttendanceRequest;

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
    // Uploads validated rows into SAP staging. The 05:00 SAP job posts
    // queued rows to HR infotypes; this action never writes PA2002 directly.
    action uploadBatch(records: array of WorktimePayload, sourceFileName: String(128)) returns UploadResult;
    action checkExisting(records: array of WorktimeKey)    returns ExistingResult;

    type WorktimeKey {
        Pernr    : String(8);
        WorkDate : Date;
    }

    type WorktimePayload {
        Pernr         : String(8);
        WorkDate      : Date;
        FirstEntry    : Time;
        LastExit      : Time;
        Iot           : Decimal(5,2);
        Iotwf         : Decimal(5,2);
        Iwa           : Decimal(5,2);
        NumberOfEntry : Integer;
        NumberOfExit  : Integer;
    }

    type UploadResult {
        batchId : String(36);
        success : Integer;
        created : Integer;
        updated : Integer;
        failed  : Integer;
        message : String;
    }

    type ExistingResult {
        count : Integer;
        dates : array of Date;
    }
}

// ============================================================
// Notification Service — Read/Unread State (Local SQLite DB)
// ============================================================
using { znxr09.db as db } from '../db/schema';

service NotificationService @(path: '/api/v5') {
    entity NotificationRead as projection on db.NotificationRead;
}

// ============================================================
// MyProfile — local workflow contract and fail-closed SAP adapter
// ============================================================
service ProfileService @(path: '/api/profile/v1') {
    @readonly @cds.persistence.skip
    entity MyProfile {
        key Pernr              : String(8);
        EmployeeName           : String(120);
        DateOfBirth            : Date;
        Gender                 : String(20);
        Nationality            : String(60);
        MaritalStatus          : String(60);
        MaritalStatusCode      : String(1);
        PositionName           : String(120);
        OrgUnitName            : String(120);
        IdNumber               : String(20);
        Telephone              : String(30);
        PermanentAddress       : String(60);
        WorkEmail              : String(241);
        CurrentAddress         : String(60);
        TaxCode                : String(10);
        PayMethod              : String(1);
        PayMethodText          : String(60);
        BankCountry            : String(3);
        BankKey                : String(15);
        BankAccount            : String(18);
        BankName               : String(60);
        JoinDate               : Date;
        ContractType           : String(60);
        DependentsSummary      : String(255);
        ProfileVersion         : String(64);
        IsSimulation           : Boolean;
    }

    @readonly entity MyProfileRequests as projection on profile_db.ProfileChangeRequests {
        key ID,
        requestNo as RequestNo,
        employeePernr as Pernr,
        employeeName as EmployeeName,
        status as Status,
        version as Version,
        revisionNo as RevisionNo,
        employeeRemark as Remark,
        hrComment as HrComment,
        applyState as ApplyState,
        applyMessage as ApplyMessage,
        isSimulation as IsSimulation,
        createdAt as SubmittedAt,
        modifiedAt as ModifiedAt
    };

    @readonly entity MyProfileRequestItems as projection on profile_db.ProfileChangeItems {
        key ID,
        request.ID as RequestId,
        request.employeePernr as Pernr,
        sequence as Sequence,
        revisionNo as RevisionNo,
        fieldName as FieldCode,
        oldValue as OldValue,
        newValue as NewValue,
        isCurrent as IsCurrent
    };

    @readonly entity ProfileApprovalRequests as projection on profile_db.ProfileChangeRequests {
        key ID,
        requestNo as RequestNo,
        employeePernr as Pernr,
        employeeName as EmployeeName,
        status as Status,
        version as Version,
        revisionNo as RevisionNo,
        employeeRemark as Remark,
        hrComment as HrComment,
        applyState as ApplyState,
        applyMessage as ApplyMessage,
        isSimulation as IsSimulation,
        createdAt as SubmittedAt,
        modifiedAt as ModifiedAt
    };

    @readonly entity ProfileApprovalRequestItems as projection on profile_db.ProfileChangeItems {
        key ID,
        request.ID as RequestId,
        sequence as Sequence,
        revisionNo as RevisionNo,
        fieldName as FieldCode,
        fieldGroup as FieldGroup,
        oldValue as OldValue,
        newValue as NewValue,
        isSensitive as IsSensitive,
        mappingStatus as MappingStatus,
        isCurrent as IsCurrent
    };

    @readonly entity ProfileRequestEvents as projection on profile_db.ProfileRequestEvents {
        key ID,
        request.ID as RequestId,
        revisionNo as RevisionNo,
        eventType as EventType,
        fromStatus as FromStatus,
        toStatus as ToStatus,
        actorRole as ActorRole,
        comment as Comment,
        occurredAt as CreatedAt
    };

    @readonly @cds.persistence.skip
    entity MyProfileFields {
        key FieldCode          : String(30);
        Value                  : String(500);
        DisplayValue           : String(500);
        FieldGroup             : String(30);
        MaxLength              : Integer;
        Editable               : Boolean;
        Mandatory              : Boolean;
        Sensitive              : Boolean;
        Locked                 : Boolean;
        LockRequestId          : UUID;
        LockStatus             : String(2);
        MappingStatus         : String(20);
    }

    @readonly @cds.persistence.skip
    entity ProfilePaymentMethods {
        key Code               : String(1);
        Text                   : String(60);
        Category               : String(30);
        IsBankTransfer         : Boolean;
    }

    @readonly @cds.persistence.skip
    entity ProfileBanks {
        key BankCountry        : String(3);
        key BankKey            : String(15);
        BankName               : String(60);
        IsSimulation           : Boolean;
    }

    @readonly @cds.persistence.skip
    entity ProfileMaritalStatuses {
        key MaritalStatusCode : String(1);
        MaritalStatusText     : String(60);
        Language              : String(2);
        IsSimulation          : Boolean;
    }

    type ProfileChangeInput {
        FieldCode              : String(30);
        NewValue               : String(500);
    }

    action submitProfileChange(
        IdempotencyKey         : String(64),
        ProfileVersion         : String(64),
        Remark                 : String(500),
        Changes                : array of ProfileChangeInput
    ) returns MyProfileRequests;

    action resubmitProfileChange(
        RequestId              : UUID,
        ExpectedVersion        : Integer,
        IdempotencyKey         : String(64),
        ProfileVersion         : String(64),
        Remark                 : String(500),
        Changes                : array of ProfileChangeInput
    ) returns MyProfileRequests;

    action requestProfileChanges(RequestId: UUID, ExpectedVersion: Integer, HrComment: String(500)) returns ProfileApprovalRequests;
    action rejectProfileChange(RequestId: UUID, ExpectedVersion: Integer, HrComment: String(500)) returns ProfileApprovalRequests;
    action approveProfileChange(RequestId: UUID, ExpectedVersion: Integer, HrComment: String(500)) returns ProfileApprovalRequests;
}
