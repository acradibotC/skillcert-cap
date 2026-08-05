REPORT znxr_profile_apply_job.

PARAMETERS:
  p_test   TYPE abap_bool AS CHECKBOX DEFAULT abap_true,
  p_max    TYPE i DEFAULT 100,
  p_begda  TYPE d,
  p_mailty TYPE subty DEFAULT '0010',
  p_telty  TYPE subty DEFAULT 'CELL',
  p_paddr  TYPE subty DEFAULT '1',
  p_caddr  TYPE subty DEFAULT '2',
  p_land1  TYPE p0006-land1 DEFAULT 'VN',
  p_city   TYPE p0006-ort01 DEFAULT 'Unknown',
  p_bankty TYPE subty DEFAULT '0',
  p_idty   TYPE subty DEFAULT '01'.

CONSTANTS:
  gc_status_approved TYPE ztb_nxr_profreq-status VALUE '02',
  gc_state_queued     TYPE ztb_nxr_profreq-apply_state VALUE 'QUEUED',
  gc_state_processing TYPE ztb_nxr_profreq-apply_state VALUE 'PROCESSING',
  gc_state_applied    TYPE ztb_nxr_profreq-apply_state VALUE 'APPLIED',
  gc_state_failed     TYPE ztb_nxr_profreq-apply_state VALUE 'FAILED',
  gc_endda            TYPE endda VALUE '99991231',
  gc_infty_0006       TYPE infty VALUE '0006',
  gc_infty_0009       TYPE infty VALUE '0009',
  gc_infty_0105       TYPE infty VALUE '0105',
  gc_infty_0185       TYPE infty VALUE '0185'.

TYPES tt_field TYPE STANDARD TABLE OF string WITH EMPTY KEY.

DATA:
  gv_success TYPE i,
  gv_failed  TYPE i,
  gv_skipped TYPE i.

INITIALIZATION.
  p_begda = sy-datum.

