REPORT znxr_attreq_sync_job.

DATA: lt_requests TYPE TABLE OF ztb_nxr_attreq,
      lt_existing_p2002 TYPE STANDARD TABLE OF pa2002 WITH EMPTY KEY,
      lt_existing_p2005 TYPE STANDARD TABLE OF pa2005 WITH EMPTY KEY,
      ls_p2001    TYPE p2001,
      ls_p2002    TYPE p2002,
      ls_p2005    TYPE p2005,
      ls_existing_p2002 TYPE pa2002,
      ls_existing_p2005 TYPE pa2005,
      ls_return   TYPE bapireturn1,
      ls_key      TYPE bapipakey,
      lv_infty    TYPE infty,
      lv_subty    TYPE subty,
      lv_operation TYPE pspar-actio,
      lv_seqnr     TYPE seqnr,
      lv_start_seconds TYPE i,
      lv_end_seconds TYPE i,
      lv_active_p2002_count TYPE i,
      lv_verified_seqnr TYPE seqnr,
      lv_success_message TYPE c LENGTH 255.

SELECT * FROM ztb_nxr_attreq INTO TABLE @lt_requests
  WHERE status = '02' AND sap_post_status = 'PENDING'.

IF sy-subrc <> 0.
  WRITE: / 'No pending requests found to sync.'.
  EXIT.
ENDIF.

WRITE: / 'Processing', lines( lt_requests ), 'requests...'.

