@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MyProfile Display Projection'
define view entity ZC_NXR_PROFILE_DISPLAY
  as select from ZI_NXR_PROFILE_DISPLAY
{
  key UserId,
      Pernr,
      EmployeeName,
      DateOfBirth,
      Gender,
      Nationality,
      MaritalStatus,
      PositionId,
      PositionName,
      OrgUnitId,
      OrgUnitName,
      IdNumber,
      Telephone,
      PermanentAddress,
      WorkEmail,
      CurrentAddress,
      TaxCode,
      PayMethod,
      PayMethodText,
      BankCountry,
      BankKey,
      BankAccount,
      BankName,
      JoinDate,
      ContractType,
      DependentsSummary,
      IsManager
}
