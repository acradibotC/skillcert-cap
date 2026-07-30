# MyProfile SAP apply source activation order

Package: `ZPK_ZNXR09F300`

Transport tested with MCP: `S40K919412`

## Source files

1. `ztb_nxr_profreq.tabl.asddl`
2. `za_nxr_profapply_decision.ddls.asddls`
3. `za_nxr_profapply_result.ddls.asddls`
4. `zi_nxr_profile_apply_request.ddls.asddls`
5. `zc_nxr_profile_apply_request.ddls.asddls`
6. `zi_nxr_profile_apply_request.bdef.asbdef`
7. `zc_nxr_profile_apply_request.bdef.asbdef`
8. `zui_nxr_profile_apply_o4.srvd.srvdsrv`

## MCP blocker

MCP can create DDLS shell objects with `transport`, but source update currently
fails with:

```text
ExceptionResourceInvalidLockHandle
Resource Data Definition <object> is not locked
```

Use Eclipse ADT to paste the source above and activate if MCP continues to fail.

## Publish

After the service definition activates, create or publish a service binding for:

```text
ZUI_NXR_PROFILE_APPLY_O4
```

CAP default URL currently expects:

```text
/sap/opu/odata4/sap/zui_nxr_profile_apply_o4_bind/srvd/sap/zui_nxr_profile_apply_o4/0001
```
