REPORT znxr_worktime_sync_job.

CONSTANTS:
  gc_infty       TYPE infty VALUE '2002',
  gc_subty       TYPE subty VALUE '0800',
  gc_queued      TYPE c LENGTH 15 VALUE 'QUEUED',
  gc_retry       TYPE c LENGTH 15 VALUE 'RETRY',
  gc_success     TYPE c LENGTH 15 VALUE 'SUCCESS',
  gc_error       TYPE c LENGTH 15 VALUE 'ERROR'.

PARAMETERS:
  p_todate TYPE d DEFAULT sy-datum,
  p_max    TYPE i DEFAULT 500,
  p_retry  TYPE i DEFAULT 3.

DATA:
  gv_success TYPE i,
  gv_failed  TYPE i,
  gv_skipped TYPE i.

INITIALIZATION.
  p_todate = sy-datum - 1.

START-OF-SELECTION.
  IF p_todate >= sy-datum.
    MESSAGE 'To date must be earlier than today' TYPE 'E'.
  ENDIF.
  IF p_max <= 0 OR p_retry <= 0.
    MESSAGE 'Maximum rows and retry count must be greater than zero' TYPE 'E'.
  ENDIF.

  DATA:
    lv_now               TYPE timestampl,
    lv_initial_timestamp TYPE timestampl.
  GET TIME STAMP FIELD lv_now.

  DATA lt_stage TYPE STANDARD TABLE OF ztb_nxr_wt_stage WITH EMPTY KEY.
  SELECT *
    FROM ztb_nxr_wt_stage
    WHERE work_date <= @p_todate
      AND ( sync_status = @gc_queued OR sync_status = @gc_retry )
      AND ( next_retry_at = @lv_initial_timestamp OR next_retry_at <= @lv_now )
    ORDER BY work_date, pernr
    INTO TABLE @lt_stage
    UP TO @p_max ROWS.

  IF lt_stage IS INITIAL.
    WRITE: / 'No queued HR work-time records are eligible for synchronization.'.
    RETURN.
  ENDIF.

  LOOP AT lt_stage INTO DATA(ls_candidate).
    DATA ls_lock_return TYPE bapireturn1.
    CLEAR ls_lock_return.

    CALL FUNCTION 'BAPI_EMPLOYEE_ENQUEUE'
      EXPORTING
        number = ls_candidate-pernr
      IMPORTING
        return = ls_lock_return.

    IF ls_lock_return-type CA 'AEX'.
      PERFORM mark_failure USING ls_candidate ls_lock_return-message p_retry.
      gv_failed = gv_failed + 1.
      CONTINUE.
    ENDIF.

    DATA ls_stage TYPE ztb_nxr_wt_stage.
    CLEAR ls_stage.
    SELECT SINGLE *
      FROM ztb_nxr_wt_stage
      WHERE pernr = @ls_candidate-pernr
        AND work_date = @ls_candidate-work_date
      INTO @ls_stage.

    IF sy-subrc <> 0 OR
       ( ls_stage-sync_status <> gc_queued AND ls_stage-sync_status <> gc_retry ) OR
       ls_stage-work_date > p_todate.
      gv_skipped = gv_skipped + 1.
      CALL FUNCTION 'BAPI_EMPLOYEE_DEQUEUE'
        EXPORTING
          number = ls_candidate-pernr.
      CONTINUE.
    ENDIF.

    DATA:
      lv_start_seconds TYPE i,
      lv_end_seconds   TYPE i,
      lv_hours         TYPE p LENGTH 5 DECIMALS 2,
      lv_operation     TYPE pspar-actio,
      lv_seqnr         TYPE seqnr,
      lv_post_ok       TYPE abap_bool VALUE abap_true,
      lv_error_message TYPE bapi_msg,
      ls_pa2002_db     TYPE pa2002,
      ls_p2002         TYPE p2002,
      ls_bapi_return   TYPE bapireturn1,
      ls_bapi_key      TYPE bapipakey.

    CLEAR: lv_start_seconds, lv_end_seconds, lv_hours,
           lv_operation, lv_seqnr, lv_error_message,
           ls_pa2002_db, ls_p2002, ls_bapi_return, ls_bapi_key.

    IF ls_stage-first_entry IS INITIAL OR ls_stage-last_exit IS INITIAL.
      lv_post_ok = abap_false.
      lv_error_message = 'First Entry and Last Exit are required.'.
    ELSE.
      lv_start_seconds = CONV i( ls_stage-first_entry+0(2) ) * 3600
                       + CONV i( ls_stage-first_entry+2(2) ) * 60
                       + CONV i( ls_stage-first_entry+4(2) ).
      lv_end_seconds = CONV i( ls_stage-last_exit+0(2) ) * 3600
                     + CONV i( ls_stage-last_exit+2(2) ) * 60
                     + CONV i( ls_stage-last_exit+4(2) ).

      IF lv_end_seconds < lv_start_seconds.
        lv_end_seconds = lv_end_seconds + 86400.
      ENDIF.
      lv_hours = ( lv_end_seconds - lv_start_seconds ) / 3600.

      IF lv_hours <= 0.
        lv_post_ok = abap_false.
        lv_error_message = 'Calculated attendance duration must be greater than zero.'.
      ENDIF.
    ENDIF.

    IF lv_post_ok = abap_true.
      SELECT *
        FROM pa2002
        WHERE pernr = @ls_stage-pernr
          AND subty = @gc_subty
          AND begda = @ls_stage-work_date
          AND endda = @ls_stage-work_date
          AND sprps = @space
        ORDER BY seqnr DESCENDING
        INTO @ls_pa2002_db
        UP TO 1 ROWS.
      ENDSELECT.

      IF sy-subrc = 0.
        MOVE-CORRESPONDING ls_pa2002_db TO ls_p2002.
        lv_operation = 'MOD'.
        lv_seqnr = ls_pa2002_db-seqnr.
      ELSE.
        lv_operation = 'INS'.
        CLEAR lv_seqnr.
      ENDIF.

      ls_p2002-pernr = ls_stage-pernr.
      ls_p2002-infty = gc_infty.
      ls_p2002-subty = gc_subty.
      ls_p2002-begda = ls_stage-work_date.
      ls_p2002-endda = ls_stage-work_date.
      ls_p2002-beguz = ls_stage-first_entry.
      ls_p2002-enduz = ls_stage-last_exit.
      ls_p2002-stdaz = lv_hours.

      CALL FUNCTION 'HR_INFOTYPE_OPERATION'
        EXPORTING
          infty         = gc_infty
          number        = ls_stage-pernr
          subtype       = gc_subty
          validityend   = ls_stage-work_date
          validitybegin = ls_stage-work_date
          recordnumber  = lv_seqnr
          record        = ls_p2002
          operation     = lv_operation
          tclas         = 'A'
          dialog_mode   = '0'
          nocommit      = abap_true
        IMPORTING
          return        = ls_bapi_return
          key           = ls_bapi_key.

      IF ls_bapi_return-type CA 'AEX'.
        lv_post_ok = abap_false.
        lv_error_message = ls_bapi_return-message.
      ENDIF.
    ENDIF.

    IF lv_post_ok = abap_true.
      GET TIME STAMP FIELD lv_now.
      DATA(lv_document_seqnr) = COND seqnr(
        WHEN ls_bapi_key-recordnr IS NOT INITIAL THEN ls_bapi_key-recordnr
        ELSE lv_seqnr ).
      DATA(lv_document_key) = |2002/{ gc_subty }/{ ls_stage-work_date DATE = ISO }/{ lv_document_seqnr }|.
      DATA(lv_attempt_count) = ls_stage-attempt_count + 1.

      UPDATE ztb_nxr_wt_stage
        SET sync_status = @gc_success,
            request_status = 'POSTED',
            sync_message = 'Posted to PA2002 subtype 0800.',
            attempt_count = @lv_attempt_count,
            next_retry_at = @lv_initial_timestamp,
            sap_document_key = @lv_document_key,
            last_changed_by = @sy-uname,
            last_changed_at = @lv_now,
            local_last_changed_at = @lv_now
        WHERE pernr = @ls_stage-pernr
          AND work_date = @ls_stage-work_date.

      IF sy-subrc = 0.
        COMMIT WORK AND WAIT.
        gv_success = gv_success + 1.
      ELSE.
        ROLLBACK WORK.
        lv_error_message = 'Posting was rolled back because the staging status could not be updated.'.
        PERFORM mark_failure USING ls_stage lv_error_message p_retry.
        gv_failed = gv_failed + 1.
      ENDIF.
    ELSE.
      ROLLBACK WORK.
      PERFORM mark_failure USING ls_stage lv_error_message p_retry.
      gv_failed = gv_failed + 1.
    ENDIF.

    CALL FUNCTION 'BAPI_EMPLOYEE_DEQUEUE'
      EXPORTING
        number = ls_stage-pernr.
  ENDLOOP.

  WRITE: / |Eligible records: { lines( lt_stage ) }|,
         / |Successful: { gv_success }|,
         / |Failed or queued for retry: { gv_failed }|,
         / |Skipped after status recheck: { gv_skipped }|.