LOOP AT lt_requests ASSIGNING FIELD-SYMBOL(<ls_req>).
  CLEAR: ls_return, ls_p2001, ls_p2002, ls_p2005,
         ls_existing_p2002, ls_existing_p2005,
         ls_key, lv_infty, lv_subty, lv_operation, lv_seqnr,
         lv_start_seconds, lv_end_seconds, lv_active_p2002_count,
         lv_verified_seqnr,
         lv_success_message, lt_existing_p2002, lt_existing_p2005.

  DATA(lv_date_start) = <ls_req>-start_date.
  DATA(lv_date_end)   = COND d( WHEN <ls_req>-end_date IS INITIAL THEN <ls_req>-start_date ELSE <ls_req>-end_date ).
  DATA(lv_time_start) = <ls_req>-corrected_start_time.
  DATA(lv_time_end)   = <ls_req>-corrected_end_time.

  " Lock employee
  CALL FUNCTION 'BAPI_EMPLOYEE_ENQUEUE'
    EXPORTING
      number = <ls_req>-pernr
    IMPORTING
      return = ls_return.

  IF ls_return-type CA 'AEX'.
    UPDATE ztb_nxr_attreq
      SET sap_post_status = 'ERROR',
          sap_post_message = @ls_return-message
      WHERE request_id = @<ls_req>-request_id.
    WRITE: / 'Failed:', <ls_req>-request_id, ls_return-message.
    COMMIT WORK AND WAIT.
    CONTINUE.
  ENDIF.

  CLEAR ls_return.

  CASE <ls_req>-request_type.
    WHEN 'DAYOFF'.
      lv_infty = '2001'.
      lv_subty = '0100'.
      ls_p2001-pernr = <ls_req>-pernr.
      ls_p2001-subty = lv_subty.
      ls_p2001-awart = lv_subty.
      ls_p2001-begda = lv_date_start.
      ls_p2001-endda = lv_date_end.

      CALL FUNCTION 'HR_INFOTYPE_OPERATION'
        EXPORTING
          infty         = lv_infty
          number        = <ls_req>-pernr
          subtype       = lv_subty
          validitybegin = lv_date_start
          validityend   = lv_date_end
          record        = ls_p2001
          operation     = 'INS'
          tclas         = 'A'
          dialog_mode   = '0'
          nocommit      = abap_true
        IMPORTING
          return        = ls_return
          key           = ls_key.

    WHEN 'OVERTIME'.
      " Overtime is stored in the standard SAP HCM overtime infotype.
      lv_infty = '2005'.
      lv_subty = space.

      SELECT *
        FROM pa2005
        WHERE pernr = @<ls_req>-pernr
          AND subty = @space
          AND begda = @lv_date_start
          AND endda = @lv_date_end
          AND beguz = @lv_time_start
          AND enduz = @lv_time_end
          AND sprps = @space
        INTO TABLE @lt_existing_p2005.

      CASE lines( lt_existing_p2005 ).
        WHEN 0.
          lv_operation = 'INS'.
        WHEN 1.
          READ TABLE lt_existing_p2005 INDEX 1 INTO ls_existing_p2005.
          MOVE-CORRESPONDING ls_existing_p2005 TO ls_p2005.
          lv_operation = 'MOD'.
          lv_seqnr = ls_existing_p2005-seqnr.
        WHEN OTHERS.
          ls_return-type = 'E'.
          ls_return-message =
            'Multiple active PA2005 overtime records exist for this date and time.'.
      ENDCASE.

      ls_p2005-pernr = <ls_req>-pernr.
      ls_p2005-subty = space.
      ls_p2005-begda = lv_date_start.
      ls_p2005-endda = lv_date_end.
      ls_p2005-beguz = lv_time_start.
      ls_p2005-enduz = lv_time_end.

      lv_start_seconds = CONV i( lv_time_start+0(2) ) * 3600
                       + CONV i( lv_time_start+2(2) ) * 60
                       + CONV i( lv_time_start+4(2) ).
      lv_end_seconds = CONV i( lv_time_end+0(2) ) * 3600
                     + CONV i( lv_time_end+2(2) ) * 60
                     + CONV i( lv_time_end+4(2) ).
      IF lv_end_seconds < lv_start_seconds.
        lv_end_seconds = lv_end_seconds + 86400.
      ENDIF.

      ls_p2005-stdaz = ( lv_end_seconds - lv_start_seconds ) / 3600
                     - <ls_req>-ot_break_hours.
      IF <ls_req>-ot_break_hours > 0.
        ls_p2005-punb1 = <ls_req>-ot_break_hours.
      ENDIF.
      IF ls_p2005-stdaz <= 0.
        ls_return-type = 'E'.
        ls_return-message = 'Calculated overtime duration must be greater than zero.'.
      ENDIF.

      IF ls_return-type NA 'AEX'.
        CALL FUNCTION 'HR_INFOTYPE_OPERATION'
          EXPORTING
            infty         = lv_infty
            number        = <ls_req>-pernr
            subtype       = lv_subty
            validitybegin = ls_p2005-begda
            validityend   = ls_p2005-endda
            recordnumber  = lv_seqnr
            record        = ls_p2005
            operation     = lv_operation
            tclas         = 'A'
            dialog_mode   = '0'
            nocommit      = abap_true
          IMPORTING
            return        = ls_return
            key           = ls_key.
      ENDIF.

    WHEN 'EDIT_TIMESHEET' OR 'WFH' OR 'WORK_FROM_HOME'.
      lv_infty = '2002'.
      CASE <ls_req>-request_type.
        WHEN 'EDIT_TIMESHEET'.   lv_subty = '0800'.
        WHEN 'WFH'.               lv_subty = '0800'.
        WHEN 'WORK_FROM_HOME'.   lv_subty = '0800'.
      ENDCASE.

      IF <ls_req>-request_type = 'EDIT_TIMESHEET'
         OR <ls_req>-request_type = 'WFH'
         OR <ls_req>-request_type = 'WORK_FROM_HOME'.
        SELECT *
          FROM pa2002
          WHERE pernr = @<ls_req>-pernr
            AND subty = @lv_subty
            AND begda = @lv_date_start
            AND endda = @lv_date_end
            AND sprps = @space
          INTO TABLE @lt_existing_p2002.

        CASE lines( lt_existing_p2002 ).
          WHEN 0.
            lv_operation = 'INS'.
          WHEN 1.
            READ TABLE lt_existing_p2002 INDEX 1 INTO ls_existing_p2002.
            MOVE-CORRESPONDING ls_existing_p2002 TO ls_p2002.
            lv_operation = 'MOD'.
            lv_seqnr = ls_existing_p2002-seqnr.
          WHEN OTHERS.
            ls_return-type = 'E'.
            ls_return-message =
              'Multiple active PA2002 subtype 0800 records exist for this date.'.
        ENDCASE.
      ELSE.
        lv_operation = 'INS'.
      ENDIF.

      ls_p2002-pernr = <ls_req>-pernr.
      ls_p2002-infty = lv_infty.
      ls_p2002-subty = lv_subty.
      ls_p2002-awart = lv_subty.
      ls_p2002-begda = lv_date_start.
      ls_p2002-endda = lv_date_end.

      IF <ls_req>-request_type = 'WFH'
         OR <ls_req>-request_type = 'WORK_FROM_HOME'.
        IF lv_time_start IS INITIAL.
          lv_time_start = '080000'.
        ENDIF.
        IF lv_time_end IS INITIAL.
          lv_time_end = '173000'.
        ENDIF.
      ENDIF.

      ls_p2002-beguz = lv_time_start.
      ls_p2002-enduz = lv_time_end.

      IF <ls_req>-request_type = 'EDIT_TIMESHEET'
         OR <ls_req>-request_type = 'WFH'
         OR <ls_req>-request_type = 'WORK_FROM_HOME'.
        " Calculate duration in hours if needed, standard STDAZ
        lv_start_seconds = CONV i( lv_time_start+0(2) ) * 3600 + CONV i( lv_time_start+2(2) ) * 60 + CONV i( lv_time_start+4(2) ).
        lv_end_seconds = CONV i( lv_time_end+0(2) ) * 3600 + CONV i( lv_time_end+2(2) ) * 60 + CONV i( lv_time_end+4(2) ).
        IF lv_end_seconds < lv_start_seconds.
          lv_end_seconds = lv_end_seconds + 86400.
        ENDIF.
        ls_p2002-stdaz = ( lv_end_seconds - lv_start_seconds ) / 3600.
        IF ls_p2002-stdaz <= 0.
          ls_return-type = 'E'.
          ls_return-message = 'Calculated attendance duration must be greater than zero.'.
        ENDIF.
      ENDIF.

      IF ls_return-type NA 'AEX'.
        CALL FUNCTION 'HR_INFOTYPE_OPERATION'
          EXPORTING
            infty         = lv_infty
            number        = <ls_req>-pernr
            subtype       = lv_subty
            validitybegin = ls_p2002-begda
            validityend   = ls_p2002-endda
            recordnumber  = lv_seqnr
            record        = ls_p2002
            operation     = lv_operation
            tclas         = 'A'
            dialog_mode   = '0'
            nocommit      = abap_true
          IMPORTING
            return        = ls_return
            key           = ls_key.
      ENDIF.

    WHEN OTHERS.
      ls_return-type = 'E'.
      ls_return-message = 'Unsupported request type.'.
  ENDCASE.

  IF <ls_req>-request_type = 'OVERTIME'
     AND ls_return-type NA 'AEX'.
    " Persist PA2005 before verifying the actual SAP source of truth.
    COMMIT WORK AND WAIT.

    IF lv_operation = 'MOD'.
      SELECT SINGLE seqnr
        FROM pa2005
        WHERE pernr = @<ls_req>-pernr
          AND subty = @space
          AND begda = @lv_date_start
          AND endda = @lv_date_end
          AND seqnr = @lv_seqnr
          AND sprps = @space
          AND beguz = @lv_time_start
          AND enduz = @lv_time_end
          AND stdaz > 0
        INTO @lv_verified_seqnr.
    ELSEIF ls_key-recordnr IS NOT INITIAL.
      SELECT SINGLE seqnr
        FROM pa2005
        WHERE pernr = @<ls_req>-pernr
          AND subty = @space
          AND begda = @lv_date_start
          AND endda = @lv_date_end
          AND seqnr = @ls_key-recordnr
          AND sprps = @space
          AND beguz = @lv_time_start
          AND enduz = @lv_time_end
          AND stdaz > 0
        INTO @lv_verified_seqnr.
    ELSE.
      SELECT SINGLE seqnr
        FROM pa2005
        WHERE pernr = @<ls_req>-pernr
          AND subty = @space
          AND begda = @lv_date_start
          AND endda = @lv_date_end
          AND sprps = @space
          AND beguz = @lv_time_start
          AND enduz = @lv_time_end
          AND stdaz > 0
        INTO @lv_verified_seqnr.
    ENDIF.

    IF sy-subrc <> 0.
      ls_return-type = 'E'.
      ls_return-message = 'PA2005 verification failed after overtime operation.'.
    ELSEIF lv_operation = 'MOD'.
      lv_success_message = 'Updated existing PA2005 overtime and verified.'.
    ELSE.
      lv_success_message = 'Inserted PA2005 overtime and verified.'.
    ENDIF.

  ELSEIF ( <ls_req>-request_type = 'EDIT_TIMESHEET'
       OR <ls_req>-request_type = 'WFH'
       OR <ls_req>-request_type = 'WORK_FROM_HOME' )
     AND ls_return-type NA 'AEX'.
    " Persist PA2002 before verifying the actual SAP source of truth.
    COMMIT WORK AND WAIT.

    SELECT COUNT( * )
      FROM pa2002
      WHERE pernr = @<ls_req>-pernr
        AND subty = @lv_subty
        AND begda = @lv_date_start
        AND endda = @lv_date_end
        AND sprps = @space
      INTO @lv_active_p2002_count.

    IF lv_active_p2002_count <> 1.
      ls_return-type = 'E'.
      ls_return-message =
        'PA2002 verification failed: expected exactly one active record.'.
    ELSEIF lv_operation = 'MOD'.
      SELECT SINGLE seqnr
        FROM pa2002
        WHERE pernr = @<ls_req>-pernr
          AND subty = @lv_subty
          AND begda = @lv_date_start
          AND endda = @lv_date_end
          AND seqnr = @lv_seqnr
          AND sprps = @space
          AND beguz = @lv_time_start
          AND enduz = @lv_time_end
          AND stdaz > 0
        INTO @lv_verified_seqnr.
    ELSEIF ls_key-recordnr IS NOT INITIAL.
      SELECT SINGLE seqnr
        FROM pa2002
        WHERE pernr = @<ls_req>-pernr
          AND subty = @lv_subty
          AND begda = @lv_date_start
          AND endda = @lv_date_end
          AND seqnr = @ls_key-recordnr
          AND sprps = @space
          AND beguz = @lv_time_start
          AND enduz = @lv_time_end
          AND stdaz > 0
        INTO @lv_verified_seqnr.
    ELSE.
      SELECT SINGLE seqnr
        FROM pa2002
        WHERE pernr = @<ls_req>-pernr
          AND subty = @lv_subty
          AND begda = @lv_date_start
          AND endda = @lv_date_end
          AND sprps = @space
          AND beguz = @lv_time_start
          AND enduz = @lv_time_end
          AND stdaz > 0
        INTO @lv_verified_seqnr.
    ENDIF.

    IF ls_return-type NA 'AEX' AND sy-subrc <> 0.
      ls_return-type = 'E'.
      ls_return-message = 'PA2002 verification failed after infotype operation.'.
    ELSEIF ls_return-type NA 'AEX' AND lv_operation = 'MOD'.
      lv_success_message = |Updated existing PA2002 subtype { lv_subty } and verified.|.
    ELSEIF ls_return-type NA 'AEX'.
      lv_success_message = |Inserted PA2002 subtype { lv_subty } and verified.|.
    ENDIF.
  ENDIF.

  IF ls_return-type CA 'AEX'.
    UPDATE ztb_nxr_attreq
      SET sap_post_status = 'ERROR',
          sap_post_message = @ls_return-message
      WHERE request_id = @<ls_req>-request_id.
    WRITE: / 'Failed:', <ls_req>-request_id, ls_return-message.
  ELSE.
    IF lv_success_message IS INITIAL.
      lv_success_message = 'Posted successfully via Sync Job.'.
    ENDIF.
    UPDATE ztb_nxr_attreq
      SET sap_post_status = 'SUCCESS',
          sap_post_message = @lv_success_message
      WHERE request_id = @<ls_req>-request_id.
    WRITE: / 'Success:', <ls_req>-request_id.
  ENDIF.

  " Unlock employee
  CALL FUNCTION 'BAPI_EMPLOYEE_DEQUEUE'
    EXPORTING
      number = <ls_req>-pernr.

  COMMIT WORK AND WAIT.
ENDLOOP.

WRITE: / 'Job finished.'.
