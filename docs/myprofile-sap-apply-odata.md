# MyProfile SAP apply OData contract

## Current boundary

The frontend and CAP workflow create and review `ProfileChangeRequests` locally.
Approval must not become `Approved` unless SAP accepts the approved change request
into the SAP-side staging table. The actual HR master-data update can then be
executed by a scheduled ABAP job that calls the required enterprise FM/BAPI per
infotype.

CAP now supports a fail-closed SAP staging adapter:

- default: `PROFILE_APPLY_MODE=disabled`
- SAP staging mode: `PROFILE_APPLY_MODE=sap`
- CAP remote service: `PROFILE_APPLY_SERVICE=ZUI_NXR_PROFILE_APPLY_O4`
- default strategy: `PROFILE_APPLY_STRATEGY=create`
- default entity path: `PROFILE_APPLY_ENTITY_PATH=/ProfileApplyRequest`
- optional legacy action path: `PROFILE_APPLY_ACTION_PATH`

HR approval users are resolved by SAP organization assignment:

- normal rule: authenticated user's `OrgUnitId` must be included in
  `HR_ORG_UNIT_IDS`
- optional override for testing/emergency access: `PROFILE_HR_EMAILS`

If the SAP service is unavailable, the action fails with a `SAP_PROFILE_WRITE_*`
error and the request stays `Pending`. If SAP accepts the staged row, CAP moves
the request to `Approved` and stores `ApplyState=QUEUED` unless SAP returns a
more specific `ApplyState`.

## Live SAP deployment status

Rechecked on S40/324 on 2026-08-06 with MCP users `DEV-271` / `DEV-269`.

- Package in scope: `ZPK_ZNXR09F300`
- Open transport: `S40K919620`
- Open task: `S40K919621`
- Existing read-only profile objects:
  - `ZI_NXR_HR_USER_PROFILE`
  - `ZC_NXR_HR_USER_PROFILE`
  - `ZCE_NXR_USER_PROFILE`
  - `ZCL_NXR_USER_PROFILE_QUERY`
- Live staging objects created and activated under task `S40K919621`:
  - `ZTB_NXR_PROFREQ`
  - `ZI_NXR_PROFILE_APPLY_REQUEST`
  - `ZC_NXR_PROFILE_APPLY_REQUEST`
  - `ZUI_NXR_PROFILE_APPLY_O4`
  - `ZUI_NXR_PROF_APPLY_BND`
  - `ZBP_NXR_I_PROFAPPLY`
  - `ZNXR_PROFILE_APPLY_JOB`

`ZUI_NXR_PROF_APPLY_BND` was created and the ADT publish helper returned:
`Local Service Endpoint of service ZUI_NXR_PROF_APPLY_BND with version 0001 is
activated locally`. However, a direct OData metadata check still returned
`/IWBEP/CM_V4_COS/014 Service group 'ZUI_NXR_PROF_APPLY_BND' not published`.
Open the service binding once in Eclipse ADT and publish/refresh the local
endpoint if this persists.

CAP default remote URL for this staging service:

```text
/sap/opu/odata4/sap/zui_nxr_prof_apply_bnd/srvd/sap/zui_nxr_profile_apply_o4/0001
```

Created shell objects that may need ADT cleanup if they remain visible:

- `ZA_NXR_PROFILE_APPLY_RESULT`
- `ZA_NXR_PROFAPPLY_RESULT`
- `ZA_NXR_PROFAPPLY_DECISION`

## Required SAP OData V4 staging entity

Expose a create-enabled OData V4 entity in service `ZUI_NXR_PROFILE_APPLY_O4`:

```text
ProfileApplyRequest(
  RequestNo,
  Pernr,
  EmployeeName,
  RequestedByEmail,
  RevisionNo,
  DecisionBy,
  DecisionByEmail,
  DecisionPernr,
  HrComment,
  ChangedFields,
  IdNumber,
  Telephone,
  PermanentAddress,
  WorkEmail,
  CurrentAddress,
  TaxCode,
  PayMethod,
  BankCountry,
  BankKey,
  BankAccount
)
```

Default CAP call:

```js
sapApply.send({
  method: "POST",
  path: "/ProfileApplyRequest",
  data: stagingPayload
})
```

If the published RAP service uses a different entity set path, set:

```env
PROFILE_APPLY_ENTITY_PATH=/ProfileApplyRequest
```

The previous unbound action adapter is still available by setting
`PROFILE_APPLY_STRATEGY=action`, or by setting a concrete
`PROFILE_APPLY_ACTION_PATH`.

## Payload

```json
{
  "RequestNo": "PR...",
  "Pernr": "90000005",
  "EmployeeName": "Ta Nam Son",
  "RequestedByEmail": "haonguyen022202@gmail.com",
  "RevisionNo": 1,
  "Status": "02",
  "ApplyState": "QUEUED",
  "ApplyMessage": "Queued for HR master data background job",
  "DecisionBy": "HR Approver",
  "DecisionByEmail": "hr@example.com",
  "DecisionPernr": "90000099",
  "DecisionAt": "2026-08-06T03:30:00.000Z",
  "HrComment": "Approved",
  "ChangedFields": "WORK_EMAIL",
  "WorkEmail": "new@example.com"
}
```

## Expected result

```json
{
  "Applied": true,
  "ApplyState": "QUEUED",
  "Message": "SAP profile change request was staged for background processing.",
  "RequestId": "optional SAP-side trace id"
}
```

When `Applied` is false or the create/action returns an HTTP error, CAP keeps the
request in status `01` (`Pending`) and does not release locks.

## SAP implementation notes

The RAP implementation should:

1. Validate the acting HR user and employee `Pernr`.
2. Persist the approved request payload into `ZTB_NXR_PROFREQ` with
   `Status='02'` and `ApplyState='QUEUED'`.
3. Schedule/run an ABAP background job to select queued rows, lock the employee,
   map fields, and post HR master data by the approved enterprise API/BAPI for
   the infotype:
   - `0006` address fields
   - `0009` bank/payment fields
   - `0105` communication fields
   - `0185` identification fields
4. Update `ApplyState` to `APPLIED` or `FAILED` after the job finishes and write
   `ApplyMessage` with a business-readable result.
5. Return an HTTP error or `Applied=false` from the staging service when the row
   cannot be safely persisted.
