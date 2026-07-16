namespace znxr09.db;

using { cuid, managed } from '@sap/cds/common';

entity ProfileIdentityLinks : managed {
    key provider         : String(30);
    key subject          : String(255);
    employeePernr        : String(8)   @mandatory;
    loginEmail           : String(255);
    active               : Boolean default true;
}

@assert.unique: {
    employeeIdempotency: [employeePernr, idempotencyKey],
    requestNumber: [requestNo]
}
entity ProfileChangeRequests : cuid, managed {
    requestNo          : String(24)  @mandatory;
    employeePernr      : String(8)   @mandatory;
    employeeName       : String(120);
    requestedByEmail   : String(255) @mandatory;
    status             : String(2)   default '01';
    version            : Integer     default 1;
    revisionNo         : Integer     default 1;
    profileVersion     : String(64);
    idempotencyKey     : String(64)  @mandatory;
    payloadHash        : String(64)  @mandatory;
    lastResubmitKey    : String(64);
    lastResubmitHash   : String(64);
    employeeRemark     : String(500);
    hrComment          : String(500);
    applyState         : String(20)  default 'NOT_APPLIED';
    applyMessage       : String(500);
    isSimulation       : Boolean     default false;
    decisionBy         : String(255);
    decisionAt         : Timestamp;
    items              : Composition of many ProfileChangeItems
                           on items.request = $self;
    events             : Composition of many ProfileRequestEvents
                           on events.request = $self;
}

@assert.unique: { revisionField: [request, revisionNo, fieldName] }
entity ProfileChangeItems : cuid, managed {
    request             : Association to ProfileChangeRequests @mandatory;
    revisionNo          : Integer     @mandatory;
    sequence            : Integer     @mandatory;
    fieldName           : String(30)  @mandatory;
    fieldGroup          : String(30);
    oldValue            : String(500);
    newValue            : String(500);
    oldValueHash        : String(64);
    isSensitive         : Boolean     default false;
    mappingStatus       : String(20)  default 'UNCONFIRMED';
    sapInfotype         : String(8);
    sapSubtype          : String(8);
    sapField            : String(30);
    isCurrent           : Boolean     default true;
}

entity ProfileFieldLocks {
    key employeePernr   : String(8);
    key fieldName       : String(30);
    request             : Association to ProfileChangeRequests @mandatory;
    acquiredAt          : Timestamp;
}

entity ProfileRequestEvents : cuid {
    request             : Association to ProfileChangeRequests @mandatory;
    revisionNo          : Integer;
    eventType           : String(30) @mandatory;
    fromStatus          : String(2);
    toStatus            : String(2);
    actorEmail          : String(255);
    actorPernr          : String(8);
    actorRole           : String(20);
    comment             : String(500);
    correlationId       : String(64);
    occurredAt          : Timestamp;
}

entity ProfileNotificationOutbox : cuid, managed {
    request             : Association to ProfileChangeRequests @mandatory;
    eventType           : String(30)  @mandatory;
    recipientType       : String(20)  @mandatory;
    recipientKey        : String(255);
    deliveryStatus      : String(20)  default 'PENDING';
    attempts            : Integer     default 0;
    nextAttemptAt       : Timestamp;
    lastError           : String(500);
}

entity ProfileSnapshots : managed {
    key employeePernr   : String(8);
    employeeName        : String(120);
    position            : String(120);
    department          : String(120);
    idNumber            : String(20);
    telephone           : String(30);
    permanentAddress    : String(60);
    workEmail           : String(241);
    currentAddress      : String(60);
    taxCode             : String(10);
    paymentMethod       : String(1);
    bankCountry         : String(3);
    bankKey             : String(15);
    bankAccount         : String(18);
    bankName            : String(60);
    joinDate            : Date;
    contractType        : String(60);
    dependentsSummary   : String(255);
    version             : Integer default 1;
}
