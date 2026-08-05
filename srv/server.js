const cds = require('@sap/cds');
const express = require('express');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { Server: SocketIOServer } = require('socket.io');
const crypto = require('crypto');
const https = require('https');
require('dotenv').config();

// Global Socket.IO instance — set after CDS server starts listening
let io = null;
// Cache for last-known notification counts per user for change detection
const notifCountCache = new Map();

const isProduction = process.env.NODE_ENV === 'production';
const allowInsecureSapTls = !isProduction && process.env.ALLOW_INSECURE_SAP_TLS === 'true';
const sapHttpsAgent = new https.Agent({ rejectUnauthorized: !allowInsecureSapTls });
const configuredSessionSecret = process.env.SESSION_SECRET;

if (isProduction && !configuredSessionSecret) {
    throw new Error('SESSION_SECRET must be configured in production.');
}

const sessionMiddleware = session({
    secret: configuredSessionSecret || crypto.randomBytes(48).toString('hex'),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 8 * 60 * 60 * 1000
    }
});

function getSapCredentials() {
    const username = process.env.UI5_USERNAME;
    const password = process.env.UI5_PASSWORD;
    if (!username || !password) {
        const error = new Error('SAP technical credentials are not configured.');
        error.statusCode = 503;
        throw error;
    }
    return { username, password };
}

function isConfiguredProfileHrEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    return String(process.env.PROFILE_HR_EMAILS || '')
        .split(',')
        .map(value => value.trim().toLowerCase())
        .filter(Boolean)
        .includes(normalized);
}

function isProfileHrAdmin(email, orgUnitId) {
    return isConfiguredProfileHrEmail(email) || isHrOrgUnit(orgUnitId);
}

function configuredHrOrgUnitIds() {
    return new Set(
        String(process.env.HR_ORG_UNIT_IDS || '50009040')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean)
    );
}

function isHrOrgUnit(orgUnitId) {
    const normalized = String(orgUnitId || '').trim();
    return Boolean(normalized && configuredHrOrgUnitIds().has(normalized));
}

function canUseHrTools(orgUnitId, email) {
    return isConfiguredProfileHrEmail(email) || isHrOrgUnit(orgUnitId);
}

function sessionUserMatches(req) {
    const sessionUserId = String(req.session?.userInfo?.userId || '').trim();
    const passportUserId = String(req.user?.id || '').trim();
    return Boolean(sessionUserId && passportUserId && sessionUserId === passportUserId);
}

// Module-scope references for notification functions — assigned inside cds.on('bootstrap')
let getNotificationItems, mergeReadState, _broadcastCountUpdate, _broadcastToAllUsers;
let profileNotificationListenerRegistered = false;

