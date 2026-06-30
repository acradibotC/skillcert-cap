const cds = require('@sap/cds');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Server: SocketIOServer } = require('socket.io');
require('dotenv').config();

// Global Socket.IO instance — set after CDS server starts listening
let io = null;
// Cache for last-known notification counts per user for change detection
const notifCountCache = new Map();

// Disable TLS validation for S40 self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Module-scope references for notification functions — assigned inside cds.on('bootstrap')
let getNotificationItems, mergeReadState, _broadcastCountUpdate, _broadcastToAllUsers;

cds.on('bootstrap', app => {
    // Dynamically inject credentials for OData external service
    if (cds.env.requires && cds.env.requires.ZUI_NXR_SKILLREQ_O4 && cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials) {
        cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.username = process.env.UI5_USERNAME || 'DEV-271';
        cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.password = process.env.UI5_PASSWORD || 'Hanoi@12345';
    }

    if (cds.env.requires && cds.env.requires.ZUI_NXR_WORKSCHEDULE_O4 && cds.env.requires.ZUI_NXR_WORKSCHEDULE_O4.credentials) {
        cds.env.requires.ZUI_NXR_WORKSCHEDULE_O4.credentials.username = process.env.UI5_USERNAME || 'DEV-271';
        cds.env.requires.ZUI_NXR_WORKSCHEDULE_O4.credentials.password = process.env.UI5_PASSWORD || 'Hanoi@12345';
    }

    if (cds.env.requires && cds.env.requires.ZUI_NXR_ATTREQ_O4 && cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials) {
        cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials.username = process.env.UI5_USERNAME || 'DEV-271';
        cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials.password = process.env.UI5_PASSWORD || 'Hanoi@12345';
    }

    // Trust proxy to ensure secure secure cookies and proper HTTPS redirect URIs via Localtunnel
    app.set('trust proxy', 1);

    // Parse JSON bodies (required for /api/notifications/read POST)
    app.use(express.json());

    // Session setup
    app.use(session({
        secret: 'skillcert-secret-key',
        resave: false,
        saveUninitialized: false
    }));

    // Passport setup
    app.use(passport.initialize());
    app.use(passport.session());

    // Google Strategy
    passport.use(new GoogleStrategy({
        clientID: process.env.GOOGLE_CLIENT_ID || 'dummy-client-id',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'dummy-client-secret',
        callbackURL: "/auth/google/callback"
    },
        function (accessToken, refreshToken, profile, cb) {
            // Here you would find or create user in your DB.
            // For our mock, we just pass the profile.
            return cb(null, profile);
        }));

    passport.serializeUser(function (user, cb) {
        cb(null, user);
    });

    passport.deserializeUser(function (obj, cb) {
        cb(null, obj);
    });

    // Auth Routes
    app.get('/auth/google',
        passport.authenticate('google', { scope: ['profile', 'email'] }));

    const path = require('path');

    // Serve static files without .html extension in URL
    app.get('/login', (req, res) => res.sendFile(path.join(__dirname, '../app/login.html')));
    app.get('/logout', (req, res) => res.sendFile(path.join(__dirname, '../app/logout.html')));

    app.get('/auth/google/callback',
        passport.authenticate('google', { failureRedirect: '/login' }),
        function (req, res) {
            // Successful authentication, redirect to Fiori Launchpad.
            res.redirect('/launchpad/');
        });

    app.get('/auth/logout', (req, res, next) => {
        req.logout(function (err) {
            if (err) { return next(err); }
            res.redirect('/logout');
        });
    });

    // Custom endpoint to get current user info for UI5
    // Validates email → Pernr mapping against SAP UserProfile
    app.get('/api/currentUser', async (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const email = req.user.emails && req.user.emails[0].value ? req.user.emails[0].value : 'unknown@domain.com';
        const name = req.user.displayName || 'User';

        if (req.session && req.session.userInfo) {
            return res.json(req.session.userInfo);
        }

        try {
            // Call SAP UserProfile to validate email → Pernr mapping
            const axios = require('axios');
            const sapUrl = cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.url;
            const sapUser = process.env.UI5_USERNAME || 'DEV-271';
            const sapPass = process.env.UI5_PASSWORD || 'Hanoi@12345';

            const axiosConfig = {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(sapUser + ':' + sapPass).toString('base64'),
                    'Accept': 'application/json'
                },
                httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                validateStatus: (s) => s < 500 // Don't throw on 404
            };

            let profileResp = await axios.get(
                sapUrl + "/UserProfile('" + encodeURIComponent(email) + "')",
                axiosConfig
            );

            let sapEmail = email;

            // Fallback: If not found, try UPPERCASE email because SAP PA0105 might store it as uppercase
            if (profileResp.status === 404 || (profileResp.status === 200 && (!profileResp.data || !profileResp.data.Pernr))) {
                sapEmail = email.toUpperCase();
                profileResp = await axios.get(
                    sapUrl + "/UserProfile('" + encodeURIComponent(sapEmail) + "')",
                    axiosConfig
                );
            }

            if (profileResp.status === 200 && profileResp.data && profileResp.data.Pernr) {
                const profile = profileResp.data;
                const userInfo = {
                    authorized: true,
                    userId: req.user.id,
                    email: sapEmail, // Trả về đúng email đã match (có thể là IN HOA) để UI5 binding không bị lỗi
                    name: name,
                    pernr: profile.Pernr,
                    employeeName: profile.EmployeeName || name,
                    isManager: profile.IsManager === true || profile.IsManager === 'X' || profile.IsManager === 'x'
                };
                if (req.session) req.session.userInfo = userInfo;
                res.json(userInfo);
            } else {
                // Email not found in SAP → Access Denied
                console.warn(`[Auth] Email "${email}" not mapped to any Pernr in SAP UserProfile.`);
                res.json({
                    authorized: false,
                    userId: req.user.id,
                    email: email,
                    name: name,
                    pernr: null,
                    errorMessage: 'Your email (' + email + ') is not linked to any employee record. Please contact your administrator at sso@nexora.com to register your account.'
                });
            }
        } catch (error) {
            console.error('[Auth] Error checking UserProfile:', error.message);
            // On SAP connection failure, deny access with helpful message
            res.json({
                authorized: false,
                userId: req.user.id,
                email: email,
                name: name,
                pernr: null,
                errorMessage: 'Unable to verify your account. The system is currently unavailable. Please try again later or contact sso@nexora.com.'
            });
        }
    });

    const getCurrentUserEmail = (req) => {
        return req.user && req.user.emails && req.user.emails[0] && req.user.emails[0].value
            ? req.user.emails[0].value
            : '';
    };

    const escapeODataString = (value) => String(value || '').replace(/'/g, "''");

    const getSapAuthHeader = () => {
        const sapUser = process.env.UI5_USERNAME || 'DEV-271';
        const sapPass = process.env.UI5_PASSWORD || 'Hanoi@12345';
        return 'Basic ' + Buffer.from(sapUser + ':' + sapPass).toString('base64');
    };

    const normalizeODataRows = (data) => {
        if (!data) return [];
        if (Array.isArray(data.value)) return data.value;
        if (data.d && Array.isArray(data.d.results)) return data.d.results;
        if (Array.isArray(data)) return data;
        return [];
    };

    const trimTrailingSlash = (url) => String(url || '').replace(/\/+$/, '');

    // Training-system fallback: ZI_NXR_HR_TEAM_MEMBERS currently misses some
    // position-based reporting lines because PA0001-ORGEH is not populated.
    // Keep this map narrow and remove it once the SAP CDS view is fixed.
    const managerSubordinateFallbacks = {
        '90000005': [
            { pernr: '90000007', name: 'Nguyen Tuan Anh' }
        ]
    };

    const managerByEmployeeFallbacks = {
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

    // Manager-only task source: only pending requests from direct team members.
    app.get('/api/manager/attendance-requests', async (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const email = getCurrentUserEmail(req);
        if (!email) {
            return res.status(400).json({ error: "Cannot determine current user email." });
        }

        try {
            const axios = require('axios');
            const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
            const authHeader = getSapAuthHeader();
            const skillUrl = trimTrailingSlash(cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.url);
            const attUrl = trimTrailingSlash(cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials.url);
            let managerPernr = '';

            for (const userId of [email, email.toUpperCase()]) {
                try {
                    const profileResp = await axios.get(
                        skillUrl + "/UserProfile('" + encodeURIComponent(userId) + "')",
                        {
                            headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                            httpsAgent,
                            validateStatus: (s) => s < 500
                        }
                    );
                    if (profileResp.status === 200 && profileResp.data && profileResp.data.Pernr) {
                        managerPernr = profileResp.data.Pernr;
                        break;
                    }
                } catch (e) {
                    // Continue with TeamMembers lookup; profile lookup is only needed for fallback.
                }
            }

            const managerIds = Array.from(new Set([email, email.toUpperCase()].filter(Boolean)));
            const teamFilter = managerIds.map(id => "ManagerUserId eq '" + escapeODataString(id) + "'").join(' or ');
            const teamResp = await axios.get(
                skillUrl + "/TeamMembers?$filter=" + encodeURIComponent(teamFilter) + "&$select=EmployeePernr,EmployeeName",
                {
                    headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                    httpsAgent
                }
            );

            const teamRows = normalizeODataRows(teamResp.data);
            const employeeByPernr = new Map();
            teamRows.forEach(row => {
                if (row.EmployeePernr) {
                    employeeByPernr.set(row.EmployeePernr, row.EmployeeName || '');
                }
            });

            if (employeeByPernr.size === 0 && managerPernr && managerSubordinateFallbacks[managerPernr]) {
                managerSubordinateFallbacks[managerPernr].forEach(row => {
                    employeeByPernr.set(row.pernr, row.name || '');
                });
            }

            const pernrList = Array.from(employeeByPernr.keys());
            if (pernrList.length === 0) {
                return res.json({ value: [] });
            }

            const status = req.query.status || '01';
            const requestFilters = [
                '(' + pernrList.map(pernr => "Pernr eq '" + escapeODataString(pernr) + "'").join(' or ') + ')'
            ];
            if (status !== 'ALL') {
                requestFilters.unshift("Status eq '" + escapeODataString(status) + "'");
            }
            const requestFilter = requestFilters.join(' and ');

            const reqResp = await axios.get(
                attUrl + "/AttendanceRequest?$filter=" + encodeURIComponent(requestFilter) + "&$orderby=CreatedAt desc",
                {
                    headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                    httpsAgent
                }
            );

            const requests = normalizeODataRows(reqResp.data).map(row => ({
                ...row,
                EmployeeName: employeeByPernr.get(row.Pernr) || row.EmployeeName || ''
            }));

            res.json({ value: requests });
        } catch (error) {
            const status = error.response && error.response.status ? error.response.status : 500;
            const message = error.response && error.response.data && error.response.data.error && error.response.data.error.message
                ? error.response.data.error.message
                : error.message;
            console.error('[ManagerTasks] Failed to load team attendance requests:', message);
            res.status(status).json({ error: message });
        }
    });

    app.get('/api/attendance/approver', async (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const pernr = req.query.pernr;
        const duration = parseInt(req.query.duration, 10) || 0;
        const requestType = req.query.requestType || '';

        if (!pernr) {
            return res.status(400).json({ error: "Missing pernr." });
        }

        try {
            const axios = require('axios');
            const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
            const authHeader = getSapAuthHeader();
            const skillUrl = trimTrailingSlash(cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.url);
            const teamResp = await axios.get(
                skillUrl + "/TeamMembers?$filter=" + encodeURIComponent("EmployeePernr eq '" + escapeODataString(pernr) + "'") +
                "&$select=ManagerUserId,EmployeePernr",
                {
                    headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                    httpsAgent
                }
            );

            let currentManagerId = '';
            let approverName = '';
            let approverPernr = '';

            const teamRows = normalizeODataRows(teamResp.data);
            const teamEntry = teamRows.find(r => r.EmployeePernr === pernr);

            if (teamEntry && teamEntry.ManagerUserId) {
                currentManagerId = teamEntry.ManagerUserId;
                approverName = currentManagerId;
            } else if (managerByEmployeeFallbacks[pernr]) {
                const fb = managerByEmployeeFallbacks[pernr];
                currentManagerId = fb.approverId;
                approverName = fb.approverName;
                approverPernr = fb.approverPernr;
            }

            if (currentManagerId) {
                try {
                    // Get Profile for direct manager if we don't have pernr/name
                    if (!approverPernr) {
                        const profileResp = await axios.get(
                            skillUrl + "/UserProfile('" + encodeURIComponent(currentManagerId) + "')",
                            {
                                headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                                httpsAgent,
                                validateStatus: (s) => s < 500
                            }
                        );
                        if (profileResp.status === 200 && profileResp.data) {
                            const name = profileResp.data.EmployeeName || approverName;
                            const position = profileResp.data.PositionName || '';
                            approverName = position ? name + ' - ' + position : name;
                            approverPernr = profileResp.data.Pernr || '';
                        }
                    }

                    // Skip-level logic
                    if (requestType === 'DAYOFF' && duration > 5 && approverPernr) {
                        let skipManagerId = '';
                        // First try OData
                        const skipTeamResp = await axios.get(
                            skillUrl + "/TeamMembers?$filter=" + encodeURIComponent("EmployeePernr eq '" + escapeODataString(approverPernr) + "'") +
                            "&$select=ManagerUserId,EmployeePernr",
                            {
                                headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                                httpsAgent
                            }
                        );
                        const skipTeamRows = normalizeODataRows(skipTeamResp.data);
                        const skipTeamEntry = skipTeamRows.find(r => r.EmployeePernr === approverPernr);
                        if (skipTeamEntry && skipTeamEntry.ManagerUserId) {
                            skipManagerId = skipTeamEntry.ManagerUserId;
                        } else if (managerByEmployeeFallbacks[approverPernr]) {
                            // Try fallback for skip manager
                            skipManagerId = managerByEmployeeFallbacks[approverPernr].approverId;
                        }

                        if (skipManagerId) {
                            currentManagerId = skipManagerId;
                            approverName = currentManagerId; // Default
                            approverPernr = '';

                            const skipProfileResp = await axios.get(
                                skillUrl + "/UserProfile('" + encodeURIComponent(currentManagerId) + "')",
                                {
                                    headers: { 'Authorization': authHeader, 'Accept': 'application/json' },
                                    httpsAgent,
                                    validateStatus: (s) => s < 500
                                }
                            );
                            if (skipProfileResp.status === 200 && skipProfileResp.data) {
                                const skipName = skipProfileResp.data.EmployeeName || approverName;
                                const skipPosition = skipProfileResp.data.PositionName || '';
                                approverName = skipPosition ? skipName + ' - ' + skipPosition : skipName;
                                approverPernr = skipProfileResp.data.Pernr || '';
                            }
                        }
                    }

                } catch (e) {
                    // Fallback
                }

                return res.json({
                    approverId: currentManagerId,
                    approverName,
                    approverPernr
                });
            }

            res.status(404).json({ error: "No approver found for employee " + pernr + "." });
        } catch (error) {
            if (managerByEmployeeFallbacks[pernr]) {
                return res.json(managerByEmployeeFallbacks[pernr]);
            }
            const status = error.response && error.response.status ? error.response.status : 500;
            const message = error.response && error.response.data && error.response.data.error && error.response.data.error.message
                ? error.response.data.error.message
                : error.message;
            console.error('[ApproverLookup] Failed to load approver:', message);
            res.status(status).json({ error: message });
        }
    });

    const ensureAuthenticated = (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.redirect('/login');
        }
        next();
    };

    // Serve UI5 app resources only after authentication. The launchpad loads
    // child components from these routes, so each route needs a real static root.
    app.use('/launchpad', ensureAuthenticated, express.static(path.join(__dirname, '../app/launchpad/webapp')));
    app.use('/profile/webapp', ensureAuthenticated, express.static(path.join(__dirname, '../app/profile/webapp')));
    app.use('/timesheet/webapp', ensureAuthenticated, express.static(path.join(__dirname, '../app/timesheet/webapp')));
    app.get(['/hr-upload', '/hr-upload/'], ensureAuthenticated, (req, res) => res.redirect('/hr-upload/webapp/'));
    app.use('/hr-upload/webapp', ensureAuthenticated, express.static(path.join(__dirname, '../app/hr-upload/webapp')));
    app.use('/calendar', ensureAuthenticated);

    // Middleware to protect OData endpoints (API)
    app.use('/api/v1', (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "Unauthorized. Please log in." });
        }
        next();
    });

    // Protect Attendance Request API
    app.use('/api/v3', (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "Unauthorized. Please log in." });
        }
        next();
    });

    // Protect HR Upload API
    app.use('/api/v4', (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "Unauthorized. Please log in." });
        }
        next();
    });

    // ================================================================
    // NOTIFICATION SYSTEM — API + WebSocket
    // ================================================================

    const REQUEST_TYPE_LABELS = {
        'DAYOFF': 'Day Off Request',
        'EDIT_TIMESHEET': 'Edit Timesheet Request',
        'OVERTIME': 'Overtime Request'
    };

    const REQUEST_TYPE_ICONS = {
        'DAYOFF': 'sap-icon://date-time',
        'EDIT_TIMESHEET': 'sap-icon://edit',
        'OVERTIME': 'sap-icon://overtime'
    };

    const teamMembersCache = new Map();
    const TEAM_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

    /**
     * Build notification items by querying SAP OData services.
     * For managers: pending requests from team members
     * For employees: recently processed (approved/rejected) requests
     */
    getNotificationItems = async function(email, pernr, isManager) {
        const axios = require('axios');
        const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
        const authHeader = getSapAuthHeader();
        const attUrl = trimTrailingSlash(cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials.url);
        const skillUrl = trimTrailingSlash(cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.url);
        const items = [];

        try {
            if (isManager) {
                // --- Manager: get pending attendance requests from team ---
                const cacheKey = email.toLowerCase();
                let employeeByPernr = new Map();
                const now = Date.now();

                if (teamMembersCache.has(cacheKey) && (now - teamMembersCache.get(cacheKey).time < TEAM_CACHE_TTL)) {
                    employeeByPernr = teamMembersCache.get(cacheKey).data;
                } else {
                    const managerIds = Array.from(new Set([email, email.toUpperCase()].filter(Boolean)));
                    const teamFilter = managerIds.map(id => "ManagerUserId eq '" + escapeODataString(id) + "'").join(' or ');
                    const teamResp = await axios.get(
                        skillUrl + "/TeamMembers?$filter=" + encodeURIComponent(teamFilter) + "&$select=EmployeePernr,EmployeeName",
                        { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, httpsAgent }
                    );
                    const teamRows = normalizeODataRows(teamResp.data);
                    teamRows.forEach(row => {
                        if (row.EmployeePernr) employeeByPernr.set(row.EmployeePernr, row.EmployeeName || '');
                    });

                    // Fallback subordinates
                    if (employeeByPernr.size === 0 && pernr && managerSubordinateFallbacks[pernr]) {
                        managerSubordinateFallbacks[pernr].forEach(row => {
                            employeeByPernr.set(row.pernr, row.name || '');
                        });
                    }

                    teamMembersCache.set(cacheKey, { time: now, data: employeeByPernr });
                }

                const pernrList = Array.from(employeeByPernr.keys());
                if (pernrList.length > 0) {
                    // Pending attendance requests
                    const attFilter = "Status eq '01' and (" + pernrList.map(p => "Pernr eq '" + escapeODataString(p) + "'").join(' or ') + ")";
                    const attResp = await axios.get(
                        attUrl + "/AttendanceRequest?$filter=" + encodeURIComponent(attFilter) + "&$orderby=CreatedAt desc&$top=50",
                        { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, httpsAgent }
                    );
                    normalizeODataRows(attResp.data).forEach(req => {
                        const empName = employeeByPernr.get(req.Pernr) || req.EmployeeName || req.Pernr;
                        const typeLabel = REQUEST_TYPE_LABELS[req.RequestType] || 'Request';
                        items.push({
                            id: req.RequestId || req.Pernr + '_' + req.CreatedAt,
                            type: 'ATT_PENDING',
                            requestType: req.RequestType,
                            title: typeLabel,
                            description: empName + ' submitted a ' + typeLabel.toLowerCase(),
                            datetime: req.CreatedAt,
                            datetimeText: req.CreatedAt ? _formatRelativeTime(req.CreatedAt) : '',
                            priority: 'Medium',
                            icon: REQUEST_TYPE_ICONS[req.RequestType] || 'sap-icon://task',
                            navigateTo: 'timesheet',
                            authorName: empName
                        });
                    });
                }
            } else {
                // --- Employee: recently approved/rejected attendance requests ---
                const empFilter = "Pernr eq '" + escapeODataString(pernr) + "' and (Status eq '02' or Status eq '03')";
                const attResp = await axios.get(
                    attUrl + "/AttendanceRequest?$filter=" + encodeURIComponent(empFilter) + "&$orderby=LastChangedAt desc&$top=30",
                    { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, httpsAgent }
                );
                normalizeODataRows(attResp.data).forEach(req => {
                    const typeLabel = REQUEST_TYPE_LABELS[req.RequestType] || 'Request';
                    const isApproved = req.Status === '02';
                    const timeStr = req.LastChangedAt || req.CreatedAt;
                    items.push({
                        id: req.RequestId || req.Pernr + '_' + req.CreatedAt,
                        type: isApproved ? 'ATT_APPROVED' : 'ATT_REJECTED',
                        requestType: req.RequestType,
                        title: typeLabel + (isApproved ? ' — Approved ✅' : ' — Rejected ❌'),
                        description: isApproved
                            ? 'Your ' + typeLabel.toLowerCase() + ' has been approved'
                            : 'Your ' + typeLabel.toLowerCase() + ' was rejected' + (req.RejectionReason ? ': ' + req.RejectionReason : ''),
                        datetime: timeStr,
                        datetimeText: timeStr ? _formatRelativeTime(timeStr) : '',
                        priority: isApproved ? 'Low' : 'High',
                        icon: isApproved ? 'sap-icon://accept' : 'sap-icon://decline',
                        navigateTo: 'timesheet',
                        authorName: ''
                    });
                });
            }
        } catch (err) {
            console.error('[Notification] Error fetching items:', err.message);
        }

        return items;
    }

    function _formatRelativeTime(isoDate) {
        try {
            const d = new Date(isoDate);
            const now = new Date();
            const diffMs = now - d;
            const diffMins = Math.floor(diffMs / 60000);
            if (diffMins < 1) return 'Just now';
            if (diffMins < 60) return diffMins + ' min. ago';
            const diffHours = Math.floor(diffMins / 60);
            if (diffHours < 24) return diffHours + ' hr. ago';
            const diffDays = Math.floor(diffHours / 24);
            if (diffDays < 7) return diffDays + ' day(s) ago';
            return d.toLocaleDateString('en-CA');
        } catch (e) {
            return '';
        }
    }

    /**
     * Merge notification items with read/unread state from local SQLite DB.
     */
    mergeReadState = async function(items, pernr) {
        try {
            const db = await cds.connect.to('db');
            const { NotificationRead } = db.entities('znxr09.db');
            const readRecords = await SELECT.from(NotificationRead).where({ pernr: pernr });
            const readSet = new Set(readRecords.filter(r => r.isRead).map(r => r.notifType + '::' + r.requestId));
            items.forEach(item => {
                item.isRead = readSet.has(item.type + '::' + item.id);
            });
        } catch (e) {
            // If DB fails, all show as unread — acceptable fallback
            console.error('[Notification] mergeReadState error:', e.message);
            items.forEach(item => { item.isRead = false; });
        }
        return items;
    }

    // --- GET /api/notifications ---
    app.get('/api/notifications', async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        const email = getCurrentUserEmail(req);
        if (!email) return res.status(400).json({ error: 'Cannot determine current user email.' });

        try {
            const userInfo = await _resolveUserInfo(email);
            if (!userInfo.pernr) return res.json({ count: 0, unreadCount: 0, items: [] });

            let items = await getNotificationItems(email, userInfo.pernr, userInfo.isManager);
            items = await mergeReadState(items, userInfo.pernr);
            
            // Lọc những thông báo đã đọc/bỏ qua để biến mất khỏi UI
            items = items.filter(i => !i.isRead);

            res.json({ count: items.length, unreadCount: items.length, items });
        } catch (error) {
            console.error('[Notification] Error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // --- GET /api/notifications/count ---
    app.get('/api/notifications/count', async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        const email = getCurrentUserEmail(req);
        if (!email) return res.json({ count: 0, unreadCount: 0 });

        try {
            const userInfo = await _resolveUserInfo(email);
            if (!userInfo.pernr) return res.json({ count: 0, unreadCount: 0 });

            let items = await getNotificationItems(email, userInfo.pernr, userInfo.isManager);
            items = await mergeReadState(items, userInfo.pernr);
            
            // Lọc những thông báo đã đọc/bỏ qua
            items = items.filter(i => !i.isRead);

            res.json({ count: items.length, unreadCount: items.length });
        } catch (error) {
            console.error('[Notification] Count error:', error.message);
            res.json({ count: 0, unreadCount: 0 });
        }
    });

    // --- POST /api/notifications/read ---
    app.post('/api/notifications/read', async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        const { pernr, notifType, requestId } = req.body || {};
        if (!pernr || !notifType || !requestId) {
            return res.status(400).json({ error: 'pernr, notifType, and requestId are required.' });
        }
        try {
            const db = await cds.connect.to('db');
            const { NotificationRead } = db.entities('znxr09.db');
            // Upsert: check if exists
            const existing = await SELECT.one.from(NotificationRead).where({ pernr, notifType, requestId });
            if (existing) {
                await UPDATE(NotificationRead).set({ isRead: true, readAt: new Date().toISOString() }).where({ ID: existing.ID });
            } else {
                await INSERT.into(NotificationRead).entries({ pernr, notifType, requestId, isRead: true, readAt: new Date().toISOString() });
            }
            res.json({ success: true });
        } catch (error) {
            console.error('[Notification] Mark read error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    // --- POST /api/notifications/read-all ---
    app.post('/api/notifications/read-all', async (req, res) => {
        if (!req.isAuthenticated()) return res.status(401).json({ error: 'Unauthorized' });
        const email = getCurrentUserEmail(req);
        if (!email) return res.status(400).json({ error: 'Cannot determine email.' });

        try {
            const userInfo = await _resolveUserInfo(email);
            if (!userInfo.pernr) return res.json({ success: true, marked: 0 });

            const items = await getNotificationItems(email, userInfo.pernr, userInfo.isManager);
            const db = await cds.connect.to('db');
            const { NotificationRead } = db.entities('znxr09.db');

            let marked = 0;
            for (const item of items) {
                const existing = await SELECT.one.from(NotificationRead).where({ pernr: userInfo.pernr, notifType: item.type, requestId: item.id });
                if (existing) {
                    if (!existing.isRead) {
                        await UPDATE(NotificationRead).set({ isRead: true, readAt: new Date().toISOString() }).where({ ID: existing.ID });
                        marked++;
                    }
                } else {
                    await INSERT.into(NotificationRead).entries({ pernr: userInfo.pernr, notifType: item.type, requestId: item.id, isRead: true, readAt: new Date().toISOString() });
                    marked++;
                }
            }

            // Broadcast updated count via WebSocket
            _broadcastCountUpdate(email, userInfo.pernr, userInfo.isManager);

            res.json({ success: true, marked });
        } catch (error) {
            console.error('[Notification] Mark all read error:', error.message);
            res.status(500).json({ error: error.message });
        }
    });

    /**
     * Resolve user info (pernr, isManager) from email.
     * Caches result in request lifecycle.
     */
    async function _resolveUserInfo(email) {
        const axios = require('axios');
        const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
        const authHeader = getSapAuthHeader();
        const skillUrl = trimTrailingSlash(cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.url);

        for (const userId of [email, email.toUpperCase()]) {
            try {
                const resp = await axios.get(
                    skillUrl + "/UserProfile('" + encodeURIComponent(userId) + "')",
                    { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, httpsAgent, validateStatus: s => s < 500 }
                );
                if (resp.status === 200 && resp.data && resp.data.Pernr) {
                    return {
                        pernr: resp.data.Pernr,
                        isManager: resp.data.IsManager === true || resp.data.IsManager === 'X' || resp.data.IsManager === 'x',
                        email: userId
                    };
                }
            } catch (e) { /* continue */ }
        }
        return { pernr: null, isManager: false, email };
    }

    /**
     * Broadcast notification count update to a specific user via Socket.IO.
     */
    _broadcastCountUpdate = async function(email, pernr, isManager) {
        if (!io) return;
        try {
            let items = await getNotificationItems(email, pernr, isManager);
            items = await mergeReadState(items, pernr);
            
            // Lọc bỏ những items đã đọc
            items = items.filter(i => !i.isRead);

            const room = 'user:' + email.toLowerCase();
            io.to(room).emit('notificationUpdate', { count: items.length, unreadCount: items.length });
        } catch (e) {
            console.error('[WS] broadcastCountUpdate error:', e.message);
        }
    }

    /**
     * Broadcast to ALL connected users — used by server-side polling loop.
     */
    _broadcastToAllUsers = function() {
        if (!io) return;
        const rooms = io.sockets.adapter.rooms;
        rooms.forEach((sockets, room) => {
            if (room.startsWith('user:')) {
                const email = room.replace('user:', '');
                // Find any socket in that room to get user info
                const socketId = Array.from(sockets)[0];
                const socket = io.sockets.sockets.get(socketId);
                if (socket && socket.userInfo) {
                    _broadcastCountUpdate(email, socket.userInfo.pernr, socket.userInfo.isManager);
                }
            }
        });
    }

});

// ================================================================
// Socket.IO Initialization — after CDS HTTP server starts
// ================================================================
cds.on('listening', ({ server }) => {
    io = new SocketIOServer(server, {
        cors: { origin: '*' },
        path: '/socket.io'
    });

    // Share express-session with Socket.IO for authentication
    const sessionMiddleware = session({
        secret: 'skillcert-secret-key',
        resave: false,
        saveUninitialized: false
    });

    io.engine.use(sessionMiddleware);
    io.engine.use(passport.initialize());
    io.engine.use(passport.session());

    io.on('connection', async (socket) => {
        const req = socket.request;
        if (!req.user || !req.user.emails || !req.user.emails[0]) {
            console.warn('[WS] Unauthenticated socket connection, disconnecting.');
            socket.disconnect(true);
            return;
        }

        const email = req.user.emails[0].value || '';
        const room = 'user:' + email.toLowerCase();
        socket.join(room);
        console.log('[WS] User joined:', email);

        // Resolve and cache user info on the socket
        try {
            if (req.session && req.session.userInfo) {
                socket.userInfo = {
                    pernr: req.session.userInfo.pernr,
                    isManager: req.session.userInfo.isManager
                };
            } else {
                const axios = require('axios');
                const httpsAgent = new (require('https').Agent)({ rejectUnauthorized: false });
                const authHeader = 'Basic ' + Buffer.from((process.env.UI5_USERNAME || 'DEV-271') + ':' + (process.env.UI5_PASSWORD || 'Hanoi@12345')).toString('base64');
                const skillUrl = (cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.url || '').replace(/\/+$/, '');

                for (const userId of [email, email.toUpperCase()]) {
                    const resp = await axios.get(
                        skillUrl + "/UserProfile('" + encodeURIComponent(userId) + "')",
                        { headers: { 'Authorization': authHeader, 'Accept': 'application/json' }, httpsAgent, validateStatus: s => s < 500 }
                    ).catch(() => null);
                    if (resp && resp.status === 200 && resp.data && resp.data.Pernr) {
                        socket.userInfo = {
                            pernr: resp.data.Pernr,
                            isManager: resp.data.IsManager === true || resp.data.IsManager === 'X'
                        };
                        break;
                    }
                }
            }
        } catch (e) {
            console.error('[WS] Error resolving user info:', e.message);
        }

        // Send initial count immediately
        if (socket.userInfo) {
            try {
                const items = await getNotificationItems(email, socket.userInfo.pernr, socket.userInfo.isManager);
                const merged = await mergeReadState(items, socket.userInfo.pernr);
                const unreadCount = merged.filter(i => !i.isRead).length;
                socket.emit('notificationUpdate', { count: merged.length, unreadCount });
            } catch (e) {
                console.error('[WS] Initial count error:', e.message);
            }
        }

        socket.on('disconnect', () => {
            console.log('[WS] User disconnected:', email);
        });
    });

    // Server-side polling loop: check SAP for changes every 60 seconds
    setInterval(() => {
        _broadcastToAllUsers();
    }, 60000);

    console.log('[WS] Socket.IO notification server initialized.');
});


module.exports = cds.server;