START-OF-SELECTION.
  IF p_max <= 0.
    MESSAGE 'Maximum rows must be greater than zero.' TYPE 'E'.
  ENDIF.

  DATA lv_now TYPE timestampl.
  GET TIME STAMP FIELD lv_now.

  DATA lt_requests TYPE STANDARD TABLE OF ztb_nxr_profreq WITH EMPTY KEY.
  SELECT *
    FROM ztb_nxr_profreq
    WHERE status      = @gc_status_approved
      AND apply_state = @gc_state_queued
    ORDER BY last_changed_at, created_at
    INTO TABLE @lt_requests
    UP TO @p_max ROWS.

  IF lt_requests IS INITIAL.
    WRITE: / 'No approved queued MyProfile apply requests found.'.
    RETURN.
  ENDIF.

  LOOP AT lt_requests INTO DATA(ls_candidate).
    DATA(lv_processing_message) =
      |Processing request { ls_candidate-request_no } for PERNR { ls_candidate-pernr }|.

    GET TIME STAMP FIELD lv_now.
    UPDATE ztb_nxr_profreq
      SET apply_state           = @gc_state_processing,
          apply_message         = @lv_processing_message,
          last_changed_by       = @sy-uname,
          last_changed_at       = @lv_now,
          local_last_changed_at = @lv_now
      WHERE request_id  = @ls_candidate-request_id
        AND status      = @gc_status_approved
        AND apply_state = @gc_state_queued.

    IF sy-subrc <> 0.
      gv_skipped = gv_skipped + 1.
      WRITE: / 'Skipped request because it was already picked by another run:',
               ls_candidate-request_no.
      CONTINUE.
    ENDIF.

    COMMIT WORK AND WAIT.

    DATA:
      lt_fields  TYPE tt_field,
      lv_ok      TYPE abap_bool VALUE abap_true,
      lv_message TYPE ztb_nxr_profreq-apply_message.

    CLEAR: lt_fields, lv_message.
    PERFORM get_changed_fields USING ls_candidate CHANGING lt_fields.
    PERFORM validate_fields USING lt_fields CHANGING lv_ok lv_message.

    IF lv_ok = abap_false.
      IF p_test = abap_true.
        lv_message = |Simulation failed: { lv_message }|.
        PERFORM mark_state USING ls_candidate gc_state_queued lv_message.
        WRITE: / 'Simulation failed:', ls_candidate-request_no, lv_message.
      ELSE.
        PERFORM mark_state USING ls_candidate gc_state_failed lv_message.
        WRITE: / 'Failed:', ls_candidate-request_no, lv_message.
        gv_failed = gv_failed + 1.
      ENDIF.
      CONTINUE.
    ENDIF.

    IF p_test = abap_true.
      lv_message = |Simulation OK. Fields: { ls_candidate-changed_fields }|.
      PERFORM mark_state USING ls_candidate gc_state_queued lv_message.
      WRITE: / 'Simulation:', ls_candidate-request_no, ls_candidate-pernr,
               ls_candidate-changed_fields.
      CONTINUE.
    ENDIF.

    DATA ls_lock_return TYPE bapireturn1.
    CLEAR ls_lock_return.
    CALL FUNCTION 'BAPI_EMPLOYEE_ENQUEUE'
      EXPORTING
        number = ls_candidate-pernr
      IMPORTING
        return = ls_lock_return.

    IF ls_lock_return-type CA 'AEX'.
      lv_message = ls_lock_return-message.
      PERFORM mark_state USING ls_candidate gc_state_failed lv_message.
      gv_failed = gv_failed + 1.
      WRITE: / 'Failed:', ls_candidate-request_no, lv_message.
      CONTINUE.
    ENDIF.

    CLEAR lv_message.
    PERFORM apply_profile_request USING ls_candidate lt_fields CHANGING lv_ok lv_message.

    IF lv_ok = abap_true.
      GET TIME STAMP FIELD lv_now.
      lv_message = COND ztb_nxr_profreq-apply_message(
        WHEN lv_message IS INITIAL THEN 'Applied to SAP HR master data.'
        ELSE lv_message ).

      UPDATE ztb_nxr_profreq
        SET apply_state           = @gc_state_applied,
            apply_message         = @lv_message,
            last_changed_by       = @sy-uname,
            last_changed_at       = @lv_now,
            local_last_changed_at = @lv_now
        WHERE request_id = @ls_candidate-request_id
          AND apply_state = @gc_state_processing.

      IF sy-subrc = 0.
        COMMIT WORK AND WAIT.
        gv_success = gv_success + 1.
        WRITE: / 'Applied:', ls_candidate-request_no, ls_candidate-pernr.
      ELSE.
        ROLLBACK WORK.
        lv_message = 'Posting rolled back because staging status could not be updated to APPLIED.'.
        PERFORM mark_state USING ls_candidate gc_state_failed lv_message.
        gv_failed = gv_failed + 1.
        WRITE: / 'Failed:', ls_candidate-request_no, lv_message.
      ENDIF.
    ELSE.
      ROLLBACK WORK.
      PERFORM mark_state USING ls_candidate gc_state_failed lv_message.
      gv_failed = gv_failed + 1.
      WRITE: / 'Failed:', ls_candidate-request_no, lv_message.
    ENDIF.

    CALL FUNCTION 'BAPI_EMPLOYEE_DEQUEUE'
      EXPORTING
        number = ls_candidate-pernr.
  ENDLOOP.

  WRITE: / |Eligible records: { lines( lt_requests ) }|,
         / |Applied: { gv_success }|,
         / |Failed: { gv_failed }|,
         / |Skipped: { gv_skipped }|.

