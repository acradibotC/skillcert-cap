# MyProfile SAP apply source activation order

Package: `ZPK_ZNXR09F300`

Transport tested with MCP: `S40K919620` / task `S40K919621`

## Source files

1. `ztb_nxr_profreq.tabl.asddl`
2. `zi_nxr_profile_apply_request.ddls.asddls`
3. `zc_nxr_profile_apply_request.ddls.asddls`
4. `zi_nxr_profile_apply_request.bdef.asbdef`
5. `zc_nxr_profile_apply_request.bdef.asbdef`
6. `zbp_nxr_i_profapply.clas.abap`
7. `zui_nxr_profile_apply_o4.srvd.srvdsrv`
8. `znxr_profile_apply_job.prog.abap`

## CAP runtime contract

CAP profile workflow uses SAP staging by default:

```env
PROFILE_APPLY_MODE=sap
PROFILE_APPLY_STRATEGY=create
PROFILE_APPLY_ENTITY_PATH=/ProfileApplyRequest
PROFILE_APPLY_UPDATE_METHOD=MERGE
PROFILE_APPLY_HTTP_CLIENT=auto
```

When the employee submits a MyProfile request, CAP creates a
`ProfileApplyRequest` row in the SAP OData service and sends these staging
fields directly:

- `Status = '01'`
- `ApplyState = 'PENDING_APPROVAL'`
- `ApplyMessage = 'SAP profile change request was staged and is waiting for HR approval.'`

When HR decides the MyProfile request, CAP reads the SAP row by `RequestNo` and
updates the same OData V2 row using `MERGE`. On approval it sends:

- `Status = '02'`
- `ApplyState = 'QUEUED'`
- `ApplyMessage = 'Queued for HR master data background job'`

Reject and revision-required decisions update the same row to `Status = '03'`
or `Status = '04'`.

The background report `ZNXR_PROFILE_APPLY_JOB` is intentionally safe by default
(`p_test = X`). Replace the marked posting block with the approved HR infotype
FM/BAPI calls, then schedule it for queued rows.

## Live status checked on 2026-08-06

The table, CDS views, BDEF pair, service definition, service binding object and
background report were created/activated through MCP in `S40K919620` /
`S40K919621`. The currently published binding `ZUI_NXR_PROF_APPLY_BND` is
`OData V2 - UI`; CAP is configured to call this V2 endpoint.

## Publish

After the service definition activates, create or publish a service binding for:

```text
ZUI_NXR_PROF_APPLY_BND
```

CAP default URL currently expects the published OData V2 binding:

```text
/sap/opu/odata/sap/ZUI_NXR_PROF_APPLY_BND
sap-client=324
```
