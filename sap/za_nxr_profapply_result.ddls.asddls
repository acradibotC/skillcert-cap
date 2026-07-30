@EndUserText.label: 'MyProfile Apply Result'
define abstract entity ZA_NXR_PROFAPPLY_RESULT
{
  @EndUserText.label: 'Applied'
  Applied      : abap_boolean;

  @EndUserText.label: 'Message'
  Message      : abap.char( 500 );

  @EndUserText.label: 'SAP Trace Id'
  SapRequestId : abap.char( 64 );
}
