const cds = require('@sap/cds');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
require('dotenv').config();

// Disable TLS validation for S40 self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
    function(accessToken, refreshToken, profile, cb) {
        // Here you would find or create user in your DB.
        // For our mock, we just pass the profile.
        return cb(null, profile);
    }));

    passport.serializeUser(function(user, cb) {
        cb(null, user);
    });

    passport.deserializeUser(function(obj, cb) {
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
        function(req, res) {
            // Successful authentication, redirect to Fiori Launchpad.
            res.redirect('/launchpad/');
        });

    app.get('/auth/logout', (req, res, next) => {
        req.logout(function(err) {
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
                res.json({
                    authorized: true,
                    userId: req.user.id,
                    email: sapEmail, // Trả về đúng email đã match (có thể là IN HOA) để UI5 binding không bị lỗi
                    name: name,
                    pernr: profile.Pernr,
                    employeeName: profile.EmployeeName || name,
                    isManager: profile.IsManager === true || profile.IsManager === 'X' || profile.IsManager === 'x'
                });
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

});

module.exports = cds.server;
