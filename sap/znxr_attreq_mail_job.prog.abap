REPORT znxr_attreq_mail_job.

CONSTANTS:
  gc_event_all       TYPE c LENGTH 20 VALUE 'ALL',
  gc_event_submitted TYPE c LENGTH 20 VALUE 'SUBMITTED',
  gc_event_approved  TYPE c LENGTH 20 VALUE 'APPROVED',
  gc_event_rejected  TYPE c LENGTH 20 VALUE 'REJECTED',
  gc_status_pending  TYPE c LENGTH 2  VALUE '01',
  gc_status_approved TYPE c LENGTH 2  VALUE '02',
  gc_status_rejected TYPE c LENGTH 2  VALUE '03',
  gc_mail_new        TYPE c LENGTH 10 VALUE 'NEW',
  gc_mail_sent       TYPE c LENGTH 10 VALUE 'SENT',
  gc_mail_error      TYPE c LENGTH 10 VALUE 'ERROR'.

SELECTION-SCREEN BEGIN OF BLOCK b01 WITH FRAME.
SELECTION-SCREEN COMMENT /1(70) c_hlp1.
SELECTION-SCREEN COMMENT /1(70) c_hlp2.
SELECTION-SCREEN SKIP.
PARAMETERS:
  p_test  TYPE abap_bool AS CHECKBOX DEFAULT abap_true,
  p_max   TYPE i DEFAULT 100,
  p_retry TYPE i DEFAULT 3,
  p_event TYPE c LENGTH 20 DEFAULT gc_event_all.
SELECTION-SCREEN COMMENT 35(50) c_test FOR FIELD p_test.
SELECTION-SCREEN COMMENT 35(50) c_max  FOR FIELD p_max.
SELECTION-SCREEN COMMENT 35(50) c_rtry FOR FIELD p_retry.
SELECTION-SCREEN COMMENT 35(50) c_evnt FOR FIELD p_event.
SELECTION-SCREEN END OF BLOCK b01.

INITIALIZATION.
  c_hlp1 = 'Send approval workflow emails for Nexora attendance requests.'.
  c_hlp2 = 'Use test mode first; remove the checkbox to send mail with CL_BCS.'.
  c_test = 'Test mode: preview only, do not send or update log'.
  c_max  = 'Maximum request rows to scan'.
  c_rtry = 'Maximum send retries for ERROR log rows'.
  c_evnt = 'Event filter: ALL, SUBMITTED, APPROVED, REJECTED'.

CLASS lcl_mailer DEFINITION FINAL.
  PUBLIC SECTION.
    CLASS-METHODS run
      IMPORTING
        iv_test  TYPE abap_bool
        iv_max   TYPE i
        iv_retry TYPE i
        iv_event TYPE csequence.

  PRIVATE SECTION.
    CLASS-METHODS process_event
      IMPORTING
        is_request TYPE ztb_nxr_attreq
        iv_event   TYPE csequence
        iv_test    TYPE abap_bool
        iv_retry   TYPE i.

    CLASS-METHODS send_mail
      IMPORTING
        iv_recipient TYPE csequence
        iv_subject   TYPE csequence
        it_body      TYPE bcsy_text
      RAISING
        cx_bcs.

    CLASS-METHODS get_employee_email
      IMPORTING
        iv_pernr        TYPE persno
      RETURNING
        VALUE(rv_email) TYPE string.

    CLASS-METHODS get_employee_name
      IMPORTING
        iv_pernr       TYPE persno
      RETURNING
        VALUE(rv_name) TYPE string.

    CLASS-METHODS get_request_type_text
      IMPORTING
        iv_request_type TYPE csequence
      RETURNING
        VALUE(rv_text)  TYPE string.

    CLASS-METHODS build_subject
      IMPORTING
        is_request     TYPE ztb_nxr_attreq
        iv_event       TYPE csequence
      RETURNING
        VALUE(rv_text) TYPE string.

    CLASS-METHODS build_body
      IMPORTING
        is_request     TYPE ztb_nxr_attreq
        iv_event       TYPE csequence
      RETURNING
        VALUE(rt_body) TYPE bcsy_text.

    CLASS-METHODS ensure_log
      IMPORTING
        is_request     TYPE ztb_nxr_attreq
        iv_event       TYPE csequence
        iv_recipient   TYPE csequence
      RETURNING
        VALUE(rs_log)  TYPE ztb_nxr_attmail
      RAISING
        cx_uuid_error.

    CLASS-METHODS set_log_result
      IMPORTING
        is_log     TYPE ztb_nxr_attmail
        iv_success TYPE abap_bool
        iv_error   TYPE csequence.

    CLASS-METHODS should_process
      IMPORTING
        iv_event_filter TYPE csequence
        iv_event        TYPE csequence
      RETURNING
        VALUE(rv_yes)   TYPE abap_bool.
