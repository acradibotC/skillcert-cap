# Intake — ATT-DASH-20260718

Status: APPROVED_FOR_IMPLEMENTATION
Workflow: new-development

## Objective

Deliver a Manager Attendance Dashboard in the existing Timesheet application. Managers see direct team data; HR sees organization-wide data.

## Inputs and source references

- User dashboard sketch: `1-Anh-1.jpg`.
- User-approved scope recorded in `docs/attendance-dashboard-request.md`.
- Live S40: `ZCE_NXR_WORK_SCHEDULE`, `ZCL_NXR_WORKSCHEDULE_QUERY`, `ZCE_NXR_SUBORDINATE`, `ZCL_NXR_SUBORDINATE_QUERY`.

## Deadline, package, transport, and environment

- Environment: S40 development system and CAP workspace.
- Package: `ZPK_ZNXR09F200` (live verified).
- Transport: assigned by the SAP change tool during object creation; no production release is in scope.

## Required deliverables

- S40 daily snapshot, read-only dashboard API and refresh report.
- CAP scope-protected dashboard API plus Excel/PDF export.
- SAPUI5 filters, KPI cards, charts and employee table.

## Out of scope / explicitly not required

- Cost Center filter.
- Production deployment or transport release.

## Constraints and acceptance criteria

- Filter period is supported.
- Planned and actual hours deduct applicable break.
- Manager scope is direct team; HR scope is all organization.
- Existing `ZUI_NXR_WORKSCHEDULE_O4` remains compatible.

## Facts

- `ZCL_NXR_WORKSCHEDULE_QUERY` currently serves one employee and derives planned/actual times from HR work schedule and PA2002.
- `ZCL_NXR_SUBORDINATE_QUERY` resolves direct reports from OM relationship A012/B003.

## Assumptions

- Break minutes come from the standard daily work schedule; an exception mapping is deferred until data proves it necessary.

## Contradictions

- Local UI comment reported `WorkDate` filter error 501, while live source parses the filter. Integration smoke test resolves this.

## Open QA

- No implementation-blocking QA. The Break source is validated during S40 integration.

## G1 recommendation

G1 approved in user chat by the request to implement after accepting the plan.
