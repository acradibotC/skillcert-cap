# Attendance Dashboard Implementation Request

## Approved scope

- Build a Manager Attendance Dashboard for the existing Timesheet app.
- Managers can view direct team members only. HR can view the full organization.
- Filter period is supported by the live S40 work-schedule service.
- Cost Center is excluded from the first release.
- Planned and actual work hours deduct the applicable break.
- Deliver employee-summary exports as Excel and PDF.

## Design baseline

- S40 maintains daily attendance dashboard facts and exposes read-only OData V4 dashboard entities.
- CAP validates session-derived data scope before invoking S40 and records exports.
- SAPUI5 renders filters, KPI cards, charts, employee table, and export actions.
- The existing `ZUI_NXR_WORKSCHEDULE_O4` contract remains backward compatible.

## Source references

- User-approved dashboard sketch: `1-Ảnh-1.jpg`.
- Live S40 objects: `ZCE_NXR_WORK_SCHEDULE`, `ZCL_NXR_WORKSCHEDULE_QUERY`, package `ZPK_ZNXR09F200`.
