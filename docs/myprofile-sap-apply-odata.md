# MyProfile SAP apply OData contract

## Current boundary

The frontend and CAP workflow create and review `ProfileChangeRequests` locally.
Approval must not become `Approved` unless SAP confirms the HR master-data write.

CAP now supports a fail-closed SAP apply adapter:

- default: `PROFILE_APPLY_MODE=disabled`
- SAP write mode: `PROFILE_APPLY_MODE=sap`
- CAP remote service: `PROFILE_APPLY_SERVICE=ZUI_NXR_PROFILE_APPLY_O4`
- optional custom path: `PROFILE_APPLY_ACTION_PATH`

If the SAP service is unavailable, the action fails with a `SAP_PROFILE_WRITE_*`
error and the request stays `Pending`.

## Live SAP deployment status

Checked on S40/324 with MCP user `DEV-269`.

- Package in scope: `ZPK_ZNXR09F300`
- Open transport used for create test: `S40K919412`
- Existing read-only profile objects:
  - `ZI_NXR_HR_USER_PROFILE`
  - `ZC_NXR_HR_USER_PROFILE`
  - `ZCE_NXR_USER_PROFILE`
  - `ZCL_NXR_USER_PROFILE_QUERY`
- Missing live write objects at the time of implementation:
  - `ZUI_NXR_PROFILE_APPLY*`
  - `ZTB_PROFILE*`

MCP live DDLS create currently creates an empty shell, but `UPDATE_SOURCE`
fails with `ExceptionResourceInvalidLockHandle` even after an explicit lock.
Transportable source files are therefore stored under `sap/` for ADT import
and activation.

Created shell objects that may need ADT cleanup if they remain visible:

- `ZA_NXR_PROFILE_APPLY_RESULT`
- `ZA_NXR_PROFAPPLY_RESULT`
- `ZA_NXR_PROFAPPLY_DECISION`

## Required SAP OData V4 action

Expose an unbound OData V4 action in service `ZUI_NXR_PROFILE_APPLY_O4`:

```text
applyProfileChanges(
  RequestId,
  RequestNo,
  Pernr,
  EmployeeName,
  RequestedByEmail,
  RevisionNo,
  DecisionBy,
  DecisionByEmail,
  DecisionPernr,
  HrComment,
  Changes[]
) returns ProfileApplyResult
```

Default CAP action call:

```js
sapApply.send({
  event: "applyProfileChanges",
  data: payload
})
```

If the published RAP action requires a fully qualified OData path, set:

```env
PROFILE_APPLY_ACTION_PATH=/com.sap.gateway.srvd.zui_nxr_profile_apply_o4.v0001.applyProfileChanges
```

## Payload

```json
{
  "RequestId": "uuid",
  "RequestNo": "PR...",
  "Pernr": "90000005",
  "EmployeeName": "Ta Nam Son",
  "RequestedByEmail": "haonguyen022202@gmail.com",
  "RevisionNo": 1,
  "DecisionBy": "HR Approver",
  "DecisionByEmail": "hr@example.com",
  "DecisionPernr": "90000099",
  "HrComment": "Approved",
  "Changes": [
    {
      "FieldCode": "WORK_EMAIL",
      "FieldGroup": "CONTACT",
      "OldValue": "old@example.com",
      "NewValue": "new@example.com",
      "SapInfotype": "0105",
      "SapSubtype": "0010",
      "SapField": "USRID_LONG",
      "IsSensitive": false
    }
  ]
}
```

## Expected result

```json
{
  "Applied": true,
  "Message": "SAP profile changes were applied.",
  "SapRequestId": "optional SAP-side trace id"
}
```

When `Applied` is false or the action returns an HTTP error, CAP keeps the
request in status `01` (`Pending`) and does not release locks.

## SAP implementation notes

The RAP implementation should:

1. Validate the acting HR user and employee `Pernr`.
2. Persist the submitted request/change payload into the SAP audit table
   planned for MyProfile, for example `ZTB_PROFILE_REQ` and item/history tables.
3. Map fields by `FieldCode` / `SapInfotype` / `SapSubtype` / `SapField`.
4. Write HR master data by the approved enterprise API/BAPI for the infotype:
   - `0006` address fields
   - `0009` bank/payment fields
   - `0105` communication fields
   - `0185` identification fields
5. Return `Applied=false` with a business message when any field cannot be
   safely posted.

Do not return success after only staging the request. If SAP chooses a deferred
posting job, return `Applied=false` or a separate state until the job confirms
the HR master data update.
