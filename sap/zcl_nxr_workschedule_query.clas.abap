CLASS zcl_nxr_workschedule_query DEFINITION
  PUBLIC
  FINAL
  CREATE PUBLIC .
  PUBLIC SECTION.
    INTERFACES if_rap_query_provider.
ENDCLASS.

CLASS zcl_nxr_workschedule_query IMPLEMENTATION.
  METHOD if_rap_query_provider~select.
    DATA: lv_pernr TYPE pernr_d,
          lv_begda TYPE dats,
          lv_endda TYPE dats.

    TRY.
        DATA(lo_filter) = io_request->get_filter( ).
        IF lo_filter IS BOUND.
          DATA(lt_ranges) = lo_filter->get_as_ranges( ).
          DATA(lt_range_pernr) = VALUE #( lt_ranges[ name = 'PERNR' ]-range OPTIONAL ).
          DATA(lt_range_date)  = VALUE #( lt_ranges[ name = 'WORKDATE' ]-range OPTIONAL ).
          IF lt_range_pernr IS NOT INITIAL.
            lv_pernr = lt_range_pernr[ 1 ]-low.
          ENDIF.
          IF lt_range_date IS NOT INITIAL.
            lv_begda = lt_range_date[ 1 ]-low.
            lv_endda = lt_range_date[ 1 ]-high.
          ENDIF.
        ENDIF.
      CATCH cx_rap_query_filter_no_range.
    ENDTRY.

    IF lv_pernr IS INITIAL.
      SELECT SINGLE pernr FROM pa0105 INTO @lv_pernr
        WHERE subty = '0001'
          AND usrid = @sy-uname
          AND begda <= @sy-datum
          AND endda >= @sy-datum.
    ENDIF.
    IF lv_begda IS INITIAL.
      lv_begda = |{ sy-datum(4) }0101|.
    ENDIF.
    IF lv_endda IS INITIAL.
      lv_endda = |{ sy-datum(4) }1231|.
    ENDIF.

    DATA: lv_quota_entitlement TYPE p LENGTH 8 DECIMALS 3,
          lv_quota_used        TYPE p LENGTH 8 DECIMALS 3,
          lv_quota_remaining   TYPE p LENGTH 8 DECIMALS 3,
          lv_quota_begda       TYPE dats,
          lv_quota_endda       TYPE dats,
          lv_quota_type        TYPE ktart VALUE '01'.

    SELECT SINGLE anzhl, kverb, begda, endda
      FROM pa2006
      INTO (@lv_quota_entitlement, @lv_quota_used, @lv_quota_begda, @lv_quota_endda)
      WHERE pernr = @lv_pernr
        AND subty = @lv_quota_type
        AND begda <= @sy-datum
        AND endda >= @sy-datum.
    IF sy-subrc = 0.
      lv_quota_remaining = lv_quota_entitlement - lv_quota_used.
    ENDIF.

    DATA: lt_result TYPE TABLE OF zce_nxr_work_schedule,
          ls_result TYPE zce_nxr_work_schedule,
          lt_perws  TYPE TABLE OF ptpsp.

    IF lv_pernr IS NOT INITIAL.
      CALL FUNCTION 'HR_CHECK_AUTHORITY_INFTY'
        EXPORTING
          tclas            = 'A'
          pernr            = lv_pernr
          infty            = '2002'
          subty            = space
          begda            = lv_begda
          endda            = lv_endda
          level            = 'R'
        EXCEPTIONS
          no_authorization = 1
          OTHERS           = 2.

      IF sy-subrc = 0.
        CALL FUNCTION 'HR_PERSONAL_WORK_SCHEDULE'
          EXPORTING
            pernr         = lv_pernr
            begda         = lv_begda
            endda         = lv_endda
          TABLES
            perws         = lt_perws
          EXCEPTIONS
            error_occured = 1
            abort_occured = 2.

        IF sy-subrc = 0.
          SELECT SINGLE ename, orgeh FROM pa0001 INTO @DATA(ls_pa0001)
            WHERE pernr = @lv_pernr
              AND begda <= @sy-datum
              AND endda >= @sy-datum.

          LOOP AT lt_perws INTO DATA(ls_perws).
            CLEAR ls_result.
            ls_result-Pernr             = lv_pernr.
            ls_result-WorkDate          = ls_perws-datum.
            ls_result-ShiftCode         = ls_perws-tprog.
            ls_result-AttendanceStatus  = 0.
            ls_result-EmployeeName      = ls_pa0001-ename.
            ls_result-QuotaType         = lv_quota_type.
            ls_result-QuotaName         = 'Annual Leave'.
            ls_result-QuotaEntitlement  = lv_quota_entitlement.
            ls_result-QuotaUsed         = lv_quota_used.
            ls_result-QuotaRemaining     = lv_quota_remaining.
            ls_result-QuotaUnit         = 'DAY'.
            ls_result-QuotaValidFrom    = lv_quota_begda.
            ls_result-QuotaValidTo      = lv_quota_endda.

            SELECT SINGLE sobeg, soend FROM t550a INTO @DATA(ls_t550a)
              WHERE motpr = @ls_perws-motpr
                AND tprog = @ls_perws-tprog
                AND endda >= @ls_perws-datum
                AND begda <= @ls_perws-datum.
            IF sy-subrc = 0.
              ls_result-StartTime = ls_t550a-sobeg.
              ls_result-EndTime   = ls_t550a-soend.
            ENDIF.

            IF ls_perws-ftkla IS NOT INITIAL AND ls_perws-ftkla <> '0'.
              ls_result-IsHoliday = abap_true.
            ELSEIF ls_perws-tprog = 'OFF' OR ls_perws-tprog IS INITIAL.
              ls_result-AttendanceStatus = 0.
            ELSE.
              SELECT SINGLE subty, alldf, stdaz FROM pa2001 INTO @DATA(ls_pa2001)
                WHERE pernr = @lv_pernr
                  AND begda <= @ls_perws-datum
                  AND endda >= @ls_perws-datum.
              IF sy-subrc = 0.
                ls_result-LeaveType = ls_pa2001-subty.
                IF ls_pa2001-alldf = 'X'.
                  ls_result-AttendanceStatus = 4.
                ELSE.
                  ls_result-AttendanceStatus = 5.
                ENDIF.
              ELSEIF ls_perws-datum >= sy-datum.
                ls_result-AttendanceStatus = 0.
              ELSE.
                SELECT SINGLE beguz, enduz FROM pa2002 INTO @DATA(ls_pa2002)
                  WHERE pernr = @lv_pernr
                    AND begda <= @ls_perws-datum
                    AND endda >= @ls_perws-datum.
                IF sy-subrc <> 0.
                  ls_result-AttendanceStatus = 3.
                ELSE.
                  ls_result-ActualStartTime = ls_pa2002-beguz.
                  ls_result-ActualEndTime   = ls_pa2002-enduz.
                  IF ls_pa2002-beguz <= ls_result-StartTime AND ls_pa2002-enduz >= ls_result-EndTime.
                    ls_result-AttendanceStatus = 1.
                  ELSE.
                    ls_result-AttendanceStatus = 2.
                  ENDIF.
                ENDIF.
              ENDIF.
            ENDIF.
            APPEND ls_result TO lt_result.
          ENDLOOP.
        ENDIF.
      ENDIF.
    ENDIF.

    IF io_request->is_total_numb_of_rec_requested( ).
      io_response->set_total_number_of_records( CONV int8( lines( lt_result ) ) ).
    ENDIF.

    IF io_request->is_data_requested( ).
      DATA(lt_paged_result) = lt_result.
      DATA(lo_paging) = io_request->get_paging( ).
      IF lo_paging IS BOUND AND lo_paging->get_page_size( ) > 0.
        CLEAR lt_paged_result.
        DATA(lv_offset) = lo_paging->get_offset( ).
        DATA(lv_page_size) = lo_paging->get_page_size( ).
        IF lv_offset < lines( lt_result ).
          LOOP AT lt_result INTO ls_result FROM ( lv_offset + 1 ) TO ( lv_offset + lv_page_size ).
            APPEND ls_result TO lt_paged_result.
          ENDLOOP.
        ENDIF.
      ENDIF.
      io_response->set_data( lt_paged_result ).
    ENDIF.
  ENDMETHOD.
ENDCLASS.
