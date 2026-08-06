@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MyProfile Bank Value Help'
define view entity ZC_NXR_PROFILE_BANK_VH
  as select from bnka
{
  key banks as BankCountry,
  key bankl as BankKey,
      banka as BankName
}
