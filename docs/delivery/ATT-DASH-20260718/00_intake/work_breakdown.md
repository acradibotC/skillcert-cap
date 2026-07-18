# Work Breakdown & Delivery Plan — ATT-DASH-20260718

Plan version: 1.0
Plan status: BASELINED_AT_G2
Estimate assumption: 1 MD = 8 hours unless project rules specify otherwise

## Manager summary

- Scope understood: S40 dashboard snapshot/API, CAP BFF/export, SAPUI5 dashboard; manager direct-team and HR organization scope.
- Scope being confirmed: standard break source in each daily work schedule.
- Total estimate range: 10-13 MD.
- Critical path: SAP transport -> S40 table/API -> CAP destination -> integration test.
- Blocking QA/environment: S40 change transport `corrNr` is required to create dashboard objects.
- Next milestone/update: create and activate S40 objects once transport is supplied.

## Work breakdown

| WBS ID | Phase | Deliverable / task | Completion criteria | Linked IDs / source | Dependency | Owner | Reviewer | Estimate MD | Remaining MD | Start | End | Status | Confidence | Blocking QA | Risk / notes |
|---|---|---|---|---|---|---|---|---:|---:|---|---|---|---|---|---|
| WBS-001 | Requirement | Baseline accepted scope | Decisions recorded | REQ-001..004 | User approval | Agent | User | 0.5 | 0 | 2026-07-18 | 2026-07-18 | DONE | High | | |
| WBS-002 | S40 | Create daily snapshot table and refresh logic | Activated `ZTB_NXR_ATT_DASH_D` and refresh report | REQ-001, REQ-002 | Transport | Agent | User | 2.0 | 2.0 | 2026-07-18 | TBD | BLOCKED | High | QA-002 | `corrNr` missing |
| WBS-003 | S40 | Create read-only dashboard RAP API | KPI, org and employee entities exposed | REQ-001..003 | WBS-002 | Agent | User | 2.0 | 2.0 | TBD | TBD | BLOCKED | High | | Transport required |
| WBS-004 | CAP | Implement scope BFF | Session scope and 31-day validation | REQ-001, REQ-003 | WBS-003 | Agent | User | 1.0 | 0.5 | 2026-07-18 | TBD | IN_PROGRESS | High | | S40 URL pending |
| WBS-005 | UI5 | Implement dashboard UI | Filters, KPI, chart, table, exports | REQ-001, REQ-004 | WBS-004 | Agent | User | 1.5 | 0.25 | 2026-07-18 | TBD | IN_PROGRESS | High | | Backend data pending |
| WBS-006 | Test | Integration, auth and export test | Evidence captured | REQ-001..004 | WBS-002..005 | Agent | User | 1.0 | 1.0 | TBD | TBD | NOT_STARTED | Medium | | |

## Milestones

| Milestone | Target | Entry criteria | Exit criteria | Status |
|---|---|---|---|---|
| G1 requirement approval | 2026-07-18 | User decisions recorded | Scope approved | APPROVED |
| G2 design/plan baseline | 2026-07-18 | Live source read and plan approved | Implementation authorized | APPROVED |
| G3 result approval | TBD | Tests and evidence complete | User accepts result | NOT_STARTED |

## Revision log

| Version | Timestamp | Changed by | Estimate before | Estimate after | Reason / changed scope |
|---|---|---|---:|---:|---|
| 0.1 | 2026-07-18 | Agent | - | 10-13 | Initial breakdown |
| 1.0 | 2026-07-18 | Agent | 10-13 | 10-13 | User approved scope and implementation |