FORM get_changed_fields USING is_request TYPE ztb_nxr_profreq
                        CHANGING ct_fields TYPE tt_field.
  DATA lt_raw TYPE STANDARD TABLE OF string WITH EMPTY KEY.
  SPLIT is_request-changed_fields AT ',' INTO TABLE lt_raw.

  LOOP AT lt_raw INTO DATA(lv_field).
    CONDENSE lv_field.
    TRANSLATE lv_field TO UPPER CASE.
    IF lv_field IS NOT INITIAL.
      APPEND lv_field TO ct_fields.
    ENDIF.
  ENDLOOP.

  IF ct_fields IS NOT INITIAL.
    RETURN.
  ENDIF.

  IF is_request-id_number IS NOT INITIAL.
    APPEND 'ID_NUMBER' TO ct_fields.
  ENDIF.
  IF is_request-telephone IS NOT INITIAL.
    APPEND 'TELEPHONE' TO ct_fields.
  ENDIF.
  IF is_request-permanent_address IS NOT INITIAL.
    APPEND 'ADDRESS' TO ct_fields.
  ENDIF.
  IF is_request-work_email IS NOT INITIAL.
    APPEND 'WORK_EMAIL' TO ct_fields.
  ENDIF.
  IF is_request-current_address IS NOT INITIAL.
    APPEND 'CURR_ADDRESS' TO ct_fields.
  ENDIF.
  IF is_request-pay_method IS NOT INITIAL.
    APPEND 'PAY_METHOD' TO ct_fields.
  ENDIF.
  IF is_request-bank_country IS NOT INITIAL.
    APPEND 'BANK_COUNTRY' TO ct_fields.
  ENDIF.
  IF is_request-bank_key IS NOT INITIAL.
    APPEND 'BANK_KEY' TO ct_fields.
  ENDIF.
  IF is_request-bank_account IS NOT INITIAL.
    APPEND 'BANK_ACCT' TO ct_fields.
  ENDIF.
ENDFORM.

FORM validate_fields USING it_fields TYPE tt_field
                  CHANGING cv_ok TYPE abap_bool
                           cv_message TYPE ztb_nxr_profreq-apply_message.
  cv_ok = abap_true.
  CLEAR cv_message.

  IF it_fields IS INITIAL.
    cv_ok = abap_false.
    cv_message = 'No changed fields were supplied by the profile request.'.
    RETURN.
  ENDIF.

  LOOP AT it_fields INTO DATA(lv_field).
    CASE lv_field.
      WHEN 'ID_NUMBER'
        OR 'TELEPHONE'
        OR 'ADDRESS'
        OR 'WORK_EMAIL'
        OR 'CURR_ADDRESS'
        OR 'PAY_METHOD'
        OR 'BANK_COUNTRY'
        OR 'BANK_KEY'
        OR 'BANK_ACCT'.
        CONTINUE.
      WHEN 'TAX_CODE'.
        cv_ok = abap_false.
        cv_message = 'TAX_CODE has no approved SAP infotype target in this job yet.'.
        RETURN.
      WHEN OTHERS.
        cv_ok = abap_false.
        cv_message = |Unsupported MyProfile field { lv_field }.|.
        RETURN.
    ENDCASE.
  ENDLOOP.
ENDFORM.

FORM has_field USING it_fields TYPE tt_field
                     iv_field  TYPE string
            CHANGING cv_found  TYPE abap_bool.
  READ TABLE it_fields WITH KEY table_line = iv_field TRANSPORTING NO FIELDS.
  cv_found = xsdbool( sy-subrc = 0 ).
ENDFORM.

