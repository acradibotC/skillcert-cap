const cds = require('@sap/cds');

module.exports = {
    SkillService: async function() {
        const external = await cds.connect.to('ZUI_NXR_SKILLREQ_O4');

        // Mock Z-table for email -> pernr mapping
    const emailToPernr = {
        'test@gmail.com': '00000271',
        'anhnt3@fpt.com': '00000271'
    };

    const getPernr = (req) => {
        const email = req.user && req.user.emails && req.user.emails[0].value ? req.user.emails[0].value : 'test@gmail.com';
        return emailToPernr[email] || '00000271';
    };

    // Forwarding logic to S/4HANA OData V4 service
    this.on('READ', ['Request', 'UserProfile', 'TeamMembers', 'QualificationCatalog'], async (req) => {
        // Enforce security: we could modify the query here to force Pernr
        // But for proxying to work simply, we just forward
        return external.run(req.query);
    });

    this.on('READ', 'certSources', () => {
        return [
            { "key": "Coursera", "text": "Coursera" },
            { "key": "Udemy", "text": "Udemy" },
            { "key": "SAP Learning Hub", "text": "SAP Learning Hub" },
            { "key": "LinkedIn Learning", "text": "LinkedIn Learning" },
            { "key": "AWS Training", "text": "AWS Training" },
            { "key": "Google Skillshop", "text": "Google Skillshop" },
            { "key": "Microsoft Learn", "text": "Microsoft Learn" },
            { "key": "Offline Training", "text": "Đào tạo trực tiếp" },
            { "key": "Other", "text": "Khác" }
        ];
    });

    this.on(['CREATE', 'UPDATE', 'DELETE'], 'Request', async (req) => {
        return external.run(req.query);
    });

    this.on('approveRequest', async (req) => {
        // In OData V4 bound actions, the path might need to be resolved.
        // We use external.send
        return external.send({
            method: 'POST',
            path: `/Request(RequestId=${req.data.RequestId})/com.sap.gateway.srvd.zui_nxr_skillreq_o4.v0001.approveRequest`
        });
    });

        this.on('rejectRequest', async (req) => {
            return external.send({
                method: 'POST',
                path: `/Request(RequestId=${req.data.RequestId})/com.sap.gateway.srvd.zui_nxr_skillreq_o4.v0001.rejectRequest`,
                data: { RejectionReason: req.data.RejectionReason }
            });
        });
    },

    CalendarService: async function() {
        const calExternal = await cds.connect.to('ZUI_NXR_WORKSCHEDULE_O4');

        this.on('READ', 'WorkSchedule', async (req) => {
            return calExternal.run(req.query);
        });
    },

    // ================================================================
    // AttendanceService — Proxy to S/4HANA RAP BO
    // ================================================================
    AttendanceService: async function() {
        const { AttendanceRequest } = this.entities;
        const skillSrv = await cds.connect.to('ZUI_NXR_SKILLREQ_O4');
        const attExternal = await cds.connect.to('ZUI_NXR_ATTREQ_O4');
        const axios = require('axios');

        // SAP OData V4 base URL and credentials
        const SAP_BASE_URL = cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials.url;
        const SAP_USER = process.env.UI5_USERNAME || 'DEV-271';
        const SAP_PASS = process.env.UI5_PASSWORD || 'Hanoi@12345';
        const SAP_AUTH = 'Basic ' + Buffer.from(SAP_USER + ':' + SAP_PASS).toString('base64');

        // Helper: Fetch CSRF token from SAP via GET with x-csrf-token: Fetch header
        async function fetchCsrfToken() {
            const resp = await axios.get(SAP_BASE_URL + '/', {
                headers: {
                    'Authorization': SAP_AUTH,
                    'x-csrf-token': 'Fetch',
                    'Accept': 'application/json'
                },
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
            });
            const token = resp.headers['x-csrf-token'];
            const cookies = resp.headers['set-cookie'];
            return { token, cookies };
        }

        // Helper: POST to SAP with CSRF token
        async function sapPost(path, data) {
            const { token, cookies } = await fetchCsrfToken();
            const resp = await axios.post(SAP_BASE_URL + '/' + path, data, {
                headers: {
                    'Authorization': SAP_AUTH,
                    'x-csrf-token': token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Cookie': cookies ? cookies.join('; ') : ''
                },
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
            });
            return resp.data;
        }

        // Helper: PATCH to SAP with CSRF token
        async function sapPatch(path, data) {
            const { token, cookies } = await fetchCsrfToken();
            const resp = await axios.patch(SAP_BASE_URL + '/' + path, data, {
                headers: {
                    'Authorization': SAP_AUTH,
                    'x-csrf-token': token,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Cookie': cookies ? cookies.join('; ') : ''
                },
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
            });
            return resp.data;
        }

        // Proxy READ operations to S/4HANA via CAP SDK (no CSRF needed for GET)
        this.on('READ', 'AttendanceRequest', async (req) => {
            return attExternal.run(req.query);
        });

        // ---- READ: requestTypes (static catalog) ----
        this.on('READ', 'requestTypes', () => {
            return [
                { code: 'DAYOFF',          text: 'Day Off',          icon: 'sap-icon://calendar' },
                { code: 'EDIT_TIMESHEET',  text: 'Edit Timesheet',   icon: 'sap-icon://edit' },
                { code: 'OVERTIME',        text: 'Overtime',         icon: 'sap-icon://overtime' },
                { code: 'WFH',             text: 'Work From Home',   icon: 'sap-icon://home' }
            ];
        });

        // ---- CREATE: Build payload and POST to S/4HANA with CSRF token ----
        this.on('CREATE', 'AttendanceRequest', async (req) => {
            const data = req.data;

            // --- Auto-populate status ---
            data.Status = data.Status || '01';
            data.SapPostStatus = data.SapPostStatus || 'PENDING';

            // --- Calculate Duration ---
            if ((data.RequestType === 'DAYOFF' || data.RequestType === 'WFH') && data.StartDate && data.EndDate) {
                const start = new Date(data.StartDate);
                const end = new Date(data.EndDate);
                const diffMs = end - start;
                const diffDays = Math.max(Math.ceil(diffMs / (1000 * 60 * 60 * 24)), 1);
                data.Duration = diffDays;
                data.DurationUnit = 'TAG';
            } else if (data.RequestType === 'OVERTIME' && data.StartDate && data.EndDate) {
                const start = new Date(data.StartDate);
                const end = new Date(data.EndDate);
                const diffHours = Math.max((end - start) / (1000 * 60 * 60), 0);
                data.Duration = parseFloat(diffHours.toFixed(2));
                data.DurationUnit = 'STD';

                if (diffHours > 12) data.OtBreakHours = 2.0;
                else if (diffHours > 8) data.OtBreakHours = 1.5;
                else if (diffHours > 4) data.OtBreakHours = 1.0;
                else data.OtBreakHours = 0;
            } else if (data.RequestType === 'EDIT_TIMESHEET') {
                data.Duration = 1;
                data.DurationUnit = 'TAG';
            }

            // --- Auto-determine Approver from org tree ---
            try {
                if (data.Pernr) {
                    const teamEntry = await skillSrv.run(
                        SELECT.one.from('TeamMembers').where({ EmployeePernr: data.Pernr })
                    );
                    if (teamEntry) {
                        data.ApproverId = data.ApproverId || teamEntry.ManagerUserId;
                        if (data.RequestType === 'DAYOFF' && data.Duration > 5) {
                            try {
                                const managerProfile = await skillSrv.run(
                                    SELECT.one.from('UserProfile').where({ UserId: teamEntry.ManagerUserId })
                                );
                                if (managerProfile && managerProfile.Pernr) {
                                    const skipEntry = await skillSrv.run(
                                        SELECT.one.from('TeamMembers').where({ EmployeePernr: managerProfile.Pernr })
                                    );
                                    if (skipEntry) data.ApproverId = skipEntry.ManagerUserId;
                                }
                            } catch (e) {
                                console.warn('[AttendanceService] Skip-level lookup failed:', e.message);
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('[AttendanceService] Could not determine approver:', e.message);
            }

            // Build payload with only fields that exist on the backend
            const payload = {
                Pernr: data.Pernr,
                RequestType: data.RequestType,
                StartDate: data.StartDate,
                EndDate: data.EndDate,
                Duration: data.Duration,
                DurationUnit: data.DurationUnit,
                Reason: data.Reason || '',
                Status: data.Status,
                SapPostStatus: data.SapPostStatus,
                ApproverId: data.ApproverId || ''
            };
            if (data.CorrectedStartTime) payload.CorrectedStartTime = data.CorrectedStartTime;
            if (data.CorrectedEndTime) payload.CorrectedEndTime = data.CorrectedEndTime;
            if (data.CorrectedDate) payload.CorrectedDate = data.CorrectedDate;
            if (data.OtBreakHours !== undefined) payload.OtBreakHours = data.OtBreakHours;

            console.log('[AttendanceService] CREATE payload:', JSON.stringify(payload));

            try {
                const result = await sapPost('AttendanceRequest', payload);
                console.log('[AttendanceService] Created successfully:', result.RequestId || result.d?.RequestId);
                return result;
            } catch (error) {
                const errMsg = error.response?.data?.error?.message || error.message;
                console.error('[AttendanceService] CREATE failed:', errMsg);
                return req.reject(error.response?.status || 500, errMsg);
            }
        });

        // ---- ACTION: Approve (calls RAP action on S/4HANA) ----
        this.on('approveAttRequest', async (req) => {
            const { RequestId } = req.data;
            if (!RequestId) return req.reject(400, 'RequestId is required');

            try {
                const result = await sapPost(
                    `AttendanceRequest(RequestId=${RequestId},IsActiveEntity=true)/com.sap.gateway.srvd.zsd_nxr_attreq_post.v0001.Approve`,
                    {}
                );
                console.log(`[AttendanceService] APPROVED request ${RequestId}`);
                return result;
            } catch (error) {
                const errMsg = error.response?.data?.error?.message || error.message;
                console.error(`[AttendanceService] Approve failed:`, errMsg);
                return req.reject(500, errMsg);
            }
        });

        // ---- ACTION: Reject (calls RAP action on S/4HANA) ----
        this.on('rejectAttRequest', async (req) => {
            const { RequestId, RejectionReason } = req.data;
            if (!RequestId) return req.reject(400, 'RequestId is required');

            try {
                const result = await sapPost(
                    `AttendanceRequest(RequestId=${RequestId},IsActiveEntity=true)/com.sap.gateway.srvd.zsd_nxr_attreq_post.v0001.Reject`,
                    { RejectionReason: RejectionReason || '' }
                );
                console.log(`[AttendanceService] REJECTED request ${RequestId}`);
                return result;
            } catch (error) {
                const errMsg = error.response?.data?.error?.message || error.message;
                console.error(`[AttendanceService] Reject failed:`, errMsg);
                return req.reject(500, errMsg);
            }
        });

        // ---- ACTION: Cancel (PATCH status via OData) ----
        this.on('cancelAttRequest', async (req) => {
            const { RequestId } = req.data;
            if (!RequestId) return req.reject(400, 'RequestId is required');

            try {
                const result = await sapPatch(
                    `AttendanceRequest(RequestId=${RequestId},IsActiveEntity=true)`,
                    { Status: '04', SapPostStatus: 'CANCELLED' }
                );
                console.log(`[AttendanceService] CANCELLED request ${RequestId}`);
                return result;
            } catch (error) {
                const errMsg = error.response?.data?.error?.message || error.message;
                console.error(`[AttendanceService] Cancel failed:`, errMsg);
                return req.reject(500, errMsg);
            }
        });
    },

    // ================================================================
    // WorktimeUploadService — HR Bulk Upload to ztb_nxr_worktime
    // ================================================================
    WorktimeUploadService: async function() {
        const axios = require('axios');

        // SAP OData base URL for worktime service
        // NOTE: This URL needs to be updated once ZUI_NXR_WORKTIME_UPLOAD_O4 is published
        const SAP_WORKTIME_URL = 'https://s40lp1.ucc.cit.tum.de:443/sap/opu/odata4/sap/zui_nxr_worktime_upload/srvd/sap/zsd_nxr_worktime_upload/0001';
        const SAP_USER = process.env.UI5_USERNAME || 'DEV-271';
        const SAP_PASS = process.env.UI5_PASSWORD || 'Hanoi@12345';
        const SAP_AUTH = 'Basic ' + Buffer.from(SAP_USER + ':' + SAP_PASS).toString('base64');

        async function fetchCsrfToken() {
            const resp = await axios.get(SAP_WORKTIME_URL + '/', {
                headers: {
                    'Authorization': SAP_AUTH,
                    'x-csrf-token': 'Fetch',
                    'Accept': 'application/json'
                },
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
            });
            return {
                token: resp.headers['x-csrf-token'],
                cookies: resp.headers['set-cookie']
            };
        }

        // ---- ACTION: checkExisting ----
        this.on('checkExisting', async (req) => {
            const { months } = req.data;
            if (!months || months.length === 0) return { count: 0, months: '' };

            try {
                // Build filter: WorkDate ge 'YYYYMM01' and WorkDate le 'YYYYMM31' for each month
                let totalCount = 0;
                for (const month of months) {
                    const from = month + '01';
                    const to = month + '31';
                    const url = `${SAP_WORKTIME_URL}/WorktimeRecord?$filter=WorkDate ge '${from}' and WorkDate le '${to}'&$count=true&$top=0`;
                    try {
                        const resp = await axios.get(url, {
                            headers: {
                                'Authorization': SAP_AUTH,
                                'Accept': 'application/json'
                            },
                            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
                        });
                        totalCount += (resp.data['@odata.count'] || 0);
                    } catch (e) {
                        console.warn(`[WorktimeUpload] Check failed for month ${month}:`, e.message);
                    }
                }

                const sMonthList = months.map(m => m.substring(4,6) + '/' + m.substring(0,4)).join(', ');
                return { count: totalCount, months: sMonthList };
            } catch (error) {
                console.error('[WorktimeUpload] checkExisting error:', error.message);
                return { count: 0, months: '' };
            }
        });

        // ---- ACTION: uploadBatch ----
        this.on('uploadBatch', async (req) => {
            const { records } = req.data;
            if (!records || records.length === 0) {
                return req.reject(400, 'No records provided');
            }

            console.log(`[WorktimeUpload] Uploading ${records.length} records...`);

            let success = 0;
            let failed = 0;

            try {
                const { token, cookies } = await fetchCsrfToken();

                for (const rec of records) {
                    try {
                        await axios.post(SAP_WORKTIME_URL + '/WorktimeRecord', {
                            Pernr: rec.Pernr,
                            WorkDate: rec.WorkDate,
                            FirstEntry: rec.FirstEntry,
                            LastExit: rec.LastExit,
                            Iot: rec.Iot,
                            Iotwf: rec.Iotwf,
                            Iwa: rec.Iwa,
                            NumberOfEntry: rec.NumberOfEntry,
                            NumberOfExit: rec.NumberOfExit
                        }, {
                            headers: {
                                'Authorization': SAP_AUTH,
                                'x-csrf-token': token,
                                'Content-Type': 'application/json',
                                'Accept': 'application/json',
                                'Cookie': cookies ? cookies.join('; ') : ''
                            },
                            httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
                        });
                        success++;
                    } catch (e) {
                        failed++;
                        console.error(`[WorktimeUpload] Failed record PERNR=${rec.Pernr} DATE=${rec.WorkDate}:`, e.response?.data?.error?.message || e.message);
                    }
                }

                console.log(`[WorktimeUpload] Done: ${success} success, ${failed} failed.`);
                return { success, failed, message: `${success} records saved, ${failed} failed.` };
            } catch (error) {
                console.error('[WorktimeUpload] CSRF/upload error:', error.message);
                return req.reject(500, 'Upload failed: ' + error.message);
            }
        });
    }
};
