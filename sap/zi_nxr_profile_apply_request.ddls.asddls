@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MyProfile Apply Request'
define root view entity ZI_NXR_ProfileApplyRequest
  as select from ztb_nxr_profreq as Request
{
  key request_id            as RequestId,
      request_no            as RequestNo,
      pernr                 as Pernr,
      employee_name         as EmployeeName,
      requested_by_email    as RequestedByEmail,
      revision_no           as RevisionNo,
      status                as Status,
      apply_state           as ApplyState,
      apply_message         as ApplyMessage,
      changed_fields        as ChangedFields,
      id_number             as IdNumber,
      telephone             as Telephone,
      permanent_address     as PermanentAddress,
      work_email            as WorkEmail,
      current_address       as CurrentAddress,
      tax_code              as TaxCode,
      pay_method            as PayMethod,
      bank_country          as BankCountry,
      bank_key              as BankKey,
      bank_account          as BankAccount,
      decision_by           as DecisionBy,
      decision_by_email     as DecisionByEmail,
      decision_pernr        as DecisionPernr,
      decision_at           as DecisionAt,
      hr_comment            as HrComment,
      @Semantics.user.createdBy: true
      created_by            as CreatedBy,
      @Semantics.systemDateTime.createdAt: true
      created_at            as CreatedAt,
      @Semantics.user.lastChangedBy: true
      last_changed_by       as LastChangedBy,
      @Semantics.systemDateTime.lastChangedAt: true
      last_changed_at       as LastChangedAt,
      @Semantics.systemDateTime.localInstanceLastChangedAt: true
      local_last_changed_at as LocalLastChangedAt
}
