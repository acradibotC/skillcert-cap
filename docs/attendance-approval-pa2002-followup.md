# Attendance Approval PA2002 Follow-up

## Context

Muc tieu nghiep vu la khi quan ly approve don `EDIT_TIMESHEET`, du lieu cham cong phai duoc ghi that vao PA30/PA2002 subtype `0800`. UI `My Attendance` chi nen hien thi theo source of truth tu WorkSchedule/PA2002, khong hien thi du lieu gia lap tu request table.

## Da xac minh

- Request ngay `2026-06-09` cua PERNR `90000007` ton tai trong `ZI_NXR_ATTREQ`.
- Request do co:
  - `RequestType = EDIT_TIMESHEET`
  - `Status = 02`
  - `CorrectedStartTime = 080000`
  - `CorrectedEndTime = 173000`
  - `SapPostStatus = SUCCESS`
  - `SapPostMessage = Approved and posted successfully.`
- PA2002 thang 06/2026 cua PERNR `90000007` chi co cac ngay:
  - `2026-06-16`
  - `2026-06-17`
  - `2026-06-22`
- Khong co record PA2002 cho `2026-06-09`, nen PA30 khong hien thi ngay nay la dung theo du lieu HR that.

## Nguyen nhan

- UI da co luc hien `2026-06-09` la `Full Attendance` vi dang overlay du lieu request da approved len bang Attendance.
- Overlay nay chi lay `CorrectedStartTime/CorrectedEndTime` tu `ZI_NXR_ATTREQ`, khong phai du lieu that trong PA2002.
- Backend CAP truoc do co fallback nguy hiem trong `srv/service.js`: neu RAP action `Approve` loi thi van `PATCH { Status: '02' }`.
- Fallback nay tao trang thai approved gia: request co the thanh `Status=02` nhung PA2002 khong duoc insert/update.
- SAP behavior pool `ZBP_I_NXR_ATTREQ` hien tai dang trong, chua co implementation that su de goi `HR_INFOTYPE_OPERATION` ghi PA2002.

## Da thuc hien trong workspace

- Da restore `app/timesheet/webapp/controller/App.controller.js` ve ban sach tren `main`, go bo thay doi overlay UI chua commit.
- Da sua `srv/service.js` de bo fallback approve gia:
  - Neu action SAP `Approve` loi, CAP tra loi that ve UI.
  - Khong con tu dong `PATCH Status = '02'` khi posting SAP that that bai.
- Da unlock SAP object `/sap/bc/adt/oo/classes/zbp_i_nxr_attreq` sau khi luot thao tac bi ngat.

## Trang thai hien tai

- Git workspace hien co 1 file modified:
  - `srv/service.js`
- Chua commit/push thay doi moi.
- Chua deploy duoc SAP behavior implementation vao `ZBP_I_NXR_ATTREQ`.

## SAP object da doc

- `TABL ZTB_NXR_ATTREQ`
  - Staging table cho request.
  - Co cac field `status`, `sap_post_status`, `sap_post_message`, corrected time.
- `DDLS ZI_NXR_ATTREQ`
  - Interface view doc tu `ztb_nxr_attreq`.
- `DDLS ZC_NXR_ATTREQ`
  - Projection view cho OData/RAP.
- `BDEF ZI_NXR_ATTREQ`
  - Managed behavior tren `ztb_nxr_attreq`.
  - Co action `Approve` va `Reject`.
- `BDEF ZC_NXR_ATTREQ`
  - Projection expose action `Approve` va `Reject`.
- `CLAS ZBP_I_NXR_ATTREQ`
  - Behavior implementation hien trong.
- `FUNC HR_INFOTYPE_OPERATION`
  - Function module nam trong function group `HRMM`.
  - Signature can dung de insert/update PA2002.

## Viec can lam tiep

