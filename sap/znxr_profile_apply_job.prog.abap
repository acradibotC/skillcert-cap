REPORT znxr_profile_apply_job.

PARAMETERS p_test TYPE abap_bool AS CHECKBOX DEFAULT abap_true.

CONSTANTS:
  gc_state_queued     TYPE ztb_nxr_profreq-apply_state VALUE 'QUEUED',
  gc_state_processing TYPE ztb_nxr_profreq-apply_state VALUE 'PROCESSING',
  gc_state_applied    TYPE ztb_nxr_profreq-apply_state VALUE 'APPLIED',
  gc_state_failed     TYPE ztb_nxr_profreq-apply_state VALUE 'FAILED'.

START-OF-SELECTION.
  GET TIME STAMP FIELD DATA(now_utc).

  SELECT *
    FROM ztb_nxr_profreq
    WHERE apply_state = @gc_state_queued
    ORDER BY created_at
    INTO TABLE @DATA(queued_requests).

  IF queued_requests IS INITIAL.
    WRITE: / 'No queued MyProfile apply requests found.'.
    RETURN.
  ENDIF.

  LOOP AT queued_requests ASSIGNING FIELD-SYMBOL(<request>).
    DATA(message) = |Queued request { <request>-request_no } for PERNR { <request>-pernr }|.

    UPDATE ztb_nxr_profreq
      SET apply_state = @gc_state_processing,
          apply_message = @message,
          last_changed_by = @sy-uname,
          last_changed_at = @now_utc,
          local_last_changed_at = @now_utc
      WHERE request_id = @<request>-request_id
        AND apply_state = @gc_state_queued.

    IF sy-subrc <> 0.
      WRITE: / 'Skipped request because it was already picked by another run:', <request>-request_no.
      CONTINUE.
    ENDIF.

    COMMIT WORK AND WAIT.

    TRY.
        IF p_test = abap_true.
          message = |Simulation only. Fields: { <request>-changed_fields }|.
          UPDATE ztb_nxr_profreq
            SET apply_state = @gc_state_queued,
                apply_message = @message,
                last_changed_by = @sy-uname,
                last_changed_at = @now_utc,
                local_last_changed_at = @now_utc
            WHERE request_id = @<request>-request_id.
          COMMIT WORK AND WAIT.
          WRITE: / 'Simulation:', <request>-request_no, <request>-pernr, <request>-changed_fields.
          CONTINUE.
        ENDIF.

        " Intentionally deferred:
        " Map <request>-changed_fields to the approved HR infotype API/FM.
        " Candidate infotypes from the frontend contract:
        " - PA0006: permanent/current address fields
        " - PA0009: payment method and bank fields
        " - PA0105: work e-mail / telephone
        " - PA0185: identification number
        "
        " Keep this posting logic in the background job so the RAP OData request
        " only persists the approved audit/staging row and never performs a long
        " chain of infotype updates synchronously.
        message = 'HR master-data posting FM is not configured for this job yet.'.
        UPDATE ztb_nxr_profreq
          SET apply_state = @gc_state_failed,
              apply_message = @message,
              last_changed_by = @sy-uname,
              last_changed_at = @now_utc,
              local_last_changed_at = @now_utc
          WHERE request_id = @<request>-request_id.
        COMMIT WORK AND WAIT.
        WRITE: / 'Failed:', <request>-request_no, message.

      CATCH cx_root INTO DATA(error).
        message = error->get_text( ).
        UPDATE ztb_nxr_profreq
          SET apply_state = @gc_state_failed,
              apply_message = @message,
              last_changed_by = @sy-uname,
              last_changed_at = @now_utc,
              local_last_changed_at = @now_utc
          WHERE request_id = @<request>-request_id.
        COMMIT WORK AND WAIT.
        WRITE: / 'Failed:', <request>-request_no, message.
    ENDTRY.
  ENDLOOP.
