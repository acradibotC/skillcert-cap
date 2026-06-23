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

            const profileResp = await axios.get(
                sapUrl + "/UserProfile('" + encodeURIComponent(email) + "')",
                {
                    headers: {
                        'Authorization': 'Basic ' + Buffer.from(sapUser + ':' + sapPass).toString('base64'),
                        'Accept': 'application/json'
                    },
                    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }),
                    validateStatus: (s) => s < 500 // Don't throw on 404
                }
            );

            if (profileResp.status === 200 && profileResp.data && profileResp.data.Pernr) {
                const profile = profileResp.data;
                res.json({
                    authorized: true,
                    userId: req.user.id,
                    email: email,
                    name: name,
                    pernr: profile.Pernr,
                    employeeName: profile.EmployeeName || name,
                    isManager: !!profile.IsManager
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