1. Implement SAP RAP action `Approve` that su trong behavior pool `ZBP_I_NXR_ATTREQ`.
2. Logic cho `EDIT_TIMESHEET`:
   - Doc request theo key action.
   - Validate `Pernr`, `StartDate`, `CorrectedStartTime`, `CorrectedEndTime`.
   - Tao/cap nhat PA2002 subtype `0800`.
   - `BEGDA = StartDate`, `ENDDA = StartDate`.
   - `BEGUZ = CorrectedStartTime`, `ENDUZ = CorrectedEndTime`.
   - `STDAZ` tinh tu khoang gio corrected, tru break neu can theo quy uoc hien tai.
3. Neu PA2002 da co record cung PERNR/subtype/ngay:
   - Cap nhat record hien co, tranh tao duplicate.
4. Neu PA2002 chua co:
   - Insert record moi bang `HR_INFOTYPE_OPERATION`.
5. Chi khi PA2002 insert/update thanh cong:
   - Set `ztb_nxr_attreq-status = '02'`.
   - Set `sap_post_status = 'SUCCESS'`.
   - Set `sap_post_message` thanh thong diep thanh cong that.
6. Neu posting PA2002 loi:
   - Khong doi `Status` sang `02`.
   - Set `sap_post_status = 'ERROR'`.
   - Set `sap_post_message` tu `BAPIRETURN1-MESSAGE`.
   - Tra error ve CAP/UI.
7. Refresh service binding neu metadata/action can publish lai.
8. Chay test:
   - Approve request moi cho ngay chua co PA2002.
   - Kiem tra PA2002/PA30 co record subtype `0800`.
   - Kiem tra `ZI_NXR_ATTREQ` chi approved khi PA2002 da ghi thanh cong.
   - Test update record PA2002 da ton tai.
   - Test loi posting khong approved gia.

## Blocker/luu y MCP SAP

- MCP high-level `edit CLAS ZBP_I_NXR_ATTREQ` chi sua main class include, khong cho khai bao local handler class trong main include.
- Local RAP handler can duoc dat vao local class includes:
  - `/sap/bc/adt/oo/classes/zbp_i_nxr_attreq/includes/definitions`
  - `/sap/bc/adt/oo/classes/zbp_i_nxr_attreq/includes/implementations`
- Thu `UPDATE_SOURCE` voi include URL tren bi loi `No suitable resource found`.
- Can dung dung co che ADT/MCP de edit class local includes, hoac thao tac truc tiep trong Eclipse ADT neu MCP tiep tuc khong support.

## Draft ABAP huong trien khai

Can tao local handler class `lhc_AttendanceRequest` ke thua `cl_abap_behavior_handler`, implement method:

```abap
METHODS Approve FOR MODIFY
  IMPORTING keys FOR ACTION AttendanceRequest~Approve RESULT result.
```

Trong action:

```abap
READ ENTITIES OF zi_nxr_attreq IN LOCAL MODE
  ENTITY AttendanceRequest
  ALL FIELDS WITH CORRESPONDING #( keys )
  RESULT DATA(lt_requests).
```

Posting PA2002 dung `HR_INFOTYPE_OPERATION`:

```abap
CALL FUNCTION 'HR_INFOTYPE_OPERATION'
  EXPORTING
    infty         = '2002'
    number        = lv_pernr
    subtype       = '0800'
    validitybegin = lv_date
    validityend   = lv_date
    record        = ls_p2002
    operation     = lv_operation
    tclas         = 'A'
    dialog_mode   = '0'
    nocommit      = abap_true
  IMPORTING
    return        = ls_return
    key           = ls_key.
```

Sau khi success, update request bang `MODIFY ENTITIES OF zi_nxr_attreq IN LOCAL MODE`.

## Acceptance criteria

- Sau approve `EDIT_TIMESHEET`, PA30 hien record ngay duoc approve.
- UI `My Attendance` hien gio/status do WorkSchedule/PA2002 tra ve, khong can overlay request.
- Neu SAP posting loi, request khong bi approve gia.
- CAP khong con fallback status patch cho approve.
