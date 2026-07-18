# Thiết kế nội bộ tiếng Việt — ATT-DASH-20260718

Status: APPROVED_FOR_IMPLEMENTATION

## Scope and requirements

- REQ-001: Filter dashboard by inclusive period.
- REQ-002: Aggregate planned and actual hours after break deduction.
- REQ-003: Manager sees direct team; HR sees organization-wide data.
- REQ-004: Provide employee summary export as XLSX and PDF.

## Data/interface flow

`SAPUI5 -> CAP /api/v6 -> S40 ZUI_NXR_ATTDASH_O4 -> daily dashboard snapshot`.

## Objects and responsibilities

- `ZTB_NXR_ATT_DASH_D`: daily fact snapshot.
- `ZCL_NXR_ATT_DASH_REFRESH`: recomputes a rolling seven-day window.
- `ZCE_NXR_ATT_DASH_*`: read-only KPI, organization, employee and value-help entities.
- `ZCL_NXR_ATT_DASH_QUERY`: RAP query provider.
- CAP derives user scope from session before issuing S40 queries.

## Input, output, validation, and error behavior

Period is mandatory and max 31 days for live refresh. Invalid scope returns HTTP 403; empty selection returns an empty aggregate, never another employee's data.

## Authorization and logging

S40 derives direct reports from OM. CAP does not trust client-supplied PERNR. Export writes actor, filters and row count to the application log.

## Compatibility and recovery

Existing work-schedule API is untouched. Snapshot refresh is idempotent for key `Pernr, WorkDate`; a failed run can safely rerun the rolling window.

## Test strategy

Test employee, manager, HR and denied scopes; full/partial/absent/leave records; break calculation; empty periods; pagination and both export formats.
