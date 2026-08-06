@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'MyProfile Marital Status Value Help'
define view entity ZC_NXR_PROFILE_MARITAL_VH
  as select from t502t
{
  key famst as MaritalStatusCode,
  key sprsl as Language,
      ftext as MaritalStatusText
}
