@EndUserText.label: 'MyProfile Apply Decision'
define abstract entity ZA_NXR_PROFAPPLY_DECISION
{
  @EndUserText.label: 'Decision By'
  DecisionBy      : abap.char( 255 );

  @EndUserText.label: 'Decision E-Mail'
  DecisionByEmail : abap.char( 255 );

  @EndUserText.label: 'Decision Personnel Number'
  DecisionPernr   : abap.numc( 8 );

  @EndUserText.label: 'HR Comment'
  HrComment       : abap.char( 500 );
}
