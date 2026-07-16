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
        const skillSrv = await cds.connect.to('ZUI_NXR_SKILLREQ_O4');
        const attExternal = await cds.connect.to('ZUI_NXR_ATTREQ_O4');
        const axios = require('axios');

        // SAP OData V4 base URL and credentials
        const SAP_BASE_URL = cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials.url;
        const SAP_USER = process.env.UI5_USERNAME || 'DEV-271';
        const SAP_PASS = process.env.UI5_PASSWORD || 'Hanoi@12345';
        const SAP_AUTH = 'Basic ' + Buffer.from(SAP_USER + ':' + SAP_PASS).toString('base64');
        const approverFallbacksByEmployee = {
            '90000007': {
                approverId: 'HAONGUYEN022202@GMAIL.COM',
                approverName: 'Hoang Minh Tuan',
                approverPernr: '90000005'
            },
            '90000005': {
                approverId: '90000001',
                approverName: '90000001',
                approverPernr: '90000001'
            }
        };

        function normalizeGuid(value) {
            const raw = String(value || '').replace(/[{}-]/g, '');
            if (/^[0-9a-fA-F]{32}$/.test(raw)) {
                return [
                    raw.substring(0, 8),
                    raw.substring(8, 12),
                    raw.substring(12, 16),
                    raw.substring(16, 20),
                    raw.substring(20)
                ].join('-').toLowerCase();
            }
            return String(value || '');
        }

        function attendanceRequestKey(requestId) {
            return `AttendanceRequest(RequestId=${normalizeGuid(requestId)})`;
        }

        function getMonthBounds(oDate) {
            const start = new Date(oDate.getFullYear(), oDate.getMonth(), 1);
            const end = new Date(oDate.getFullYear(), oDate.getMonth() + 1, 0);
            const fmt = (d) => d.getFullYear() + '-' +
                String(d.getMonth() + 1).padStart(2, '0') + '-' +
                String(d.getDate()).padStart(2, '0');
            return { start: fmt(start), end: fmt(end) };
        }

        async function resolveApprover(pernr) {
            if (!pernr) return null;
            try {
                const teamRows = await skillSrv.run(
                    SELECT.from('TeamMembers')
                );
                const teamEntry = (teamRows || []).find(r => r.EmployeePernr === pernr);

                if (teamEntry && teamEntry.ManagerUserId) {
                    return {
                        approverId: teamEntry.ManagerUserId,
                        approverName: teamEntry.ManagerUserId,
                        approverPernr: ''
                    };
                }
            } catch (e) {
                console.warn('[AttendanceService] TeamMembers lookup failed:', e.message);
            }
            return approverFallbacksByEmployee[pernr] || null;
        }

        async function countEditTimesheetRequestsInMonth(pernr, dateValue) {
            if (!pernr || !dateValue) return 0;
            const targetDate = new Date(dateValue);
            if (Number.isNaN(targetDate.getTime())) return 0;
            const bounds = getMonthBounds(targetDate);
            const rows = await attExternal.run(
                SELECT.from('AttendanceRequest').where({
                    Pernr: pernr,
                    RequestType: 'EDIT_TIMESHEET'
                })
            );
            return (rows || []).filter(row => {
                const status = row.Status || '';
                const startDate = String(row.StartDate || '').substring(0, 10);
                return status !== '04' && startDate >= bounds.start && startDate <= bounds.end;
            }).length;
        }

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

        function getSapErrorMessage(error) {
            const data = error.response?.data;
            if (typeof data === 'string') return data;
            return data?.error?.message
                || data?.error?.details?.map(detail => detail.message).filter(Boolean).join('; ')
                || error.message;
        }

        function normalizeTimeValue(value) {
            if (!value) return value;
            const time = String(value).trim();
            if (/^\d{2}:\d{2}$/.test(time)) return `${time}:00`;
            return time;
        }

        // Helper: PATCH to SAP with CSRF token
        async function sapPatch(path, data) {
            const { token, cookies } = await fetchCsrfToken();
            const resp = await axios.patch(SAP_BASE_URL + '/' + path, data, {
                headers: {
                    'Authorization': SAP_AUTH,
                    'x-csrf-token': token,
                    'If-Match': '*',
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
                let diffDays = 0;
                let current = new Date(start.getTime());
                end.setHours(23, 59, 59, 999);

                while (current <= end) {
                    const dayOfWeek = current.getDay();
                    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                        diffDays++;
                    }
                    current.setDate(current.getDate() + 1);
                }
                
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

                try {
                    const monthlyCount = await countEditTimesheetRequestsInMonth(data.Pernr, data.StartDate);
                    if (monthlyCount >= 3) {
                        return req.reject(400, 'Edit Timesheet requests are limited to 3 times per month.');
                    }
                } catch (e) {
                    console.warn('[AttendanceService] Monthly Edit Timesheet check failed:', e.message);
                }
            }

            // --- Auto-determine Approver from org tree ---
            try {
                if (data.Pernr) {
                    const teamEntry = await resolveApprover(data.Pernr);
                    if (teamEntry) {
                        data.ApproverId = data.ApproverId || teamEntry.approverId;
                        if (data.RequestType === 'DAYOFF' && data.Duration > 5) {
                            try {
                                let managerPernr = teamEntry.approverPernr;
                                if (!managerPernr) {
                                    const managerProfile = await skillSrv.run(
                                        SELECT.one.from('UserProfile').where({ UserId: teamEntry.approverId })
                                    );
                                    if (managerProfile && managerProfile.Pernr) {
                                        managerPernr = managerProfile.Pernr;
                                    }
                                }
                                if (managerPernr) {
                                    const skipEntry = await resolveApprover(managerPernr);
                                    if (skipEntry) data.ApproverId = skipEntry.approverId;
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
            if (data.CorrectedStartTime) payload.CorrectedStartTime = normalizeTimeValue(data.CorrectedStartTime);
            if (data.CorrectedEndTime) payload.CorrectedEndTime = normalizeTimeValue(data.CorrectedEndTime);
            if (data.CorrectedDate) payload.CorrectedDate = data.CorrectedDate;
            if (data.OtBreakHours !== undefined) payload.OtBreakHours = data.OtBreakHours;

            console.log('[AttendanceService] CREATE payload:', JSON.stringify(payload));

            try {
                const result = await sapPost('AttendanceRequest', payload);
                console.log('[AttendanceService] Created successfully:', result.RequestId || result.d?.RequestId);
                return result;
            } catch (error) {
                const errMsg = getSapErrorMessage(error);
                console.error('[AttendanceService] CREATE failed:', errMsg);
                return req.reject(error.response?.status || 500, errMsg);
            }
        });

        // ---- ACTION: Approve (calls RAP action on S/4HANA) ----
        this.on('approveAttRequest', async (req) => {
            const { RequestId } = req.data;
            if (!RequestId) return req.reject(400, 'RequestId is required');
            const key = attendanceRequestKey(RequestId);

            try {
                const result = await sapPost(
                    `${key}/com.sap.gateway.srvd.zsd_nxr_attreq_post.v0001.Approve`,
                    {}
                );
                console.log(`[AttendanceService] APPROVED request ${RequestId}`);
                return result;
            } catch (error) {
                const errMsg = getSapErrorMessage(error);
                console.error(`[AttendanceService] Approve failed:`, errMsg);
                return req.reject(error.response?.status || 500, errMsg);
            }
        });

        // ---- ACTION: Reject (calls RAP action on S/4HANA) ----
        this.on('rejectAttRequest', async (req) => {
            const { RequestId, RejectionReason } = req.data;
            if (!RequestId) return req.reject(400, 'RequestId is required');
            const key = attendanceRequestKey(RequestId);

            try {
                // First try to use CAP UPDATE which handles OData V4 properly
                console.log(`[AttendanceService] Attempting to REJECT request ${RequestId} via CAP UPDATE`);
                const result = await attExternal.run(
                    UPDATE('AttendanceRequest')
                    .set({ Status: '03', RejectionReason: RejectionReason || '', SapPostStatus: 'SUCCESS' })
                    .where({ RequestId: normalizeGuid(RequestId) })
                );
                console.log(`[AttendanceService] REJECTED request ${RequestId} via CAP UPDATE`);
                return { RequestId };
            } catch (error) {
                console.warn(`[AttendanceService] CAP UPDATE failed, trying sapPatch:`, error.message);
                try {
                    const result = await sapPatch(key, { Status: '03', RejectionReason: RejectionReason || '', SapPostStatus: 'SUCCESS' });
                    console.log(`[AttendanceService] REJECTED request ${RequestId} via status PATCH`);
                    return result;
                } catch (patchError) {
                    const patchMsg = patchError.response?.data?.error?.message || patchError.response?.data || patchError.message;
                    console.error(`[AttendanceService] Reject failed:`, patchMsg);
                    return req.reject(500, typeof patchMsg === 'string' ? patchMsg : JSON.stringify(patchMsg));
                }
            }
        });

        // ---- ACTION: Cancel (PATCH status via OData) ----
        this.on('cancelAttRequest', async (req) => {
            const { RequestId } = req.data;
            if (!RequestId) return req.reject(400, 'RequestId is required');
            const key = attendanceRequestKey(RequestId);

            try {
                const result = await sapPatch(
                    key,
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
        const https = require('https');
        const { randomUUID } = require('crypto');

        const SAP_WORKTIME_URL = (process.env.SAP_WORKTIME_URL ||
            'https://s40lp1.ucc.cit.tum.de:443/sap/opu/odata4/sap/zui_nxr_worktime_upload/srvd/sap/zsd_nxr_worktime_upload/0001')
            .replace(/\/+$/, '');
        const SAP_USER = process.env.SAP_WORKTIME_USERNAME || process.env.UI5_USERNAME || 'DEV-271';
        const SAP_PASS = process.env.SAP_WORKTIME_PASSWORD || process.env.UI5_PASSWORD || 'Hanoi@12345';
        const SAP_AUTH = 'Basic ' + Buffer.from(SAP_USER + ':' + SAP_PASS).toString('base64');
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        const readHeaders = { 'Authorization': SAP_AUTH, 'Accept': 'application/json' };

        const sapErrorMessage = (error) => {
            const sapMessage = error.response?.data?.error?.message;
            return typeof sapMessage === 'string'
                ? sapMessage
                : sapMessage?.value || error.message || 'Unknown SAP error';
        };

        const normalizePernr = (value) => {
            const digits = String(value || '').trim();
            if (!/^\d{1,8}$/.test(digits)) throw new Error('Pernr must contain 1 to 8 digits');
            return digits.padStart(8, '0');
        };

        const normalizeDate = (value) => {
            const text = value instanceof Date
                ? value.toISOString().slice(0, 10)
                : String(value || '').trim();
            const match = text.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
            if (!match) throw new Error('WorkDate must use YYYY-MM-DD');

            const year = Number(match[1]);
            const month = Number(match[2]);
            const day = Number(match[3]);
            const parsed = new Date(Date.UTC(year, month - 1, day));
            if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
                throw new Error('WorkDate is not a valid calendar date');
            }
            return `${match[1]}-${match[2]}-${match[3]}`;
        };

        const normalizeTime = (value, fieldName) => {
            const digits = String(value || '').trim().replace(/:/g, '');
            if (!/^\d{4}(\d{2})?$/.test(digits)) throw new Error(`${fieldName} must use HH:mm or HH:mm:ss`);
            const normalized = digits.length === 4 ? digits + '00' : digits;
            const hours = Number(normalized.slice(0, 2));
            const minutes = Number(normalized.slice(2, 4));
            const seconds = Number(normalized.slice(4, 6));
            if (hours > 23 || minutes > 59 || seconds > 59) throw new Error(`${fieldName} is not a valid time`);
            return `${normalized.slice(0, 2)}:${normalized.slice(2, 4)}:${normalized.slice(4, 6)}`;
        };

        const normalizeDecimal = (value, fieldName) => {
            const number = Number(value || 0);
            if (!Number.isFinite(number) || number < 0 || number > 999.99) {
                throw new Error(`${fieldName} must be between 0 and 999.99`);
            }
            return Number(number.toFixed(2));
        };

        const normalizeInteger = (value, fieldName) => {
            const number = Number(value || 0);
            if (!Number.isInteger(number) || number < 0 || number > 32767) {
                throw new Error(`${fieldName} must be an integer between 0 and 32767`);
            }
            return number;
        };

        const normalizeRecord = (record) => {
            const firstEntry = normalizeTime(record.FirstEntry, 'FirstEntry');
            const lastExit = normalizeTime(record.LastExit, 'LastExit');
            if (firstEntry === lastExit) throw new Error('FirstEntry and LastExit cannot be identical');

            return {
                Pernr: normalizePernr(record.Pernr),
                WorkDate: normalizeDate(record.WorkDate),
                FirstEntry: firstEntry,
                LastExit: lastExit,
                Iot: normalizeDecimal(record.Iot, 'Iot'),
                Iotwf: normalizeDecimal(record.Iotwf, 'Iotwf'),
                Iwa: normalizeDecimal(record.Iwa, 'Iwa'),
                NumberOfEntry: normalizeInteger(record.NumberOfEntry, 'NumberOfEntry'),
                NumberOfExit: normalizeInteger(record.NumberOfExit, 'NumberOfExit')
            };
        };

        const normalizeMonths = (months) => Array.from(new Set((months || []).map(String))).map((month) => {
            if (!/^\d{6}$/.test(month)) throw new Error(`Invalid month ${month}; expected YYYYMM`);
            const monthNumber = Number(month.slice(4, 6));
            if (monthNumber < 1 || monthNumber > 12) throw new Error(`Invalid month ${month}`);
            return month;
        });

        const monthRange = (month) => {
            const year = Number(month.slice(0, 4));
            const monthNumber = Number(month.slice(4, 6));
            const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
            return {
                from: `${month.slice(0, 4)}-${month.slice(4, 6)}-01`,
                to: `${month.slice(0, 4)}-${month.slice(4, 6)}-${String(lastDay).padStart(2, '0')}`
            };
        };

        const recordKey = (record) => `${record.Pernr}|${record.WorkDate}`;
        const odataString = (value) => String(value).replace(/'/g, "''");
        const recordPath = (record) =>
            `/WorktimeRecord(Pernr='${odataString(record.Pernr)}',WorkDate=${record.WorkDate})`;

        async function fetchCsrfToken() {
            const response = await axios.get(SAP_WORKTIME_URL + '/', {
                headers: { ...readHeaders, 'x-csrf-token': 'Fetch' },
                httpsAgent
            });
            return {
                token: response.headers['x-csrf-token'],
                cookie: (response.headers['set-cookie'] || []).join('; ')
            };
        }

        async function fetchExistingRows(months) {
            const rowsByKey = new Map();
            for (const month of normalizeMonths(months)) {
                const range = monthRange(month);
                const filter = `WorkDate ge ${range.from} and WorkDate le ${range.to}`;
                let url = SAP_WORKTIME_URL + '/WorktimeRecord' +
                    `?$filter=${encodeURIComponent(filter)}` +
                    '&$select=Pernr,WorkDate,SyncStatus&$top=5000';

                while (url) {
                    const response = await axios.get(url, { headers: readHeaders, httpsAgent });
                    const rows = Array.isArray(response.data?.value) ? response.data.value : [];
                    rows.forEach((row) => {
                        const normalized = {
                            ...row,
                            Pernr: normalizePernr(row.Pernr),
                            WorkDate: normalizeDate(row.WorkDate)
                        };
                        rowsByKey.set(recordKey(normalized), normalized);
                    });
                    const nextLink = response.data?.['@odata.nextLink'];
                    url = nextLink ? new URL(nextLink, SAP_WORKTIME_URL + '/').toString() : '';
                }
            }
            return rowsByKey;
        }

        // ---- ACTION: checkExisting ----
        this.on('checkExisting', async (req) => {
            try {
                const months = normalizeMonths(req.data.months);
                if (months.length === 0) return { count: 0, months: '' };
                const existing = await fetchExistingRows(months);
                return {
                    count: existing.size,
                    months: months.map((month) => month.slice(4, 6) + '/' + month.slice(0, 4)).join(', ')
                };
            } catch (error) {
                const message = sapErrorMessage(error);
                console.error('[WorktimeUpload] checkExisting failed:', message);
                return req.reject(502, 'Cannot check SAP staging data: ' + message);
            }
        });

        // ---- ACTION: uploadBatch ----
        this.on('uploadBatch', async (req) => {
            const records = req.data.records;
            if (!Array.isArray(records) || records.length === 0) return req.reject(400, 'No records provided');
            if (records.length > 5000) return req.reject(400, 'A batch cannot contain more than 5000 records');

            const validationErrors = [];
            const normalizedRecords = [];
            const keys = new Set();

            records.forEach((record, index) => {
                try {
                    const normalized = normalizeRecord(record);
                    const key = recordKey(normalized);
                    if (keys.has(key)) throw new Error('Duplicate Pernr and WorkDate in the same file');
                    keys.add(key);
                    normalizedRecords.push(normalized);
                } catch (error) {
                    validationErrors.push(`row ${index + 1}: ${error.message}`);
                }
            });

            if (validationErrors.length > 0) {
                const preview = validationErrors.slice(0, 5).join('; ');
                const suffix = validationErrors.length > 5 ? `; and ${validationErrors.length - 5} more` : '';
                return req.reject(400, 'Upload validation failed: ' + preview + suffix);
            }

            const batchId = randomUUID();
            const sourceFileName = String(req.data.sourceFileName || 'HR_UPLOAD')
                .split(/[\\/]/).pop().replace(/[\u0000-\u001f]/g, '').slice(0, 128);
            const months = Array.from(new Set(normalizedRecords.map((record) => record.WorkDate.slice(0, 7).replace('-', ''))));

            let created = 0;
            let updated = 0;
            let failed = 0;

            try {
                const existingRows = await fetchExistingRows(months);
                const { token, cookie } = await fetchCsrfToken();
                const writeHeaders = {
                    ...readHeaders,
                    'x-csrf-token': token,
                    'Content-Type': 'application/json',
                    'Cookie': cookie
                };

                for (const record of normalizedRecords) {
                    const existing = existingRows.get(recordKey(record));
                    if (existing?.SyncStatus === 'PROCESSING') {
                        failed++;
                        console.error(`[WorktimeUpload] Skipped ${recordKey(record)} because it is being processed.`);
                        continue;
                    }

                    const payload = {
                        ...record,
                        RequestType: 'HR_UPLOAD',
                        RequestStatus: 'IMPORTED',
                        ImportBatchId: batchId,
                        SourceFileName: sourceFileName,
                        SyncStatus: 'QUEUED'
                    };

                    try {
                        if (existing) {
                            await axios.patch(SAP_WORKTIME_URL + recordPath(record), payload, {
                                headers: { ...writeHeaders, 'If-Match': '*' },
                                httpsAgent
                            });
                            updated++;
                        } else {
                            await axios.post(SAP_WORKTIME_URL + '/WorktimeRecord', payload, {
                                headers: writeHeaders,
                                httpsAgent
                            });
                            created++;
                        }
                    } catch (error) {
                        failed++;
                        console.error(`[WorktimeUpload] Failed ${recordKey(record)}:`, sapErrorMessage(error));
                    }
                }

                const success = created + updated;
                console.log(`[WorktimeUpload] Batch ${batchId}: ${created} created, ${updated} updated, ${failed} failed.`);
                return {
                    batchId,
                    success,
                    created,
                    updated,
                    failed,
                    message: `${success} records queued for SAP HR sync (${created} created, ${updated} updated, ${failed} failed).`
                };
            } catch (error) {
                const message = sapErrorMessage(error);
                console.error(`[WorktimeUpload] Batch ${batchId} failed:`, message);
                return req.reject(502, 'Upload to SAP staging failed: ' + message);
            }
        });
    }
};
