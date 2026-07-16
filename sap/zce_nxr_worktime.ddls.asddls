@AccessControl.authorizationCheck: #NOT_REQUIRED
@EndUserText.label: 'HR Work Time Import Staging'
define root view entity ZCE_NXR_WORKTIME
  as select from ztb_nxr_wt_stage
{
  key pernr                 as Pernr,
  key work_date             as WorkDate,
      first_entry           as FirstEntry,
      last_exit             as LastExit,
      iot                   as Iot,
      iotwf                 as Iotwf,
      iwa                   as Iwa,
      number_of_entry       as NumberOfEntry,
      number_of_exit        as NumberOfExit,
      request_type          as RequestType,
      request_status        as RequestStatus,
      import_batch_id       as ImportBatchId,
      source_file_name      as SourceFileName,
      sync_status           as SyncStatus,
      sync_message          as SyncMessage,
      attempt_count         as AttemptCount,
      next_retry_at         as NextRetryAt,
      sap_document_key      as SapDocumentKey,
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