cds.on('bootstrap', app => {
    // Dynamically inject credentials for OData external service
    if (cds.env.requires && cds.env.requires.ZUI_NXR_SKILLREQ_O4 && cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials) {
        if (process.env.UI5_USERNAME && process.env.UI5_PASSWORD) {
            cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.username = process.env.UI5_USERNAME;
            cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.password = process.env.UI5_PASSWORD;
        }
    }

    if (cds.env.requires && cds.env.requires.ZUI_NXR_PROFILE_O4 && cds.env.requires.ZUI_NXR_PROFILE_O4.credentials) {
        if (process.env.UI5_USERNAME && process.env.UI5_PASSWORD) {
            cds.env.requires.ZUI_NXR_PROFILE_O4.credentials.username = process.env.UI5_USERNAME;
            cds.env.requires.ZUI_NXR_PROFILE_O4.credentials.password = process.env.UI5_PASSWORD;
        }
    }

    if (cds.env.requires && cds.env.requires.ZUI_NXR_WORKSCHEDULE_O4 && cds.env.requires.ZUI_NXR_WORKSCHEDULE_O4.credentials) {
        if (process.env.UI5_USERNAME && process.env.UI5_PASSWORD) {
            cds.env.requires.ZUI_NXR_WORKSCHEDULE_O4.credentials.username = process.env.UI5_USERNAME;
            cds.env.requires.ZUI_NXR_WORKSCHEDULE_O4.credentials.password = process.env.UI5_PASSWORD;
        }
    }

    if (cds.env.requires && cds.env.requires.ZUI_NXR_ATTREQ_O4 && cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials) {
        if (process.env.UI5_USERNAME && process.env.UI5_PASSWORD) {
            cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials.username = process.env.UI5_USERNAME;
            cds.env.requires.ZUI_NXR_ATTREQ_O4.credentials.password = process.env.UI5_PASSWORD;
        }
    }

    // Trust proxy to ensure secure secure cookies and proper HTTPS redirect URIs via Localtunnel
    app.set('trust proxy', 1);

    // Parse JSON bodies (required for /api/notifications/read POST)
    app.use(express.json());

    // Session setup
    app.use(sessionMiddleware);

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
        if (req.session) delete req.session.userInfo;
        req.logout(function (err) {
            if (err) { return next(err); }
            res.redirect('/logout');
        });
    });

    // Custom endpoint to get current user info for UI5.
    // The immutable OAuth subject -> Pernr link is validated against SAP.
    // Email is only used to bootstrap the link because work email is editable.
    app.get('/api/currentUser', async (req, res) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: "Unauthorized" });
        }

        const provider = 'google';
        const subject = String(req.user.id || '').trim();
        const email = req.user.emails && req.user.emails[0].value
            ? String(req.user.emails[0].value).trim()
            : '';
        const name = req.user.displayName || 'User';

        if (!subject || !email) {
            return res.status(403).json({
                authorized: false,
                code: 'LOGIN_IDENTITY_INCOMPLETE',
                userId: subject || null,
                email: email || null,
                name,
                pernr: null,
                errorMessage: 'The login identity does not contain the required subject and email claims.'
            });
        }

        if (req.session?.userInfo) {
            if (!sessionUserMatches(req)) {
                delete req.session.userInfo;
            } else {
                try {
                    const { ProfileIdentityLinks } = cds.entities('znxr09.db');
                    const cachedLink = ProfileIdentityLinks
                        ? await SELECT.one.from(ProfileIdentityLinks).where({ provider, subject })
                        : null;
                    if (cachedLink && cachedLink.active === false) {
                        delete req.session.userInfo;
                        return res.status(403).json({
                            authorized: false,
                            code: 'IDENTITY_LINK_REVOKED',
                            userId: subject,
                            email,
                            name,
                            pernr: null,
                            errorMessage: 'The login identity link has been revoked. Please contact your administrator.'
                        });
                    }
                } catch (error) {
                    console.error('[Auth] Cached identity-link validation failed:', error.message);
                    return res.status(503).json({
                        authorized: false,
                        code: 'IDENTITY_VALIDATION_UNAVAILABLE',
                        userId: subject,
                        email,
                        name,
                        pernr: null,
                        errorMessage: 'Unable to validate the login identity.'
                    });
                }
                req.session.userInfo.isHrAdmin = isProfileHrAdmin(req.session.userInfo.email, req.session.userInfo.orgUnitId);
                req.session.userInfo.canUseHrTools = canUseHrTools(
                    req.session.userInfo.orgUnitId,
                    req.session.userInfo.email
                );
                return res.json(req.session.userInfo);
            }
        }

        try {
            const axios = require('axios');
            const sapUrl = cds.env.requires.ZUI_NXR_SKILLREQ_O4.credentials.url;
            const { ProfileIdentityLinks } = cds.entities('znxr09.db');
            const identityLink = ProfileIdentityLinks
                ? await SELECT.one.from(ProfileIdentityLinks).where({ provider, subject })
                : null;
            if (identityLink && identityLink.active === false) {
                return res.status(403).json({
                    authorized: false,
                    code: 'IDENTITY_LINK_REVOKED',
                    userId: subject,
                    email,
                    name,
                    pernr: null,
                    errorMessage: 'The login identity link has been revoked. Please contact your administrator.'
                });
            }
            const { username: sapUser, password: sapPass } = getSapCredentials();

            const axiosConfig = {
                headers: {
                    'Authorization': 'Basic ' + Buffer.from(sapUser + ':' + sapPass).toString('base64'),
                    'Accept': 'application/json'
                },
                httpsAgent: sapHttpsAgent,
                validateStatus: (s) => s < 500
            };

            const extractProfile = (response) => {
                if (response.status === 200 && response.data && response.data.Pernr) {
                    return response.data;
                }
                const rows = normalizeODataRows(response.data);
                return response.status === 200 && rows.length > 0 && rows[0].Pernr ? rows[0] : null;
            };
            const ensureSapQuerySucceeded = (response) => {
                if (![200, 404].includes(response.status)) {
                    const error = new Error('SAP UserProfile validation is unavailable.');
                    error.statusCode = 503;
                    throw error;
                }
            };
            const readByEmail = async (candidateEmail) => {
                const escaped = escapeODataString(candidateEmail);
                const response = await axios.get(
                    trimTrailingSlash(sapUrl) + "/UserProfile('" + encodeURIComponent(escaped) + "')",
                    axiosConfig
                );
                ensureSapQuerySucceeded(response);
                return extractProfile(response);
            };
            const readByPernr = async (pernr) => {
                const filter = "Pernr eq '" + escapeODataString(pernr) + "'";
                const response = await axios.get(
                    trimTrailingSlash(sapUrl) + '/UserProfile?$filter=' + encodeURIComponent(filter) + '&$top=1',
                    axiosConfig
                );
                ensureSapQuerySucceeded(response);
                return extractProfile(response);
            };

            let profile = await readByEmail(email);
            if (!profile && email.toUpperCase() !== email) {
                profile = await readByEmail(email.toUpperCase());
            }
            if (!profile && identityLink) {
                profile = await readByPernr(identityLink.employeePernr);
            }

            if (profile && identityLink && String(profile.Pernr) !== String(identityLink.employeePernr)) {
                console.warn(`[Auth] OAuth subject "${subject}" resolved to a different Pernr than its stored identity link.`);
                return res.status(403).json({
                    authorized: false,
                    code: 'IDENTITY_LINK_CONFLICT',
                    userId: subject,
                    email,
                    sapUserId: profile.UserId || email,
                    name,
                    pernr: null,
                    errorMessage: 'The login identity conflicts with the registered employee record. Please contact your administrator.'
                });
            }

            if (profile && profile.Pernr) {
                if (ProfileIdentityLinks) {
                    await UPSERT.into(ProfileIdentityLinks).entries({
                        provider,
                        subject,
                        employeePernr: String(profile.Pernr),
                        loginEmail: email,
                        active: true
                    });
                }
                const userInfo = {
                    authorized: true,
                    userId: subject,
                    email,
                    sapUserId: profile.UserId || email,
                    name,
                    pernr: profile.Pernr,
                    employeeName: profile.EmployeeName || name,
                    position: profile.PositionName || profile.PositionId || '',
                    orgUnitId: String(profile.OrgUnitId || '').trim(),
                    department: profile.OrgUnitName || profile.OrgUnitId || '',
                    isManager: profile.IsManager === true || profile.IsManager === 'X' || profile.IsManager === 'x',
                    isHrAdmin: isProfileHrAdmin(email, profile.OrgUnitId),
                    canUseHrTools: canUseHrTools(profile.OrgUnitId, email)
                };
                if (req.session) req.session.userInfo = userInfo;
                res.json(userInfo);
            } else {
                console.warn(`[Auth] Login identity "${subject}" is not mapped to any Pernr in SAP UserProfile.`);
                res.status(403).json({
                    authorized: false,
                    code: 'EMPLOYEE_NOT_LINKED',
                    userId: subject,
                    email,
                    name,
                    pernr: null,
                    errorMessage: 'Your email (' + email + ') is not linked to any employee record. Please contact your administrator at sso@nexora.com to register your account.'
                });
            }
        } catch (error) {
            console.error('[Auth] Error checking UserProfile:', error.message);
            res.status(error.statusCode || 503).json({
                authorized: false,
                code: 'SAP_PROFILE_UNAVAILABLE',
                userId: subject,
                email,
                name,
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
        const { username: sapUser, password: sapPass } = getSapCredentials();
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

    const roundDashboardNumber = (value, digits = 2) => {
        const number = Number(value);
        if (!Number.isFinite(number)) return 0;
        const factor = Math.pow(10, digits);
        return Math.round((number + Number.EPSILON) * factor) / factor;
    };

    const normalizePernr = (value) => String(value || '').trim();

    const normalizeSapDate = (value) => {
        if (!value) return '';
        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return value.toISOString().slice(0, 10);
        }
        const raw = String(value).trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
        if (/^\d{8}$/.test(raw)) return raw.slice(0, 4) + '-' + raw.slice(4, 6) + '-' + raw.slice(6, 8);
        const match = /\/Date\((\d+)\)\//.exec(raw);
        if (match) return new Date(Number(match[1])).toISOString().slice(0, 10);
        return '';
    };

    const normalizeSapTime = (value) => {
        if (value === null || value === undefined || value === '') return '';
        if (typeof value === 'object' && value.ms !== undefined) {
            const totalSeconds = Math.floor(Number(value.ms) / 1000);
            const hours = Math.floor(totalSeconds / 3600) % 24;
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            return [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':');
        }
        const raw = String(value).trim();
        const duration = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/i.exec(raw);
        if (duration) {
            const hours = Number(duration[1] || 0);
            const minutes = Number(duration[2] || 0);
            const seconds = Math.floor(Number(duration[3] || 0));
            return [hours, minutes, seconds].map(part => String(part).padStart(2, '0')).join(':');
        }
        const time = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw);
        if (time) {
            return [
                String(Number(time[1])).padStart(2, '0'),
                time[2],
                time[3] || '00'
            ].join(':');
        }
        if (/^\d{6}$/.test(raw)) return raw.slice(0, 2) + ':' + raw.slice(2, 4) + ':' + raw.slice(4, 6);
        return '';
    };

    const timeToMinutes = (value) => {
        const normalized = normalizeSapTime(value);
        const match = /^(\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
        if (!match) return null;
        const minutes = Number(match[1]) * 60 + Number(match[2]) + Number(match[3]) / 60;
        return minutes === 0 ? null : minutes;
    };

    const grossHoursBetween = (start, end) => {
        const startMinutes = timeToMinutes(start);
        const endMinutes = timeToMinutes(end);
        if (startMinutes === null || endMinutes === null) return 0;
        const diffMinutes = endMinutes >= startMinutes
            ? endMinutes - startMinutes
            : (24 * 60 - startMinutes) + endMinutes;
        return diffMinutes / 60;
    };

    const breakHoursFor = (grossHours) => {
        if (grossHours > 12) return 2;
        if (grossHours > 8) return 1.5;
        if (grossHours > 4) return 1;
        return 0;
    };

    const netHoursBetween = (start, end) => {
        const grossHours = grossHoursBetween(start, end);
        if (grossHours <= 0) return 0;
        return Math.max(0, grossHours - breakHoursFor(grossHours));
    };

    const sapBoolean = (value) => {
        if (value === true) return true;
        const raw = String(value || '').trim().toUpperCase();
        return raw === 'X' || raw === 'TRUE' || raw === '1';
    };

    const fetchODataRows = async (axios, initialUrl, config, maxPages = 20) => {
        const rows = [];
        let nextUrl = initialUrl;
        let page = 0;
        while (nextUrl && page < maxPages) {
            const response = await axios.get(nextUrl, config);
            rows.push(...normalizeODataRows(response.data));
            const nextLink = response.data && (response.data['@odata.nextLink'] || response.data.d?.__next);
            nextUrl = nextLink ? new URL(nextLink, nextUrl).toString() : '';
            page += 1;
        }
        return rows;
    };

    const resolveDashboardTeamFromSap = async (axios, requester, scope, config) => {
        const currentEmployee = {
            Pernr: normalizePernr(requester.pernr),
            EmployeeName: requester.employeeName || requester.name || '',
            OrgUnitName: requester.department || ''
        };
        if (scope === 'EMPLOYEE' || !requester.email) return [currentEmployee];

        const skillCredentials = cds.env.requires?.ZUI_NXR_SKILLREQ_O4?.credentials;
        const skillUrl = trimTrailingSlash(skillCredentials?.url || '');
        if (!skillUrl) return [currentEmployee];

        const managerIds = Array.from(new Set([
            requester.email,
            String(requester.email || '').toUpperCase(),
            requester.sapUserId
        ].filter(Boolean)));
        const teamFilter = managerIds.map(id => "ManagerUserId eq '" + escapeODataString(id) + "'").join(' or ');
        let teamRows = [];
        if (teamFilter) {
            try {
                teamRows = await fetchODataRows(
                    axios,
                    skillUrl + "/TeamMembers?$filter=" + encodeURIComponent(teamFilter) + "&$top=500",
                    config,
                    5
                );
            } catch (error) {
                console.warn('[Dashboard] TeamMembers lookup failed, using current employee fallback:', error.message);
            }
        }

        const employeeByPernr = new Map();
        teamRows.forEach(row => {
            const pernr = normalizePernr(row.EmployeePernr || row.Pernr);
            if (!pernr) return;
            employeeByPernr.set(pernr, {
                Pernr: pernr,
                EmployeeName: row.EmployeeName || row.FullName || '',
                OrgUnitName: row.OrgUnitName || row.DepartmentName || row.OrgUnitText || ''
            });
        });

        if (employeeByPernr.size === 0 && managerSubordinateFallbacks[currentEmployee.Pernr]) {
            managerSubordinateFallbacks[currentEmployee.Pernr].forEach(row => {
                const pernr = normalizePernr(row.pernr);
                if (pernr) {
                    employeeByPernr.set(pernr, {
                        Pernr: pernr,
                        EmployeeName: row.name || '',
                        OrgUnitName: ''
                    });
                }
            });
        }

        if (scope === 'HR' && employeeByPernr.size === 0) {
            console.warn('[Dashboard] HR-wide employee source is not available yet; using current employee fallback.');
        }

        return employeeByPernr.size > 0 ? Array.from(employeeByPernr.values()) : [currentEmployee];
    };

    const classifyAttendanceStatus = (row) => {
        const status = String(row.AttendanceStatus || '').trim().toUpperCase();
        if (status === '1' || status === '01' || status.includes('FULL')) return 'FULL';
        if (status === '2' || status === '02' || status.includes('LATE') || status.includes('EARLY')) return 'LATE_EARLY';
        if (status === '3' || status === '03' || status.includes('ABSENT')) return 'ABSENT';
        if (status === '4' || status === '04' || status === '5' || status === '05' || row.LeaveType || row.LeaveName) return 'LEAVE';
        return '';
    };

    const isScheduledWorkDay = (row) => {
        if (sapBoolean(row.IsHoliday)) return false;
        const shift = String(row.ShiftCode || '').trim().toUpperCase();
        if (!shift || ['OFF', 'REST', 'FREE', 'HOLIDAY', 'NONWORK'].includes(shift)) return false;
        return Boolean(timeToMinutes(row.StartTime) && timeToMinutes(row.EndTime));
    };

    const aggregateDashboardRows = (teamMembers, workScheduleRows, range) => {
        const memberByPernr = new Map(teamMembers.map(member => [member.Pernr, { ...member }]));
        const statsByPernr = new Map();
        teamMembers.forEach(member => {
            statsByPernr.set(member.Pernr, {
                Pernr: member.Pernr,
                EmployeeName: member.EmployeeName || '',
                OrgUnitName: member.OrgUnitName || '',
                actualHours: 0,
                targetHours: 0,
                workingDays: 0,
                fullDays: 0,
                lateEarlyDays: 0,
                absentDays: 0
            });
        });

        workScheduleRows.forEach(row => {
            const pernr = normalizePernr(row.Pernr);
            const workDate = normalizeSapDate(row.WorkDate);
            if (!pernr || !workDate || workDate < range.from || workDate > range.to) return;
            if (!statsByPernr.has(pernr)) {
                const member = memberByPernr.get(pernr) || {};
                statsByPernr.set(pernr, {
                    Pernr: pernr,
                    EmployeeName: member.EmployeeName || row.EmployeeName || '',
                    OrgUnitName: member.OrgUnitName || row.DepartmentName || row.OrgUnitName || '',
                    actualHours: 0,
                    targetHours: 0,
                    workingDays: 0,
                    fullDays: 0,
                    lateEarlyDays: 0,
                    absentDays: 0
                });
            }
            const stats = statsByPernr.get(pernr);
            if (!stats.EmployeeName && row.EmployeeName) stats.EmployeeName = row.EmployeeName;
            if (!stats.OrgUnitName && (row.DepartmentName || row.OrgUnitName)) stats.OrgUnitName = row.DepartmentName || row.OrgUnitName;

            const scheduled = isScheduledWorkDay(row);
            if (!scheduled) return;

            const targetHours = netHoursBetween(row.StartTime, row.EndTime) || 8;
            const actualHours = netHoursBetween(row.ActualStartTime, row.ActualEndTime);
            const status = classifyAttendanceStatus(row);

            stats.workingDays += 1;
            stats.targetHours += targetHours;
            stats.actualHours += actualHours;
            if (status === 'FULL') stats.fullDays += 1;
            if (status === 'LATE_EARLY') stats.lateEarlyDays += 1;
            if (status === 'ABSENT') stats.absentDays += 1;
        });

        const employees = Array.from(statsByPernr.values()).map(stats => {
            const actual = roundDashboardNumber(stats.actualHours);
            const target = roundDashboardNumber(stats.targetHours);
            const variance = roundDashboardNumber(actual - target);
            return {
                Pernr: stats.Pernr,
                EmployeeName: stats.EmployeeName || stats.Pernr,
                OrgUnitName: stats.OrgUnitName || 'Unassigned',
                ActualHours: actual,
                TargetHours: target,
                VarianceHours: variance,
                VarianceState: variance < 0 ? 'Error' : 'Success',
                AchievementRate: target > 0 ? roundDashboardNumber((actual / target) * 100) : 0
            };
        });

        const totalEmployees = employees.length;
        const totals = Array.from(statsByPernr.values()).reduce((acc, stats) => {
            acc.actualHours += stats.actualHours;
            acc.targetHours += stats.targetHours;
            acc.workingDays += stats.workingDays;
            acc.fullDays += stats.fullDays;
            acc.lateEarlyDays += stats.lateEarlyDays;
            acc.absentDays += stats.absentDays;
            return acc;
        }, { actualHours: 0, targetHours: 0, workingDays: 0, fullDays: 0, lateEarlyDays: 0, absentDays: 0 });

        const orgGroups = new Map();
        employees.forEach(employee => {
            const orgUnit = employee.OrgUnitName || 'Unassigned';
            if (!orgGroups.has(orgUnit)) {
                orgGroups.set(orgUnit, {
                    OrgUnitName: orgUnit,
                    EmployeeCount: 0,
                    ActualHours: 0,
                    TargetHours: 0
                });
            }
            const group = orgGroups.get(orgUnit);
            group.EmployeeCount += 1;
            group.ActualHours += Number(employee.ActualHours || 0);
            group.TargetHours += Number(employee.TargetHours || 0);
        });

        return {
            summary: {
                totalEmployees,
                avgActualHours: totalEmployees > 0 ? roundDashboardNumber(totals.actualHours / totalEmployees) : 0,
                fullAttendanceRate: totals.workingDays > 0 ? roundDashboardNumber((totals.fullDays / totals.workingDays) * 100) : 0,
                lateEarlyRate: totals.workingDays > 0 ? roundDashboardNumber((totals.lateEarlyDays / totals.workingDays) * 100) : 0,
                absentRate: totals.workingDays > 0 ? roundDashboardNumber((totals.absentDays / totals.workingDays) * 100) : 0
            },
            byOrgUnit: Array.from(orgGroups.values()).map(group => ({
                ...group,
                ActualHours: roundDashboardNumber(group.ActualHours),
                TargetHours: roundDashboardNumber(group.TargetHours)
            })),
            employees,
            dataAsOf: 'Data as of ' + new Date().toISOString()
        };
    };

    const loadDashboardFromWorkSchedule = async (req, scope, range) => {
        const axios = require('axios');
        const workScheduleCredentials = cds.env.requires?.ZUI_NXR_WORKSCHEDULE_O4?.credentials;
        const workScheduleUrl = trimTrailingSlash(workScheduleCredentials?.url || '');
        if (!workScheduleUrl) {
            const error = new Error('Work schedule service is not configured.');
            error.statusCode = 503;
            throw error;
        }

        const config = {
            headers: { Authorization: getSapAuthHeader(), Accept: 'application/json' },
            httpsAgent: sapHttpsAgent
        };
        const requester = req.session.userInfo;
        const teamMembers = await resolveDashboardTeamFromSap(axios, requester, scope, config);
        const workRows = [];

        for (const member of teamMembers) {
            const pernr = normalizePernr(member.Pernr);
            if (!pernr) continue;
            const filter = "Pernr eq '" + escapeODataString(pernr) + "'";
            const rows = await fetchODataRows(
                axios,
                workScheduleUrl + "/WorkSchedule?$filter=" + encodeURIComponent(filter) + "&$top=500",
                config,
                5
            );
            workRows.push(...rows);
        }

        return aggregateDashboardRows(teamMembers, workRows, range);
    };

    const dashboardScopeFor = (req) => {
        const user = req.session && req.session.userInfo;
        if (!sessionUserMatches(req) || !user || !user.authorized || !user.pernr) return null;
        if (user.isHrAdmin) return 'HR';
        if (user.isManager) return 'MANAGER';
        return 'EMPLOYEE';
    };

    const dashboardDateRange = (req) => {
        const from = String(req.query.periodFrom || '');
        const to = String(req.query.periodTo || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return null;
        const days = Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000) + 1;
        return days >= 1 && days <= 31 ? { from, to } : null;
    };

    // Dashboard is intentionally a CAP BFF: client filters are validated against
    // the authenticated session and the S40 binding is never exposed to browsers.
    app.get('/api/v6/dashboard', async (req, res) => {
        const scope = dashboardScopeFor(req);
        const range = dashboardDateRange(req);
        if (!scope) return res.status(401).json({ error: 'Unauthorized' });
        if (!range) return res.status(400).json({ error: 'Select a period from 1 to 31 days.' });

        const dashboardUrl = trimTrailingSlash(process.env.DASHBOARD_API_URL || '');
        if (!dashboardUrl) {
            try {
                return res.json(await loadDashboardFromWorkSchedule(req, scope, range));
            } catch (error) {
                const status = error.statusCode || error.response?.status || 502;
                const message = error.response?.data?.error?.message || error.message;
                console.error('[Dashboard] WorkSchedule fallback failed:', message);
                return res.status(status).json({ error: 'Unable to load dashboard data.' });
            }
        }

        try {
            const axios = require('axios');
            const requester = req.session.userInfo;
            const commonFilter = [
                "PeriodFrom eq '" + escapeODataString(range.from) + "'",
                "PeriodTo eq '" + escapeODataString(range.to) + "'",
                "RequesterPernr eq '" + escapeODataString(requester.pernr) + "'",
                "RequesterScope eq '" + scope + "'"
            ].join(' and ');
            const config = { headers: { Authorization: getSapAuthHeader(), Accept: 'application/json' }, httpsAgent: sapHttpsAgent };
            const [summaryResponse, orgResponse, employeeResponse] = await Promise.all([
                axios.get(dashboardUrl + '/DashboardKpi?$filter=' + encodeURIComponent(commonFilter), config),
                axios.get(dashboardUrl + '/DashboardOrgUnit?$filter=' + encodeURIComponent(commonFilter), config),
                axios.get(dashboardUrl + '/DashboardEmployee?$filter=' + encodeURIComponent(commonFilter), config)
            ]);
            const summary = normalizeODataRows(summaryResponse.data)[0] || {};
            const employees = normalizeODataRows(employeeResponse.data).map(row => ({
                ...row,
                VarianceState: Number(row.VarianceHours) < 0 ? 'Error' : 'Success'
            }));
            res.json({
                summary: {
                    totalEmployees: Number(summary.TotalEmployees || 0),
                    avgActualHours: Number(summary.AvgActualHours || 0),
                    fullAttendanceRate: Number(summary.FullAttendanceRate || 0),
                    lateEarlyRate: Number(summary.LateEarlyRate || 0),
                    absentRate: Number(summary.AbsentRate || 0)
                },
                byOrgUnit: normalizeODataRows(orgResponse.data),
                employees,
                dataAsOf: summary.DataAsOf ? 'Data as of ' + summary.DataAsOf : ''
            });
        } catch (error) {
            const status = error.response && error.response.status ? error.response.status : 502;
            const message = error.response?.data?.error?.message || error.message;
            console.error('[Dashboard] S40 query failed:', message);
            res.status(status).json({ error: 'Unable to load dashboard data.' });
        }
    });

    app.get('/api/v6/dashboard/export', (req, res) => {
        const scope = dashboardScopeFor(req);
        const range = dashboardDateRange(req);
        const format = String(req.query.format || '').toLowerCase();
        if (!scope) return res.status(401).json({ error: 'Unauthorized' });
        if (!range || !['xlsx', 'pdf'].includes(format)) return res.status(400).json({ error: 'Invalid dashboard export request.' });
        // Export is enabled with the same S40 contract after the dashboard binding
        // is transportable. Until then, do not generate an unscoped client export.
        return res.status(503).json({ error: 'Dashboard export is not configured.' });
    });

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
            const httpsAgent = sapHttpsAgent;
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
            const httpsAgent = sapHttpsAgent;
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

    const ensureHrToolsAuthorized = (req, res, next) => {
        const userInfo = req.session && req.session.userInfo;
        if (!sessionUserMatches(req) || !userInfo || !userInfo.authorized) {
            return res.status(403).json({
                code: 'HR_TOOLS_IDENTITY_NOT_VALIDATED',
                error: 'The login identity has not been validated against an employee record.'
            });
        }

        const authorized = canUseHrTools(userInfo.orgUnitId, userInfo.email);
        userInfo.canUseHrTools = authorized;
        if (!authorized) {
            return res.status(403).json({
                code: 'HR_TOOLS_FORBIDDEN',
                error: 'HR Tools permission requires membership in an authorized HR organizational unit.'
            });
        }
        next();
    };

    // Serve UI5 app resources only after authentication. The launchpad loads
    // child components from these routes, so each route needs a real static root.
    app.use('/launchpad', ensureAuthenticated, express.static(path.join(__dirname, '../app/launchpad/webapp')));
    app.use('/profile/webapp', ensureAuthenticated, express.static(path.join(__dirname, '../app/profile/webapp')));
    app.use('/timesheet/webapp', ensureAuthenticated, express.static(path.join(__dirname, '../app/timesheet/webapp')));
    app.get(
        ['/hr-upload', '/hr-upload/'],
        ensureAuthenticated,
        ensureHrToolsAuthorized,
        (req, res) => res.redirect('/hr-upload/webapp/')
    );
    app.use(
        '/hr-upload/webapp',
        ensureAuthenticated,
        ensureHrToolsAuthorized,
        express.static(path.join(__dirname, '../app/hr-upload/webapp'))
    );
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
    }, ensureHrToolsAuthorized);

    // MyProfile API requires both OAuth authentication and an employee mapping.
    app.use('/api/profile/v1', async (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ code: 'UNAUTHENTICATED', error: 'Unauthorized. Please log in.' });
        }
        if (!sessionUserMatches(req) || !req.session?.userInfo?.authorized || !req.session.userInfo.pernr) {
            if (req.session) delete req.session.userInfo;
            return res.status(403).json({
                code: 'IDENTITY_CONTEXT_MISMATCH',
                error: 'The authenticated identity must be mapped again.'
            });
        }
        try {
            const { ProfileIdentityLinks } = cds.entities('znxr09.db');
            const identityLink = ProfileIdentityLinks
                ? await SELECT.one.from(ProfileIdentityLinks).where({
                    provider: 'google',
                    subject: String(req.user.id)
                })
                : null;
            if (identityLink && identityLink.active === false) {
                delete req.session.userInfo;
                return res.status(403).json({ code: 'IDENTITY_LINK_REVOKED', error: 'The login identity link has been revoked.' });
            }
        } catch (error) {
            console.error('[Auth] Identity-link validation failed:', error.message);
            return res.status(503).json({ code: 'IDENTITY_VALIDATION_UNAVAILABLE', error: 'Unable to validate the login identity.' });
        }
        req.session.userInfo.isHrAdmin = isProfileHrAdmin(req.session.userInfo.email, req.session.userInfo.orgUnitId);
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

    const PROFILE_STATUS_NOTIFICATIONS = {
        '02': {
            type: 'PROFILE_APPROVED',
            title: 'Profile Change Request — Approved',
            description: 'Your profile change request was approved and queued for SAP processing.',
            priority: 'Low',
            icon: 'sap-icon://accept'
        },
        '03': {
            type: 'PROFILE_REJECTED',
            title: 'Profile Change Request — Rejected',
            description: 'Your profile change request was rejected.',
            priority: 'High',
            icon: 'sap-icon://decline'
        },
        '04': {
            type: 'PROFILE_REVISION',
            title: 'Profile Change Request — Revision Required',
            description: 'HR requested changes for your profile update request.',
            priority: 'Medium',
            icon: 'sap-icon://edit'
        }
    };

    const teamMembersCache = new Map();
    const TEAM_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

    async function appendProfileNotificationItems(items, pernr, isHrAdmin) {
        try {
            const db = await cds.connect.to('db');
            const { ProfileChangeRequests } = db.entities('znxr09.db');
            if (!ProfileChangeRequests) return;

            if (isHrAdmin) {
                const pendingRows = await SELECT.from(ProfileChangeRequests).where({ status: '01' });
                pendingRows
                    .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
                    .slice(0, 50)
                    .forEach(row => {
                        const empName = row.employeeName || row.employeePernr || 'Employee';
                        items.push({
                            id: row.ID,
                            type: 'PROFILE_PENDING',
                            requestType: 'PROFILE_CHANGE',
                            title: 'Profile Change Request — Pending',
                            description: empName + ' submitted a profile change request',
                            datetime: row.createdAt,
                            datetimeText: row.createdAt ? _formatRelativeTime(row.createdAt) : '',
                            priority: 'High',
                            icon: 'sap-icon://employee-rejections',
                            navigateTo: 'profileApprovals',
                            authorName: empName
                        });
                    });
            }

            if (pernr) {
                const ownRows = await SELECT.from(ProfileChangeRequests).where({ employeePernr: String(pernr) });
                ownRows
                    .filter(row => PROFILE_STATUS_NOTIFICATIONS[row.status])
                    .sort((left, right) =>
                        String(right.decisionAt || right.modifiedAt || right.createdAt || '')
                            .localeCompare(String(left.decisionAt || left.modifiedAt || left.createdAt || ''))
                    )
                    .slice(0, 30)
                    .forEach(row => {
                        const template = PROFILE_STATUS_NOTIFICATIONS[row.status];
                        const timeStr = row.decisionAt || row.modifiedAt || row.createdAt;
                        items.push({
                            id: row.ID,
                            type: template.type,
                            requestType: 'PROFILE_CHANGE',
                            title: template.title,
                            description: row.hrComment
                                ? template.description + ' HR comment: ' + row.hrComment
                                : template.description,
                            datetime: timeStr,
                            datetimeText: timeStr ? _formatRelativeTime(timeStr) : '',
                            priority: template.priority,
                            icon: template.icon,
                            navigateTo: 'profile',
                            authorName: row.employeeName || ''
                        });
                    });
            }
        } catch (err) {
            console.error('[Notification] Error fetching profile items:', err.message);
        }
    }

    /**
     * Build notification items by querying SAP OData services.
     * For managers: pending requests from team members
     * For employees: recently processed (approved/rejected) requests
     */
    getNotificationItems = async function(email, pernr, isManager, isHrAdmin) {
        const axios = require('axios');
        const httpsAgent = sapHttpsAgent;
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

        await appendProfileNotificationItems(items, pernr, isHrAdmin);
        items.sort((left, right) =>
            String(right.datetime || '').localeCompare(String(left.datetime || '')) ||
            String(left.id || '').localeCompare(String(right.id || ''))
        );

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

            let items = await getNotificationItems(email, userInfo.pernr, userInfo.isManager, userInfo.isHrAdmin);
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

            let items = await getNotificationItems(email, userInfo.pernr, userInfo.isManager, userInfo.isHrAdmin);
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

            const items = await getNotificationItems(email, userInfo.pernr, userInfo.isManager, userInfo.isHrAdmin);
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
            _broadcastCountUpdate(email, userInfo.pernr, userInfo.isManager, userInfo.isHrAdmin);

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
        const httpsAgent = sapHttpsAgent;
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
                        isHrAdmin: isProfileHrAdmin(email, resp.data.OrgUnitId),
                        email: userId
                    };
                }
            } catch (e) { /* continue */ }
        }
        return { pernr: null, isManager: false, isHrAdmin: isProfileHrAdmin(email), email };
    }

    /**
     * Broadcast notification count update to a specific user via Socket.IO.
     */
    _broadcastCountUpdate = async function(email, pernr, isManager, isHrAdmin) {
        if (!io) return;
        try {
            let items = await getNotificationItems(email, pernr, isManager, isHrAdmin);
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
                    _broadcastCountUpdate(email, socket.userInfo.pernr, socket.userInfo.isManager, socket.userInfo.isHrAdmin);
                }
            }
        });
    }

    if (!profileNotificationListenerRegistered) {
        process.on('znxr09.profileNotificationsChanged', () => {
            if (_broadcastToAllUsers) {
                _broadcastToAllUsers();
            }
        });
        profileNotificationListenerRegistered = true;
    }

});

