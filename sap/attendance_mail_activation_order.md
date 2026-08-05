# Attendance Request Mail Notification Activation

Transports used during MCP setup:

- `S40K919620` owned by `DEV-269`: `ZTB_NXR_ATTMAIL`.
- `S40K919622` owned by `DEV-269`: `ZNXR_ATTREQ_MAIL_JOB`.

## Objects

1. Table `ZTB_NXR_ATTMAIL`
   - Package: `ZPK_ZNXR09F410`
   - Source: `sap/ztb_nxr_attmail.tabl.asddl`
   - Purpose: durable idempotency log for sent or failed attendance workflow emails.

2. Program `ZNXR_ATTREQ_MAIL_JOB`
   - Package: `ZPK_ZNXR09F410`
   - Source: `sap/znxr_attreq_mail_job.prog.abap`
   - Purpose: sends SAP Business Communication Services email with `CL_BCS`.

## Business events

- `SUBMITTED`: request status `01`; send notification to the manager/approver email in `ZTB_NXR_ATTREQ-APPROVER_ID`.
- `APPROVED`: request status `02`; send notification to employee email from `ZI_NXR_HR_TEAM_MEMBERS-EmployeeEmail`, fallback `PA0105` subtype `0010`.
- `REJECTED`: request status `03`; send notification to employee email from `ZI_NXR_HR_TEAM_MEMBERS-EmployeeEmail`, fallback `PA0105` subtype `0010`.

## Activation steps in ADT

1. Open database table `ZTB_NXR_ATTMAIL`.
2. Replace the full source with `sap/ztb_nxr_attmail.tabl.asddl`.
3. Activate the table.
4. Create program `ZNXR_ATTREQ_MAIL_JOB` if it does not exist.
5. Replace the full source with `sap/znxr_attreq_mail_job.prog.abap`.
6. Activate the program.

Current S40 status after MCP deployment:

- `ZTB_NXR_ATTMAIL` has been activated and queried successfully.
- `ZNXR_ATTREQ_MAIL_JOB` has been updated and activated successfully.
- MCP report execution through debug WebSocket failed with HTTP 500, so runtime send/test should be executed from ADT Run, `SA38`, or `SE38`.

## Selection-screen labels

The report source uses `SELECTION-SCREEN COMMENT ... FOR FIELD ...` so the screen shows concrete labels without depending on text elements:

- `Test mode: preview only, do not send or update log`
- `Maximum request rows to scan`
- `Maximum send retries for ERROR log rows`
- `Event filter: ALL, SUBMITTED, APPROVED, REJECTED`

## Test and scheduling

1. Run `ZNXR_ATTREQ_MAIL_JOB` with `p_test = X` and `p_event = ALL`.
   - This previews the emails without inserting mail-log rows.
2. Confirm SAPconnect is configured in `SCOT` and sent/error mails in `SOST`.
3. Run with `p_test = space` to send.
4. Schedule the report in `SM36`, for example every 5 minutes, or after the attendance sync job.

The mail job intentionally does not block RAP create/approval actions. Failed sends are logged in `ZTB_NXR_ATTMAIL` as `ERROR` and retried up to `p_retry`.