FORM apply_profile_request USING is_request TYPE ztb_nxr_profreq
                                 it_fields  TYPE tt_field
                        CHANGING cv_ok TYPE abap_bool
                                 cv_message TYPE ztb_nxr_profreq-apply_message.
  DATA lv_has TYPE abap_bool.
  cv_ok = abap_true.
  CLEAR cv_message.

  PERFORM has_field USING it_fields 'TELEPHONE' CHANGING lv_has.
  IF lv_has = abap_true AND cv_ok = abap_true.
    PERFORM apply_0105 USING is_request
                             p_telty
                             'TELEPHONE'
                             is_request-telephone
                       CHANGING cv_ok cv_message.
  ENDIF.

  PERFORM has_field USING it_fields 'WORK_EMAIL' CHANGING lv_has.
  IF lv_has = abap_true AND cv_ok = abap_true.
    PERFORM apply_0105 USING is_request
                             p_mailty
                             'WORK_EMAIL'
                             is_request-work_email
                       CHANGING cv_ok cv_message.
  ENDIF.

  PERFORM has_field USING it_fields 'ADDRESS' CHANGING lv_has.
  IF lv_has = abap_true AND cv_ok = abap_true.
    PERFORM apply_0006 USING is_request
                             p_paddr
                             is_request-permanent_address
                       CHANGING cv_ok cv_message.
  ENDIF.

  PERFORM has_field USING it_fields 'CURR_ADDRESS' CHANGING lv_has.
  IF lv_has = abap_true AND cv_ok = abap_true.
    PERFORM apply_0006 USING is_request
                             p_caddr
                             is_request-current_address
                       CHANGING cv_ok cv_message.
  ENDIF.

  IF cv_ok = abap_true.
    DATA(lv_bank_requested) = abap_false.
    PERFORM has_field USING it_fields 'PAY_METHOD' CHANGING lv_has.
    IF lv_has = abap_true.
      lv_bank_requested = abap_true.
    ENDIF.
    PERFORM has_field USING it_fields 'BANK_COUNTRY' CHANGING lv_has.
    IF lv_has = abap_true.
      lv_bank_requested = abap_true.
    ENDIF.
    PERFORM has_field USING it_fields 'BANK_KEY' CHANGING lv_has.
    IF lv_has = abap_true.
      lv_bank_requested = abap_true.
    ENDIF.
    PERFORM has_field USING it_fields 'BANK_ACCT' CHANGING lv_has.
    IF lv_has = abap_true.
      lv_bank_requested = abap_true.
    ENDIF.

    IF lv_bank_requested = abap_true.
      PERFORM apply_0009 USING is_request it_fields CHANGING cv_ok cv_message.
    ENDIF.
  ENDIF.

  PERFORM has_field USING it_fields 'ID_NUMBER' CHANGING lv_has.
  IF lv_has = abap_true AND cv_ok = abap_true.
    PERFORM apply_0185 USING is_request CHANGING cv_ok cv_message.
  ENDIF.

  IF cv_ok = abap_true.
    cv_message = 'Applied requested MyProfile fields to SAP HR master data.'.
  ENDIF.
ENDFORM.

FORM apply_0105 USING is_request TYPE ztb_nxr_profreq
                      iv_subty   TYPE subty
                      iv_field   TYPE string
                      iv_value   TYPE any
             CHANGING cv_ok TYPE abap_bool
                      cv_message TYPE ztb_nxr_profreq-apply_message.
  DATA:
    ls_pa0105_db TYPE pa0105,
    ls_p0105     TYPE p0105,
    ls_return    TYPE bapireturn1,
    ls_key       TYPE bapipakey,
    lv_operation TYPE pspar-actio,
    lv_seqnr     TYPE seqnr,
    lv_begda     TYPE begda,
    lv_endda     TYPE endda.

  CLEAR: ls_pa0105_db, ls_p0105, ls_return, ls_key,
         lv_operation, lv_seqnr, lv_begda, lv_endda.

  SELECT *
    FROM pa0105
    WHERE pernr = @is_request-pernr
      AND subty = @iv_subty
      AND sprps = @space
      AND begda <= @p_begda
      AND endda >= @p_begda
    ORDER BY endda DESCENDING, begda DESCENDING, seqnr DESCENDING
    INTO @ls_pa0105_db
    UP TO 1 ROWS.
  ENDSELECT.

  IF sy-subrc = 0.
    MOVE-CORRESPONDING ls_pa0105_db TO ls_p0105.
    lv_operation = 'MOD'.
    lv_seqnr = ls_pa0105_db-seqnr.
    lv_begda = ls_pa0105_db-begda.
    lv_endda = ls_pa0105_db-endda.
  ELSE.
    lv_operation = 'INS'.
    lv_begda = p_begda.
    lv_endda = gc_endda.
  ENDIF.

  ls_p0105-pernr = is_request-pernr.
  ls_p0105-infty = gc_infty_0105.
  ls_p0105-subty = iv_subty.
  ls_p0105-begda = lv_begda.
  ls_p0105-endda = lv_endda.

  IF iv_field = 'WORK_EMAIL'.
    ls_p0105-usrid = iv_value.
    ls_p0105-usrid_long = iv_value.
  ELSE.
    ls_p0105-usrid = iv_value.
  ENDIF.

  CALL FUNCTION 'HR_INFOTYPE_OPERATION'
    EXPORTING
      infty         = gc_infty_0105
      number        = is_request-pernr
      subtype       = iv_subty
      validityend   = lv_endda
      validitybegin = lv_begda
      recordnumber  = lv_seqnr
      record        = ls_p0105
      operation     = lv_operation
      tclas         = 'A'
      dialog_mode   = '0'
      nocommit      = abap_true
    IMPORTING
      return        = ls_return
      key           = ls_key.

  DATA(lv_context) = |PA0105 { iv_subty } { iv_field }|.
  PERFORM normalize_return USING ls_return lv_context CHANGING cv_ok cv_message.