FORM mark_failure USING is_stage TYPE ztb_nxr_wt_stage
                        iv_message TYPE bapi_msg
                        iv_max_retry TYPE i.
  DATA:
    lv_timestamp     TYPE timestampl,
    lv_next_retry    TYPE timestampl,
    lv_attempt_count TYPE i,
    lv_status        TYPE c LENGTH 15,
    lv_message       TYPE c LENGTH 220.

  GET TIME STAMP FIELD lv_timestamp.
  lv_attempt_count = is_stage-attempt_count + 1.
  lv_message = COND #( WHEN iv_message IS INITIAL THEN 'Unknown SAP HR posting error.' ELSE iv_message ).

  IF lv_attempt_count >= iv_max_retry.
    lv_status = gc_error.
    CLEAR lv_next_retry.
  ELSE.
    lv_status = gc_retry.
    lv_next_retry = cl_abap_tstmp=>add( tstmp = lv_timestamp secs = 3600 ).
  ENDIF.

  UPDATE ztb_nxr_wt_stage
    SET sync_status = @lv_status,
        sync_message = @lv_message,
        attempt_count = @lv_attempt_count,
        next_retry_at = @lv_next_retry,
        last_changed_by = @sy-uname,
        last_changed_at = @lv_timestamp,
        local_last_changed_at = @lv_timestamp
    WHERE pernr = @is_stage-pernr
      AND work_date = @is_stage-work_date.
  COMMIT WORK AND WAIT.
ENDFORM.