ENDCLASS.

CLASS lcl_mailer IMPLEMENTATION.
  METHOD run.
    DATA lt_requests TYPE STANDARD TABLE OF ztb_nxr_attreq WITH EMPTY KEY.
    DATA lv_event_filter TYPE c LENGTH 20.

    lv_event_filter = to_upper( iv_event ).
    IF lv_event_filter IS INITIAL.
      lv_event_filter = gc_event_all.
    ENDIF.

    SELECT *
      FROM ztb_nxr_attreq
      WHERE status = @gc_status_pending
         OR status = @gc_status_approved
         OR status = @gc_status_rejected
      ORDER BY created_at ASCENDING
      INTO TABLE @lt_requests
      UP TO @iv_max ROWS.

    IF sy-subrc <> 0.
      WRITE: / 'No attendance requests found for mail processing.'.
      RETURN.
    ENDIF.

    LOOP AT lt_requests ASSIGNING FIELD-SYMBOL(<ls_request>).
      CASE <ls_request>-status.
        WHEN gc_status_pending.
          IF should_process( iv_event_filter = lv_event_filter iv_event = gc_event_submitted ) = abap_true.
            process_event(
              is_request = <ls_request>
              iv_event   = gc_event_submitted
              iv_test    = iv_test
              iv_retry   = iv_retry ).
          ENDIF.
        WHEN gc_status_approved.
          IF should_process( iv_event_filter = lv_event_filter iv_event = gc_event_approved ) = abap_true.
            process_event(
              is_request = <ls_request>
              iv_event   = gc_event_approved
              iv_test    = iv_test
              iv_retry   = iv_retry ).
          ENDIF.
        WHEN gc_status_rejected.
          IF should_process( iv_event_filter = lv_event_filter iv_event = gc_event_rejected ) = abap_true.
            process_event(
              is_request = <ls_request>
              iv_event   = gc_event_rejected
              iv_test    = iv_test
              iv_retry   = iv_retry ).
          ENDIF.
      ENDCASE.
    ENDLOOP.
  ENDMETHOD.

  METHOD process_event.
    DATA lv_recipient TYPE string.
    DATA lv_subject   TYPE string.
    DATA lt_body      TYPE bcsy_text.
    DATA ls_log       TYPE ztb_nxr_attmail.
    DATA lv_error     TYPE string.

    IF iv_event = gc_event_submitted.
      lv_recipient = is_request-approver_id.
    ELSE.
      lv_recipient = get_employee_email( is_request-pernr ).
    ENDIF.

    CONDENSE lv_recipient NO-GAPS.
    TRANSLATE lv_recipient TO LOWER CASE.

    IF lv_recipient IS INITIAL OR lv_recipient NS '@'.
      WRITE: / 'Skipped request', is_request-request_id, iv_event, '- missing recipient email.'.
      RETURN.
    ENDIF.

    SELECT SINGLE *
      FROM ztb_nxr_attmail
      WHERE request_id      = @is_request-request_id
        AND event_type      = @iv_event
        AND recipient_email = @lv_recipient
      INTO @ls_log.

    IF sy-subrc = 0 AND ls_log-mail_status = gc_mail_sent.
      WRITE: / 'Skipped request', is_request-request_id, iv_event, '- already sent to', lv_recipient.
      RETURN.
    ELSEIF sy-subrc = 0 AND ls_log-mail_status = gc_mail_error AND ls_log-retry_count >= iv_retry.
      WRITE: / 'Skipped request', is_request-request_id, iv_event, '- retry limit reached for', lv_recipient.
      RETURN.
    ENDIF.

    IF iv_test = abap_true.
      WRITE: / 'TEST:', iv_event, 'mail for request', is_request-request_id, 'to', lv_recipient.
      RETURN.
    ENDIF.

    TRY.
        IF ls_log-event_id IS INITIAL.
          ls_log = ensure_log(
            is_request   = is_request
            iv_event     = iv_event
            iv_recipient = lv_recipient ).
        ENDIF.

        lv_subject = build_subject( is_request = is_request iv_event = iv_event ).
        lt_body = build_body( is_request = is_request iv_event = iv_event ).

        send_mail(
          iv_recipient = lv_recipient
          iv_subject   = lv_subject
          it_body      = lt_body ).

        set_log_result(
          is_log     = ls_log
          iv_success = abap_true
          iv_error   = '' ).

        WRITE: / 'Sent:', iv_event, 'request', is_request-request_id, 'to', lv_recipient.
      CATCH cx_uuid_error INTO DATA(lx_uuid).
        WRITE: / 'Failed:', iv_event, 'request', is_request-request_id, lx_uuid->get_text( ).
      CATCH cx_bcs INTO DATA(lx_bcs).
        lv_error = lx_bcs->get_text( ).
        set_log_result(
          is_log     = ls_log
          iv_success = abap_false
          iv_error   = lv_error ).
        WRITE: / 'Failed:', iv_event, 'request', is_request-request_id, lv_error.
    ENDTRY.
  ENDMETHOD.

  METHOD send_mail.
    DATA lt_body TYPE bcsy_text.
    DATA lv_subject TYPE so_obj_des.

    lt_body = it_body.
    lv_subject = iv_subject.

    DATA(lo_request) = cl_bcs=>create_persistent( ).
    DATA(lo_document) = cl_document_bcs=>create_document(
      i_type    = 'RAW'
      i_text    = lt_body
      i_subject = lv_subject ).

    lo_request->set_document( lo_document ).
    lo_request->add_recipient(
      cl_cam_address_bcs=>create_internet_address( CONV #( iv_recipient ) ) ).
    lo_request->set_send_immediately( abap_true ).

    lo_request->send( i_with_error_screen = abap_false ).

    COMMIT WORK AND WAIT.
  ENDMETHOD.

  METHOD get_employee_email.
    SELECT SINGLE EmployeeEmail
      FROM zi_nxr_hr_team_members
      WHERE EmployeePernr = @iv_pernr
      INTO @rv_email.

    IF rv_email IS INITIAL.
      SELECT SINGLE usrid_long
        FROM pa0105
        WHERE pernr = @iv_pernr
          AND subty = '0010'
          AND endda = '99991231'
        INTO @rv_email.
    ENDIF.
  ENDMETHOD.

  METHOD get_employee_name.
    SELECT SINGLE ename
      FROM pa0001
      WHERE pernr = @iv_pernr
        AND endda = '99991231'
      INTO @rv_name.

    IF rv_name IS INITIAL.
      rv_name = iv_pernr.
    ENDIF.
  ENDMETHOD.

  METHOD get_request_type_text.
    CASE iv_request_type.
      WHEN 'DAYOFF'.
        rv_text = 'Day Off'.
      WHEN 'EDIT_TIMESHEET'.
        rv_text = 'Edit Timesheet'.
      WHEN 'OVERTIME'.
        rv_text = 'Overtime'.
      WHEN 'WFH' OR 'WORK_FROM_HOME'.
        rv_text = 'Work From Home'.
      WHEN OTHERS.
        rv_text = iv_request_type.
    ENDCASE.
  ENDMETHOD.

  METHOD build_subject.
    DATA(lv_type_text) = get_request_type_text( is_request-request_type ).

    CASE iv_event.
      WHEN gc_event_submitted.
        rv_text = |Approval required: { lv_type_text } request|.
      WHEN gc_event_approved.
        rv_text = |Approved: { lv_type_text } request|.
      WHEN gc_event_rejected.
        rv_text = |Rejected: { lv_type_text } request|.
      WHEN OTHERS.
        rv_text = |Attendance request update|.
    ENDCASE.

    IF strlen( rv_text ) > 50.
      rv_text = rv_text(50).
    ENDIF.
  ENDMETHOD.

  METHOD build_body.
    DATA(lv_employee_name) = get_employee_name( is_request-pernr ).
    DATA(lv_type_text) = get_request_type_text( is_request-request_type ).

    CASE iv_event.
      WHEN gc_event_submitted.
        APPEND |Dear Manager,| TO rt_body.
        APPEND || TO rt_body.
        APPEND |A new { lv_type_text } request is waiting for your approval.| TO rt_body.
      WHEN gc_event_approved.
        APPEND |Dear { lv_employee_name },| TO rt_body.
        APPEND || TO rt_body.
        APPEND |Your { lv_type_text } request has been approved.| TO rt_body.
      WHEN gc_event_rejected.
        APPEND |Dear { lv_employee_name },| TO rt_body.
        APPEND || TO rt_body.
        APPEND |Your { lv_type_text } request has been rejected.| TO rt_body.
    ENDCASE.

    APPEND || TO rt_body.
    APPEND |Employee: { lv_employee_name } ({ is_request-pernr })| TO rt_body.
    APPEND |Request ID: { is_request-request_id }| TO rt_body.
    APPEND |Period: { is_request-start_date DATE = USER } - { is_request-end_date DATE = USER }| TO rt_body.
    APPEND |Reason: { is_request-reason }| TO rt_body.

    IF iv_event = gc_event_rejected AND is_request-rejection_reason IS NOT INITIAL.
      APPEND |Rejection reason: { is_request-rejection_reason }| TO rt_body.
    ENDIF.

    APPEND || TO rt_body.
    APPEND |Please open Nexora Employee Portal for details.| TO rt_body.
  ENDMETHOD.

  METHOD ensure_log.
    GET TIME STAMP FIELD DATA(lv_now).

    rs_log-client = sy-mandt.
    rs_log-event_id = cl_system_uuid=>create_uuid_x16_static( ).
    rs_log-request_id = is_request-request_id.
    rs_log-event_type = iv_event.
    rs_log-recipient_email = iv_recipient.
    rs_log-mail_status = gc_mail_new.
    rs_log-retry_count = 0.
    rs_log-created_at = lv_now.
    rs_log-created_by = sy-uname.

    INSERT ztb_nxr_attmail FROM @rs_log.
    COMMIT WORK AND WAIT.
  ENDMETHOD.

  METHOD set_log_result.
    GET TIME STAMP FIELD DATA(lv_now).
    DATA(lv_error) = CONV ztb_nxr_attmail-last_error( iv_error ).

    IF iv_success = abap_true.
      UPDATE ztb_nxr_attmail
        SET mail_status = @gc_mail_sent,
            retry_count = retry_count + 1,
            sent_at     = @lv_now,
            last_error  = ''
        WHERE event_id = @is_log-event_id.
    ELSE.
      UPDATE ztb_nxr_attmail
        SET mail_status = @gc_mail_error,
            retry_count = retry_count + 1,
            last_error  = @lv_error
        WHERE event_id = @is_log-event_id.
    ENDIF.

    COMMIT WORK AND WAIT.
  ENDMETHOD.

  METHOD should_process.
    rv_yes = xsdbool(
      iv_event_filter = gc_event_all
      OR iv_event_filter = iv_event ).
  ENDMETHOD.
ENDCLASS.

START-OF-SELECTION.
  lcl_mailer=>run(
    iv_test  = p_test
    iv_max   = p_max
    iv_retry = p_retry
    iv_event = p_event ).