ENDFORM.

FORM apply_0006 USING is_request TYPE ztb_nxr_profreq
                      iv_subty   TYPE subty
                      iv_address TYPE any
             CHANGING cv_ok TYPE abap_bool
                      cv_message TYPE ztb_nxr_profreq-apply_message.
  DATA:
    ls_pa0006_db TYPE pa0006,
    ls_p0006     TYPE p0006,
    ls_return    TYPE bapireturn1,
    ls_key       TYPE bapipakey,
    lv_operation TYPE pspar-actio,
    lv_seqnr     TYPE seqnr,
    lv_begda     TYPE begda,
    lv_endda     TYPE endda,
    lv_address   TYPE string,
    lv_city      TYPE string,
    lv_part_count TYPE i,
    lt_parts     TYPE STANDARD TABLE OF string WITH EMPTY KEY.

  CLEAR: ls_pa0006_db, ls_p0006, ls_return, ls_key,
         lv_operation, lv_seqnr, lv_begda, lv_endda.

  SELECT *
    FROM pa0006
    WHERE pernr = @is_request-pernr
      AND subty = @iv_subty
      AND sprps = @space
      AND begda <= @p_begda
      AND endda >= @p_begda
    ORDER BY endda DESCENDING, begda DESCENDING, seqnr DESCENDING
    INTO @ls_pa0006_db
    UP TO 1 ROWS.
  ENDSELECT.

  IF sy-subrc = 0.
    MOVE-CORRESPONDING ls_pa0006_db TO ls_p0006.
    lv_operation = 'MOD'.
    lv_seqnr = ls_pa0006_db-seqnr.
    lv_begda = ls_pa0006_db-begda.
    lv_endda = ls_pa0006_db-endda.
  ELSE.
    lv_operation = 'INS'.
    lv_begda = p_begda.
    lv_endda = gc_endda.
  ENDIF.

  lv_address = iv_address.
  CONDENSE lv_address.
  SPLIT lv_address AT ',' INTO TABLE lt_parts.
  lv_part_count = lines( lt_parts ).
  READ TABLE lt_parts INTO lv_city INDEX lv_part_count.
  CONDENSE lv_city.
  IF lv_city IS INITIAL.
    lv_city = lv_address.
  ENDIF.
  IF lv_city IS INITIAL.
    lv_city = p_city.
  ENDIF.

  ls_p0006-pernr = is_request-pernr.
  ls_p0006-infty = gc_infty_0006.
  ls_p0006-subty = iv_subty.
  ls_p0006-anssa = iv_subty.
  ls_p0006-begda = lv_begda.
  ls_p0006-endda = lv_endda.
  ls_p0006-stras = lv_address.
  IF ls_p0006-land1 IS INITIAL.
    ls_p0006-land1 = p_land1.
  ENDIF.
  IF ls_p0006-ort01 IS INITIAL.
    ls_p0006-ort01 = lv_city.
  ENDIF.

  CALL FUNCTION 'HR_INFOTYPE_OPERATION'
    EXPORTING
      infty         = gc_infty_0006
      number        = is_request-pernr
      subtype       = iv_subty
      validityend   = lv_endda
      validitybegin = lv_begda
      recordnumber  = lv_seqnr
      record        = ls_p0006
      operation     = lv_operation
      tclas         = 'A'
      dialog_mode   = '0'
      nocommit      = abap_true
    IMPORTING
      return        = ls_return
      key           = ls_key.

  DATA(lv_context) = |PA0006 { iv_subty } STRAS|.
  PERFORM normalize_return USING ls_return lv_context CHANGING cv_ok cv_message.
