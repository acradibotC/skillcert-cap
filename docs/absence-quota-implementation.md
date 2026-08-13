# Annual Leave quota implementation

## Scope

- Personal Timesheet view only.
- Annual Leave only.
- Sample employee: `PERNR 90000007`.
- Current SAP sample: `PA2006-SUBTY/KTART = 01`, `ANZHL = 12.00`,
  `KVERB = 0.00`, validity `20260101` to `20261231` on S40/324, checked
  2026-08-13.

## Reuse strategy

The existing `ZUI_NXR_WORKSCHEDULE_O4` / `CalendarService` contract is reused.
The daily `WorkSchedule` entity carries the Annual Leave quota fields so no
new CAP service or local quota persistence is introduced:

- `QuotaType`
- `QuotaName`
- `QuotaEntitlement`
- `QuotaUsed`
- `QuotaRemaining`
- `QuotaUnit`
- `QuotaValidFrom`
- `QuotaValidTo`

The backend source artifact is in
`sap/zce_nxr_work_schedule.ddls.asddl` and
`sap/zcl_nxr_workschedule_query.clas.abap`.

## Calculation contract

`Requested Leave` counts approved `DAYOFF` requests in the selected month.
For this first scope, `DAYOFF` represents Annual Leave.

`Unrequested Leave` is expressed in day units and includes both full-day
absence and unapproved missing working time. For each scheduled workday:

1. the date is not later than the server/browser current date;
2. the day is not `OFF`, `FREE`, `REST`, holiday, or a non-working shift;
3. there is no leave status; and
4. the date is not covered by an approved `DAYOFF` request.

When `AttendanceStatus = 3`, the day contributes `1.000`. When
`AttendanceStatus = 2` (late/early leave), the day contributes
`missing_minutes / scheduled_shift_minutes`, capped at `1.000`. Other
attendance statuses contribute `0.000`.

Future dates are never included in `Unrequested Leave`.

## Live SAP status

- `ZCE_NXR_WORK_SCHEDULE` was updated and activated on S40/324 in the existing
  work calendar transport task `S40K918683`.
- Live `$metadata` now exposes the quota fields.
- The existing `ZCL_NXR_WORKSCHEDULE_QUERY` is read-only through the current
  connector (`modificationSupport="NoModification"`), so it was not changed.
- A new class creation attempt left an empty temporary class
  `ZCL_NXR_WSCH_QUOTA_QUERY` locked in generated request `S40K919723` / task
  `S40K919724`. It is not referenced by the DDLS and must be cleaned up in
  ADT/SM12 before retrying the class implementation.
- Runtime read of `WorkSchedule` for `90000007` confirms the new fields are
  present but currently zero/blank because the old query class does not fill
  them yet.

Replay `sap/zcl_nxr_workschedule_query.clas.abap` in Eclipse ADT (or resolve
the temporary class lock and use the new class) before treating the feature as
live-ready.

## Verification after live activation

For `90000007` and period `2026-08-01` through `2026-08-31`:

1. Read `WorkSchedule` and verify the quota fields are present.
2. Compare entitlement/used/remaining with PA30/PA2006.
3. Compare attendance dates with PA2002 and leave status with PA2001.
4. Verify `Unrequested Leave` excludes dates after `2026-08-13`.
5. Verify an approved `DAYOFF` date is excluded from `Unrequested Leave`.
