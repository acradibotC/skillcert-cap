CLASS lhc_AttendanceRequest DEFINITION INHERITING FROM cl_abap_behavior_handler.
  PRIVATE SECTION.

    METHODS get_instance_features FOR INSTANCE FEATURES
      IMPORTING keys REQUEST requested_features FOR AttendanceRequest RESULT result.

    METHODS get_instance_authorizations FOR INSTANCE AUTHORIZATION
      IMPORTING keys REQUEST requested_authorizations FOR AttendanceRequest RESULT result.

    METHODS NotifySubmitted FOR DETERMINE ON MODIFY
      IMPORTING keys FOR AttendanceRequest~NotifySubmitted.

    METHODS Approve FOR MODIFY
      IMPORTING keys FOR ACTION AttendanceRequest~Approve RESULT result.

    METHODS Reject FOR MODIFY
      IMPORTING keys FOR ACTION AttendanceRequest~Reject RESULT result.

    METHODS send_notification
      IMPORTING
        iv_request_id       TYPE sysuuid_x16
        iv_request_type     TYPE ztb_nxr_attreq-request_type
        iv_pernr            TYPE persno
        iv_start_date       TYPE datum
        iv_end_date         TYPE datum
        iv_reason           TYPE bapi_msg
        iv_rejection_reason TYPE bapi_msg
        iv_approver_id      TYPE ztb_nxr_attreq-approver_id
        iv_event            TYPE ztb_nxr_attmail-event_type.

    METHODS get_employee_email
      IMPORTING iv_pernr TYPE persno
      RETURNING VALUE(rv_email) TYPE string.

    METHODS get_employee_name
      IMPORTING iv_pernr TYPE persno
      RETURNING VALUE(rv_name) TYPE string.

    METHODS get_request_type_text
      IMPORTING iv_request_type TYPE ztb_nxr_attreq-request_type
      RETURNING VALUE(rv_text) TYPE string.

ENDCLASS.