ENDFORM.

FORM apply_0009 USING is_request TYPE ztb_nxr_profreq
                      it_fields  TYPE tt_field
             CHANGING cv_ok TYPE abap_bool
                      cv_message TYPE ztb_nxr_profreq-apply_message.
  DATA:
    ls_pa0009_db TYPE pa0009,
    ls_p0009     TYPE p0009,
    ls_return    TYPE bapireturn1,
    ls_key       TYPE bapipakey,
    lv_operation TYPE pspar-actio,
    lv_seqnr     TYPE seqnr,
    lv_begda     TYPE begda,
    lv_endda     TYPE endda,
    lv_has       TYPE abap_bool.

  CLEAR: ls_pa0009_db, ls_p0009, ls_return, ls_key,
         lv_operation, lv_seqnr, lv_begda, lv_endda, lv_has.

  SELECT *
    FROM pa0009
    WHERE pernr = @is_request-pernr
      AND subty = @p_bankty
      AND sprps = @space
      AND begda <= @p_begda
      AND endda >= @p_begda
    ORDER BY endda DESCENDING, begda DESCENDING, seqnr DESCENDING
    INTO @ls_pa0009_db
    UP TO 1 ROWS.
  ENDSELECT.

  IF sy-subrc = 0.
    MOVE-CORRESPONDING ls_pa0009_db TO ls_p0009.
    lv_operation = 'MOD'.
    lv_seqnr = ls_pa0009_db-seqnr.
    lv_begda = ls_pa0009_db-begda.
    lv_endda = ls_pa0009_db-endda.
  ELSE.
    lv_operation = 'INS'.
    lv_begda = p_begda.
    lv_endda = gc_endda.
  ENDIF.

  ls_p0009-pernr = is_request-pernr.
  ls_p0009-infty = gc_infty_0009.
  ls_p0009-subty = p_bankty.
  ls_p0009-begda = lv_begda.
  ls_p0009-endda = lv_endda.

  PERFORM has_field USING it_fields 'PAY_METHOD' CHANGING lv_has.
  IF lv_has = abap_true.
    ls_p0009-zlsch = is_request-pay_method.
  ENDIF.
  PERFORM has_field USING it_fields 'BANK_COUNTRY' CHANGING lv_has.
  IF lv_has = abap_true.
    ls_p0009-banks = is_request-bank_country.
  ENDIF.
  PERFORM has_field USING it_fields 'BANK_KEY' CHANGING lv_has.
  IF lv_has = abap_true.
    ls_p0009-bankl = is_request-bank_key.
  ENDIF.
  PERFORM has_field USING it_fields 'BANK_ACCT' CHANGING lv_has.
  IF lv_has = abap_true.
    ls_p0009-bankn = is_request-bank_account.
  ENDIF.

  CALL FUNCTION 'HR_INFOTYPE_OPERATION'
    EXPORTING
      infty         = gc_infty_0009
      number        = is_request-pernr
      subtype       = p_bankty
      validityend   = lv_endda
      validitybegin = lv_begda
      recordnumber  = lv_seqnr
      record        = ls_p0009
      operation     = lv_operation
      tclas         = 'A'
      dialog_mode   = '0'
      nocommit      = abap_true
    IMPORTING
      return        = ls_return
      key           = ls_key.

  DATA(lv_context) = |PA0009 { p_bankty } bank details|.
  PERFORM normalize_return USING ls_return lv_context CHANGING cv_ok cv_message.
ENDFORM.

