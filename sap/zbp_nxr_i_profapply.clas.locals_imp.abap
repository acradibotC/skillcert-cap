" No local behavior handler is required for the first staging version.
" The CAP approval flow posts Status/ApplyState/ApplyMessage directly when it
" creates ZC_NXR_PROFILE_APPLY_REQUEST. The background job is responsible for
" processing queued rows and updating ApplyState afterwards.
