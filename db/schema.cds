namespace znxr09.db;

using { cuid, managed } from '@sap/cds/common';

// Notification read/unread state per employee
entity NotificationRead : cuid, managed {
    pernr      : String(8)   @mandatory;   // Employee PERNR who received the notification
    notifType  : String(30)  @mandatory;   // e.g. ATT_PENDING, ATT_APPROVED, SKILL_PENDING, etc.
    requestId  : String(40)  @mandatory;   // The original request UUID/ID
    isRead     : Boolean default false;    // true = read, false = unread
    readAt     : Timestamp;                // When marked as read
}