FORM apply_0185 USING is_request TYPE ztb_nxr_profreq
             CHANGING cv_ok TYPE abap_bool
                      cv_message TYPE ztb_nxr_profreq-apply_message.
  DATA:
    ls_pa0185_db TYPE pa0185,
    ls_p0185     TYPE p0185,
    ls_return    TYPE bapireturn1,
    ls_key       TYPE bapipakey,
    lv_operation TYPE pspar-actio,
    lv_seqnr     TYPE seqnr,
    lv_begda     TYPE begda,
    lv_endda     TYPE endda.

  CLEAR: ls_pa0185_db, ls_p0185, ls_return, ls_key,
         lv_operation, lv_seqnr, lv_begda, lv_endda.

  SELECT *
    FROM pa0185
    WHERE pernr = @is_request-pernr
      AND subty = @p_idty
      AND sprps = @space
      AND begda <= @p_begda
      AND endda >= @p_begda
    ORDER BY endda DESCENDING, begda DESCENDING, seqnr DESCENDING
    INTO @ls_pa0185_db
    UP TO 1 ROWS.
  ENDSELECT.

  IF sy-subrc = 0.
    MOVE-CORRESPONDING ls_pa0185_db TO ls_p0185.
    lv_operation = 'MOD'.
    lv_seqnr = ls_pa0185_db-seqnr.
    lv_begda = ls_pa0185_db-begda.
    lv_endda = ls_pa0185_db-endda.
  ELSE.
    lv_operation = 'INS'.
    lv_begda = p_begda.
    lv_endda = gc_endda.
  ENDIF.

  ls_p0185-pernr = is_request-pernr.
  ls_p0185-infty = gc_infty_0185.
  ls_p0185-subty = p_idty.
  ls_p0185-begda = lv_begda.
  ls_p0185-endda = lv_endda.
  ls_p0185-icnum = is_request-id_number.

  CALL FUNCTION 'HR_INFOTYPE_OPERATION'
    EXPORTING
      infty         = gc_infty_0185
      number        = is_request-pernr
      subtype       = p_idty
      validityend   = lv_endda
      validitybegin = lv_begda
      recordnumber  = lv_seqnr
      record        = ls_p0185
      operation     = lv_operation
      tclas         = 'A'
      dialog_mode   = '0'
      nocommit      = abap_true
    IMPORTING
      return        = ls_return
      key           = ls_key.

  DATA(lv_context) = |PA0185 { p_idty } ICNUM|.
  PERFORM normalize_return USING ls_return lv_context CHANGING cv_ok cv_message.
ENDFORM.

FORM normalize_return USING is_return TYPE bapireturn1
                            iv_context TYPE string
                   CHANGING cv_ok TYPE abap_bool
                            cv_message TYPE ztb_nxr_profreq-apply_message.
  IF is_return-type CA 'AEX'.
    cv_ok = abap_false.
    cv_message = COND ztb_nxr_profreq-apply_message(
      WHEN is_return-message IS INITIAL THEN |{ iv_context } failed in HR_INFOTYPE_OPERATION.|
      ELSE |{ iv_context }: { is_return-message }| ).
  ELSE.
    cv_ok = abap_true.
    IF cv_message IS INITIAL.
      cv_message = |{ iv_context } posted successfully.|.
    ENDIF.
  ENDIF.
ENDFORM.

FORM mark_state USING is_request TYPE ztb_nxr_profreq
                      iv_state   TYPE ztb_nxr_profreq-apply_state
                      iv_message TYPE any.
  DATA:
    lv_timestamp TYPE timestampl,
    lv_message   TYPE ztb_nxr_profreq-apply_message.

  GET TIME STAMP FIELD lv_timestamp.
  lv_message = iv_message.

  UPDATE ztb_nxr_profreq
    SET apply_state           = @iv_state,
        apply_message         = @lv_message,
        last_changed_by       = @sy-uname,
        last_changed_at       = @lv_timestamp,
        local_last_changed_at = @lv_timestamp
    WHERE request_id = @is_request-request_id.
  COMMIT WORK AND WAIT.
ENDFORM.
