@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MyProfile Apply Request Projection'
define root view entity ZC_NXR_ProfileApplyRequest
  provider contract transactional_query
  as projection on ZI_NXR_ProfileApplyRequest
{
  key RequestId,
      RequestNo,
      Pernr,
      EmployeeName,
      RequestedByEmail,
      RevisionNo,
      Status,
      ApplyState,
      ApplyMessage,
      ChangedFields,
      IdNumber,
      Telephone,
      PermanentAddress,
      WorkEmail,
      CurrentAddress,
      TaxCode,
      PayMethod,
      BankCountry,
      BankKey,
      BankAccount,
      DecisionBy,
      DecisionByEmail,
      DecisionPernr,
      DecisionAt,
      HrComment,
      CreatedBy,
      CreatedAt,
      LastChangedBy,
      LastChangedAt,
      LocalLastChangedAt
}
