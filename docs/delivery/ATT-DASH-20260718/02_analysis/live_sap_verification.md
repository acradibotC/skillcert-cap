# Live SAP verification — ATT-DASH-20260718

Status: PARTIAL_LIVE_VERIFIED

## Route/system

- MCP server: `mcp__s40_324`
- SAP system/client: `S40` / `324`
- MCP user: `DEV-268`
- URL: `https://s40lp1.ucc.cit.tum.de`

## Objects checked

- Transport request `S40K919174`
- Development task `S40K919175`
- Existing package objects `ZCE_NXR_WORK_SCHEDULE`, `ZCE_NXR_SUBORDINATE`, `ZSD_NXR_WORKSCHEDULE`, `ZUI_NXR_WORKSCHEDULE_O4`
- Attempted dashboard objects `ZCE_NXR_ATT_DASH_KPI`, `ZCL_NXR_ATT_DASH_QUERY`

## Results

- `S40K919174` is the most recent modifiable workbench request returned by `list_transports` for the current S40 MCP context.
- Request owner: `DEV-268`
- Description: `Create Capstone package`
- Status: `D` / `Modifiable`
- Target: `DMY`
- Changed at: `20260709050516`
- Task `S40K919175` is also `D` / `Modifiable`.
- Existing objects in the task are package/program objects unrelated to the attendance dashboard, so usage for dashboard work should be intentional and traceable.
- `ZCE_NXR_WORK_SCHEDULE` already exposes the fields required for FE dashboard aggregation: `Pernr`, `WorkDate`, scheduled/actual times, `AttendanceStatus`, employee and department names.
- Creating the `ZCE_NXR_ATT_DASH_KPI` shell with transport `S40K919174` succeeded, but subsequent source update/activation was blocked by ADT lock handling.
- Creating/editing ABAP query classes is currently blocked for this package via MCP/ADT with `modificationSupport="NoModification"`.

## CAP fallback implemented

- Until the dedicated S40 dashboard RAP service is editable and transportable, `/api/v6/dashboard` now reads SAP OData service `ZUI_NXR_WORKSCHEDULE_O4/WorkSchedule`.
- Manager scope resolves direct team members via `ZUI_NXR_SKILLREQ_O4/TeamMembers`; employee scope uses the authenticated Pernr from the SAP-validated session.
- CAP aggregates period KPI, org-unit bars and employee rows server-side, preserving the current FE contract and the 1-31 day period guard.

## Local-only items requiring verification

- Dashboard table, refresh class, CDS, service definition, and service binding still need live creation/activation.
- `DASHBOARD_API_URL` still needs to be set after the S40 OData V4 dashboard service exists; until then CAP fallback is the production route.