// ================================================================
// Socket.IO Initialization — after CDS HTTP server starts
// ================================================================
cds.on('listening', ({ server }) => {
    io = new SocketIOServer(server, {
        path: '/socket.io'
    });

    // Share the same express-session middleware with Socket.IO.
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

        // Reuse only the identity context established by /api/currentUser.
        // Never bootstrap a separate email -> Pernr mapping on the socket path.
        try {
            if (!sessionUserMatches(req) || !req.session.userInfo.authorized || !req.session.userInfo.pernr) {
                socket.disconnect(true);
                return;
            }
            const { ProfileIdentityLinks } = cds.entities('znxr09.db');
            const identityLink = ProfileIdentityLinks
                ? await SELECT.one.from(ProfileIdentityLinks).where({ provider: 'google', subject: String(req.user.id) })
                : null;
            if (identityLink && identityLink.active === false) {
                socket.disconnect(true);
                return;
            }
            socket.userInfo = {
                pernr: req.session.userInfo.pernr,
                isManager: req.session.userInfo.isManager,
                isHrAdmin: req.session.userInfo.isHrAdmin === true
            };
        } catch (e) {
            console.error('[WS] Error resolving user info:', e.message);
            socket.disconnect(true);
            return;
        }

        // Send initial count immediately
        if (socket.userInfo) {
            try {
                const items = await getNotificationItems(email, socket.userInfo.pernr, socket.userInfo.isManager, socket.userInfo.isHrAdmin);
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
