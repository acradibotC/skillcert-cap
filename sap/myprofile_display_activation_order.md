# MyProfile SAP display source activation order

Package: `ZPK_ZNXR09F300`

## Purpose

This display service separates MyProfile read-only SAP master-data retrieval from
the skill request workflow service. CAP now reads `ZUI_NXR_PROFILE_O4.UserProfile`
first and falls back to `ZUI_NXR_SKILLREQ_O4.UserProfile` only while this service
is not active/published yet.

## Source files

1. `zi_nxr_profile_display.ddls.asddls`
2. `zc_nxr_profile_display.ddls.asddls`
3. `zui_nxr_profile_o4.srvd.srvdsrv`

## Live S40 status

Created/activated through MCP on transport `S40K919412`:

- `DDLS ZI_NXR_PROFILE_DISPLAY`
- `DDLS ZC_NXR_PROFILE_DISPLAY`
- `SRVD ZUI_NXR_PROFILE_O4`
- `SRVB ZUI_NXR_PROFILE_O4_BIND`

After publishing the binding, `$metadata` initially failed with
`SADL_GW_V4_MODEL/003` because `PA0002-GBDAT` exposed conversion exit `PDATE`.
`DateOfBirth` and `JoinDate` are therefore exposed as plain `char(8)` in SAP
OData and normalized by CAP to ISO dates for the `ProfileService.MyProfile`
contract.

Post-fix HTTP verification:

- `$metadata`: HTTP `200`, entity `UserProfile` present.
- `UserProfile?$filter=Pernr eq '90000005'`: HTTP `200`.

## Publish

After the service definition activates, create or publish a service binding for:

```text
ZUI_NXR_PROFILE_O4
```

CAP default URL currently expects:

```text
/sap/opu/odata4/sap/zui_nxr_profile_o4_bind/srvd/sap/zui_nxr_profile_o4/0001
```

## Known data boundary for employee 90000005

Live CDS preview of `ZC_NXR_PROFILE_DISPLAY` confirmed employee `90000005`
returns `DateOfBirth=20040926`, `Gender=Male`, `Nationality=VN`,
`MaritalStatus=Single`, `PositionName=Chief Financial Officer`,
`OrgUnitName=Accounting Finance Dept`, and `WorkEmail=HAONGUYEN022202@GMAIL.COM`.

PA0006, PA0009 and PA0185 had no active rows for this employee at that time, so
address, payment/bank and ID card fields can still display blank until SAP HR
master data/mapping is maintained. `TaxCode` is currently exposed as a blank
contract field because the FS/domain has no confirmed SAP infotype/field mapping.
