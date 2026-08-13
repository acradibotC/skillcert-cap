CLASS lhc_AttendanceRequest IMPLEMENTATION.

  METHOD get_instance_features.
    READ ENTITIES OF zi_nxr_attreq IN LOCAL MODE
      ENTITY AttendanceRequest
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_requests).

    result = VALUE #( FOR req IN lt_requests (
      %tky = req-%tky
      %action-Approve = COND #( WHEN req-Status = '01' THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
      %action-Reject  = COND #( WHEN req-Status = '01' THEN if_abap_behv=>fc-o-enabled ELSE if_abap_behv=>fc-o-disabled )
    ) ).
  ENDMETHOD.

  METHOD get_instance_authorizations.
    result = VALUE #( FOR key IN keys (
      %tky = key-%tky
      %action-Approve = if_abap_behv=>auth-allowed
      %action-Reject = if_abap_behv=>auth-allowed
      %update = if_abap_behv=>auth-allowed
      %delete = if_abap_behv=>auth-allowed
    ) ).
  ENDMETHOD.

  METHOD NotifySubmitted.
    READ ENTITIES OF zi_nxr_attreq IN LOCAL MODE
      ENTITY AttendanceRequest
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_requests).

    LOOP AT lt_requests ASSIGNING FIELD-SYMBOL(<ls_request>).
      IF <ls_request>-Status = '01'.
        send_notification(
          iv_request_id       = <ls_request>-RequestId
          iv_request_type     = <ls_request>-RequestType
          iv_pernr            = <ls_request>-Pernr
          iv_start_date       = <ls_request>-StartDate
          iv_end_date         = <ls_request>-EndDate
          iv_reason           = <ls_request>-Reason
          iv_rejection_reason = <ls_request>-RejectionReason
          iv_approver_id      = <ls_request>-ApproverId
          iv_event            = 'SUBMITTED' ).
      ENDIF.
    ENDLOOP.
  ENDMETHOD.

  METHOD Approve.
    READ ENTITIES OF zi_nxr_attreq IN LOCAL MODE
      ENTITY AttendanceRequest
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_requests).

    LOOP AT lt_requests ASSIGNING FIELD-SYMBOL(<ls_request>).
      MODIFY ENTITIES OF zi_nxr_attreq IN LOCAL MODE
        ENTITY AttendanceRequest
        UPDATE FIELDS ( Status SapPostStatus SapPostMessage )
        WITH VALUE #( ( %tky = <ls_request>-%tky
                        Status = '02'
                        SapPostStatus = 'PENDING'
                        SapPostMessage = 'Approved. Pending SAP HR sync.' ) ).

      send_notification(
        iv_request_id       = <ls_request>-RequestId
        iv_request_type     = <ls_request>-RequestType
        iv_pernr            = <ls_request>-Pernr
        iv_start_date       = <ls_request>-StartDate
        iv_end_date         = <ls_request>-EndDate
        iv_reason           = <ls_request>-Reason
        iv_rejection_reason = <ls_request>-RejectionReason
        iv_approver_id      = <ls_request>-ApproverId
        iv_event            = 'APPROVED' ).
    ENDLOOP.

    result = VALUE #( FOR req IN lt_requests ( %tky = req-%tky %param = req ) ).
  ENDMETHOD.

  METHOD Reject.
    READ ENTITIES OF zi_nxr_attreq IN LOCAL MODE
      ENTITY AttendanceRequest
      ALL FIELDS WITH CORRESPONDING #( keys )
      RESULT DATA(lt_requests).

    LOOP AT lt_requests ASSIGNING FIELD-SYMBOL(<ls_request>).
      MODIFY ENTITIES OF zi_nxr_attreq IN LOCAL MODE
        ENTITY AttendanceRequest
        UPDATE FIELDS ( Status RejectionReason SapPostStatus SapPostMessage )
        WITH VALUE #( ( %tky = <ls_request>-%tky
                        Status = '03'
                        RejectionReason = <ls_request>-RejectionReason
                        SapPostStatus = 'PENDING'
                        SapPostMessage = 'Rejected by manager.' ) ).

      send_notification(
        iv_request_id       = <ls_request>-RequestId
        iv_request_type     = <ls_request>-RequestType
        iv_pernr            = <ls_request>-Pernr
        iv_start_date       = <ls_request>-StartDate
        iv_end_date         = <ls_request>-EndDate
        iv_reason           = <ls_request>-Reason
        iv_rejection_reason = <ls_request>-RejectionReason
        iv_approver_id      = <ls_request>-ApproverId
        iv_event            = 'REJECTED' ).
    ENDLOOP.

    result = VALUE #( FOR req IN lt_requests ( %tky = req-%tky %param = req ) ).
  ENDMETHOD.

  METHOD send_notification.
    DATA lv_recipient TYPE string.
    DATA lv_subject TYPE string.
    DATA lv_employee_name TYPE string.
    DATA lv_type_text TYPE string.
    DATA lv_error TYPE string.
    DATA lt_body TYPE bcsy_text.
    DATA ls_log TYPE ztb_nxr_attmail.
    DATA lv_now TYPE timestampl.

    IF iv_event = 'SUBMITTED'.
      lv_recipient = iv_approver_id.
    ELSE.
      lv_recipient = get_employee_email( iv_pernr ).
    ENDIF.

    CONDENSE lv_recipient NO-GAPS.
    TRANSLATE lv_recipient TO LOWER CASE.
    IF lv_recipient IS INITIAL OR lv_recipient NS '@'.
      RETURN.
    ENDIF.

    SELECT SINGLE *
      FROM ztb_nxr_attmail
      WHERE request_id = @iv_request_id
        AND event_type = @iv_event
        AND recipient_email = @lv_recipient
      INTO @ls_log.

    IF sy-subrc = 0 AND ls_log-mail_status = 'SENT'.
      RETURN.
    ENDIF.

    IF ls_log-event_id IS INITIAL.
      GET TIME STAMP FIELD lv_now.
      ls_log-client = sy-mandt.
      TRY.
          ls_log-event_id = cl_system_uuid=>create_uuid_x16_static( ).
        CATCH cx_uuid_error.
          RETURN.
      ENDTRY.
      ls_log-request_id = iv_request_id.
      ls_log-event_type = iv_event.
      ls_log-recipient_email = lv_recipient.
      ls_log-mail_status = 'NEW'.
      ls_log-retry_count = 0.
      ls_log-created_at = lv_now.
      ls_log-created_by = sy-uname.
      INSERT ztb_nxr_attmail FROM @ls_log.
      IF sy-subrc <> 0.
        SELECT SINGLE *
          FROM ztb_nxr_attmail
          WHERE request_id = @iv_request_id
            AND event_type = @iv_event
            AND recipient_email = @lv_recipient
          INTO @ls_log.
      ENDIF.
    ENDIF.

    IF ls_log-event_id IS INITIAL.
      RETURN.
    ENDIF.

    lv_type_text = get_request_type_text( iv_request_type ).
    lv_employee_name = get_employee_name( iv_pernr ).
    CASE iv_event.
      WHEN 'SUBMITTED'.
        lv_subject = |Approval required: { lv_type_text } request|.
        APPEND |Dear Manager,| TO lt_body.
        APPEND || TO lt_body.
        APPEND |A new { lv_type_text } request is waiting for your approval.| TO lt_body.
      WHEN 'APPROVED'.
        lv_subject = |Approved: { lv_type_text } request|.
        APPEND |Dear { lv_employee_name },| TO lt_body.
        APPEND || TO lt_body.
        APPEND |Your { lv_type_text } request has been approved.| TO lt_body.
      WHEN 'REJECTED'.
        lv_subject = |Rejected: { lv_type_text } request|.
        APPEND |Dear { lv_employee_name },| TO lt_body.
        APPEND || TO lt_body.
        APPEND |Your { lv_type_text } request has been rejected.| TO lt_body.
    ENDCASE.

    IF strlen( lv_subject ) > 50.
      lv_subject = lv_subject(50).
    ENDIF.
    APPEND || TO lt_body.
    APPEND |Employee: { lv_employee_name } ({ iv_pernr })| TO lt_body.
    APPEND |Request ID: { iv_request_id }| TO lt_body.
    APPEND |Period: { iv_start_date DATE = USER } - { iv_end_date DATE = USER }| TO lt_body.
    APPEND |Reason: { iv_reason }| TO lt_body.
    IF iv_event = 'REJECTED' AND iv_rejection_reason IS NOT INITIAL.
      APPEND |Rejection reason: { iv_rejection_reason }| TO lt_body.
    ENDIF.
    APPEND || TO lt_body.
    APPEND |Please open Nexora Employee Portal for details.| TO lt_body.

    TRY.
        DATA(lo_request) = cl_bcs=>create_persistent( ).
        DATA(lo_document) = cl_document_bcs=>create_document(
          i_type = 'RAW'
          i_text = lt_body
          i_subject = CONV so_obj_des( lv_subject ) ).
        lo_request->set_document( lo_document ).
        lo_request->add_recipient(
          cl_cam_address_bcs=>create_internet_address( CONV #( lv_recipient ) ) ).
        lo_request->set_send_immediately( abap_true ).
        DATA(lv_sent) = lo_request->send( i_with_error_screen = abap_false ).

        GET TIME STAMP FIELD lv_now.
        IF lv_sent = abap_true.
          UPDATE ztb_nxr_attmail
            SET mail_status = 'SENT',
                retry_count = retry_count + 1,
                sent_at = @lv_now,
                last_error = ''
            WHERE event_id = @ls_log-event_id.
        ELSE.
          UPDATE ztb_nxr_attmail
            SET mail_status = 'ERROR',
                retry_count = retry_count + 1,
                last_error = 'CL_BCS SEND returned false'
            WHERE event_id = @ls_log-event_id.
        ENDIF.
      CATCH cx_root INTO DATA(lx_error).
        lv_error = lx_error->get_text( ).
        GET TIME STAMP FIELD lv_now.
        UPDATE ztb_nxr_attmail
          SET mail_status = 'ERROR',
              retry_count = retry_count + 1,
              last_error = @lv_error
          WHERE event_id = @ls_log-event_id.
    ENDTRY.
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
      WHEN 'DAYOFF'. rv_text = 'Day Off'.
      WHEN 'EDIT_TIMESHEET'. rv_text = 'Edit Timesheet'.
      WHEN 'OVERTIME'. rv_text = 'Overtime'.
      WHEN 'WFH' OR 'WORK_FROM_HOME'. rv_text = 'Work From Home'.
      WHEN OTHERS. rv_text = iv_request_type.
    ENDCASE.
  ENDMETHOD.

ENDCLASS.
