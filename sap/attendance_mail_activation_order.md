# Attendance Request Mail Notification Activation

Transports used during MCP setup:

- `S40K919620` owned by `DEV-269`: `ZTB_NXR_ATTMAIL`.
- `S40K919622` owned by `DEV-269`: `ZNXR_ATTREQ_MAIL_JOB`.

## Objects

1. Table `ZTB_NXR_ATTMAIL`
   - Package: `ZPK_ZNXR09F410`
   - Source: `sap/ztb_nxr_attmail.tabl.asddl`
   - Purpose: durable idempotency log for sent or failed attendance workflow emails.

2. Behavior implementation `ZBP_I_NXR_ATTREQ`
   - Package: `ZPK_ZNXR09F410`
   - Sources: `sap/zi_nxr_attreq.bdef.asbdef`, `sap/zbp_i_nxr_attreq.clas.locals_def.abap`, `sap/zbp_i_nxr_attreq.clas.locals_imp.abap`
   - Purpose: trigger `SUBMITTED`, `APPROVED`, and `REJECTED` notifications directly from the RAP workflow.

3. Program `ZNXR_ATTREQ_MAIL_JOB` (legacy recovery tool)
   - Package: `ZPK_ZNXR09F410`
   - Source: `sap/znxr_attreq_mail_job.prog.abap`
   - Purpose: manually retry or recover mail rows in `ERROR/NEW`; it is not required for normal notification delivery.

## Business events

- `SUBMITTED`: request status `01`; send notification to the manager/approver email in `ZTB_NXR_ATTREQ-APPROVER_ID`.
- `APPROVED`: request status `02`; send notification to employee email from `ZI_NXR_HR_TEAM_MEMBERS-EmployeeEmail`, fallback `PA0105` subtype `0010`.
- `REJECTED`: request status `03`; send notification to employee email from `ZI_NXR_HR_TEAM_MEMBERS-EmployeeEmail`, fallback `PA0105` subtype `0010`.

## Activation steps in ADT

1. Open database table `ZTB_NXR_ATTMAIL`.
2. Replace the full source with `sap/ztb_nxr_attmail.tabl.asddl`.
3. Activate the table.
4. Update the behavior definition `ZI_NXR_ATTREQ` with the direct notification determination.
5. Update the local handler definition and implementation of `ZBP_I_NXR_ATTREQ`.
6. Activate the behavior definition and behavior pool.
7. Keep `ZNXR_ATTREQ_MAIL_JOB` available as an operational recovery utility.

Current S40 status after MCP deployment:

- `ZTB_NXR_ATTMAIL` has been activated and queried successfully.
- The direct-trigger handler must be activated before runtime testing.
- `ZNXR_ATTREQ_MAIL_JOB` remains available for manual recovery; no schedule is required for the normal path.

## Selection-screen labels

The report source uses `SELECTION-SCREEN COMMENT ... FOR FIELD ...` so the screen shows concrete labels without depending on text elements:

- `Test mode: preview only, do not send or update log`
- `Maximum request rows to scan`
- `Maximum send retries for ERROR log rows`
- `Event filter: ALL, SUBMITTED, APPROVED, REJECTED`

## Test

1. Confirm SAPconnect is configured in `SCOT`.
2. Submit a request and verify `SUBMITTED` in `ZTB_NXR_ATTMAIL` and `SOST`.
3. Approve the request and verify `APPROVED` in `ZTB_NXR_ATTMAIL` and `SOST`.
4. Reject a separate request and verify `REJECTED` in `ZTB_NXR_ATTMAIL` and `SOST`.
5. If a send fails, verify `MAIL_STATUS = 'ERROR'` and use `ZNXR_ATTREQ_MAIL_JOB` manually for recovery.

The direct trigger intentionally catches mail errors, records `ERROR` in `ZTB_NXR_ATTMAIL`, and does not roll back the attendance request transaction.
