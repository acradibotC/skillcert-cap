# Change log — ATT-DASH-20260718

| Timestamp | Object/file | Change | REQ/DES IDs | Verification |
|---|---|---|---|---|
| 2026-07-18 | `app/timesheet/webapp/view/Dashboard.view.xml` | Added dashboard filters, KPIs, chart, rates and employee table | REQ-001..004 | UT-001 |
| 2026-07-18 | `app/timesheet/webapp/controller/Dashboard.controller.js` | Added dashboard request and export interactions | REQ-001, REQ-004 | UT-001 |
| 2026-07-18 | `srv/server.js` | Added scope-protected `/api/v6/dashboard` BFF contract | REQ-001, REQ-003 | UT-001, UT-002 |
| 2026-07-18 | S40 `ZTB_NXR_ATT_DASH_D` | Creation blocked: ADT requires `corrNr` | REQ-001..003 | UT-004 |
| 2026-07-18 | S40 `$TMP` | Created local table `ZTB_NXR_ADSH_D`; ADT auto-added client and source editing remains blocked | REQ-001..003 | EV-003 |
| 2026-07-18 | S40 `$TMP` | Created class shell `ZCL_NXR_ADSH_REFRESH`; S40 rejects lock/source activation | REQ-001..003 | EV-003 |
| 2026-07-20 | S40 transport `S40K919174` | Selected latest modifiable MCP S40 user transport as dashboard `corrNr` candidate; task `S40K919175` is modifiable | REQ-001..004 | Live MCP `get_transport` |
| 2026-07-20 | `srv/server.js` | Implemented SAP WorkSchedule-backed dashboard fallback when `DASHBOARD_API_URL` is not configured | REQ-001..004 | `npm test`, `node --check srv/server.js` |
| 2026-07-20 | `test/profile/dashboard-bff.test.js` | Added regression guard that dashboard BFF must read SAP WorkSchedule/TeamMembers and keep the 1-31 day period validation | REQ-001, REQ-003 | `npm test` |
