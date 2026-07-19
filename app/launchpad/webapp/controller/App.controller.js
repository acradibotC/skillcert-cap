sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/ComponentContainer",
    "sap/m/Page",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/ui/core/Theming",
    "sap/m/VBox",
    "sap/m/HBox",
    "sap/m/Text",
    "sap/m/Title",
    "sap/m/Link",
    "sap/ui/core/Icon"
], function (Controller, ComponentContainer, Page, JSONModel, Fragment, Theming, VBox, HBox, Text, Title, Link, Icon) {
    "use strict";

    return Controller.extend("znxr09.portal.controller.App", {
        onInit: function () {
            // Intercept browser back button to prevent navigating back to Google SSO
            window.history.pushState(null, null, window.location.href);
            window.addEventListener('popstate', function(event) {
                var oNavContainer = this.byId("navContainer");
                if (oNavContainer && oNavContainer.getCurrentPage() && oNavContainer.getCurrentPage().getId() !== this.createId("homePage")) {
                    this.onNavToHome();
                }
                // Always push state again to trap the back button within the app
                window.history.pushState(null, null, window.location.href);
            }.bind(this));

            // Set welcome date
            var oDate = new Date();
            var options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
            var sDateStr = oDate.toLocaleDateString('en-US', options);
            this.byId("welcomeDate").setText(sDateStr);
            
            // Initialize User Model
            var oUserModel = new JSONModel({
                name: "User",
                initials: "U",
                email: "",
                userId: "",
                server: window.location.hostname,
                theme: sap.ui.getCore().getConfiguration().getTheme(),
                shellTitle: "Nexora Employee Portal",
                activeNav: "home",
                authorized: null
            });
            this.getView().setModel(oUserModel, "user");

            // Initialize To-Do model
            var oTodoModel = new JSONModel({
                tasks: [],
                taskCount: 0,
                lastRefresh: ""
            });
            this.getView().setModel(oTodoModel, "todo");

            // Initialize Notification model
            var oNotifModel = new JSONModel({
                items: [],
                count: 0,
                unreadCount: 0
            });
            this.getView().setModel(oNotifModel, "notification");

            // Fetch user info from Google OAuth (via our /api/currentUser endpoint)
            jQuery.ajax({
                url: "/api/currentUser",
                method: "GET",
                success: function (oData) {
                    if (oData && oData.authorized === false) {
                        oUserModel.setProperty("/authorized", false);
                        // Email not mapped → show error page
                        var sMsg = oData.errorMessage || "Your email is not linked to any employee record.";
                        this.byId("errorMessage").setText(sMsg);
                        this.byId("navContainer").to(this.byId("errorPage"));
                        return;
                    }
                    oUserModel.setProperty("/authorized", true);
                    this.byId("navContainer").to(this.byId("homePage"));
                    this._setLaunchpadNavActive("home");

                    if (oData && (oData.employeeName || oData.name)) {
                        var sDisplayName = oData.employeeName || oData.name;
                        var initials = sDisplayName.split(' ').map(n => n[0]).join('').substring(0, 3).toUpperCase();
                        oUserModel.setProperty("/name", sDisplayName);
                        oUserModel.setProperty("/initials", initials);
                        oUserModel.setProperty("/email", oData.email ? oData.email.toLowerCase() : "");
                        oUserModel.setProperty("/userId", oData.pernr || oData.userId);
                        oUserModel.setProperty("/isManager", oData.isManager === true || oData.isManager === "X");
                        this.byId("welcomeGreeting").setText("Hi " + sDisplayName + ", great to see you!");
                    } else {
                        this.byId("welcomeGreeting").setText("Hi User, great to see you!");
                    }
                    // Load to-dos after user info is loaded
                    this._loadTodos();
                    // Initialize notifications + WebSocket
                    this._initNotifications();
                }.bind(this),
                error: function () {
                    oUserModel.setProperty("/authorized", true);
                    this.byId("navContainer").to(this.byId("homePage"));
                    this._setLaunchpadNavActive("home");
                    this.byId("welcomeGreeting").setText("Hi, great to see you!");
                    this._loadTodos();
                    this._initNotifications();
                }.bind(this)
            });
        },

        onRetryAuth: function () {
            // Reload page to re-trigger Google OAuth + UserProfile check
            window.location.reload();
        },

        onLogout: function () {
            window.location.href = "/auth/logout";
        },

        // =============================================
        // To-Dos: Fetch pending tasks from backend
        // =============================================
        _loadTodos: function () {
            var oTodoModel = this.getView().getModel("todo");
            var that = this;
            var bIsManager = this.getView().getModel("user").getProperty("/isManager");

            if (!bIsManager) {
                oTodoModel.setProperty("/tasks", []);
                oTodoModel.setProperty("/taskCount", 0);
                this._lastRefreshTime = new Date();
                this._updateRefreshText();
                this._renderTodoCards([]);
                return;
            }

            jQuery.ajax({
                url: "/api/manager/attendance-requests?status=01",
                method: "GET",
                cache: false, // Prevent browser caching so new/removed cards show up
                success: function (oData) {
                    var aItems = oData.value || [];
                    oTodoModel.setProperty("/tasks", aItems);
                    oTodoModel.setProperty("/taskCount", aItems.length);
                    that._lastRefreshTime = new Date();
                    that._updateRefreshText();
                    that._renderTodoCards(aItems);
                },
                error: function () {
                    oTodoModel.setProperty("/tasks", []);
                    oTodoModel.setProperty("/taskCount", 0);
                    that._lastRefreshTime = new Date();
                    that._updateRefreshText();
                }
            });

            // Start the interval if not already started
            if (!this._refreshInterval) {
                this._refreshInterval = setInterval(this._updateRefreshText.bind(this), 10000); // Check every 10 seconds for higher precision
            }
        },

        _updateRefreshText: function () {
            if (!this._lastRefreshTime) return;
            var iMins = Math.floor((new Date() - this._lastRefreshTime) / 60000);
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var sText = iMins === 0 ? oBundle.getText("lblJustNow") : oBundle.getText("lblMinAgo", [iMins]);
            this.getView().getModel("todo").setProperty("/lastRefresh", sText);
        },

        onRefreshTodos: function () {
            this._loadTodos();
        },

        _renderTodoCards: function (aTasks) {
            var oContainer = this.byId("todoCardsContainer");
            oContainer.removeAllItems();

            var that = this;
            var oBundle = this.getView().getModel("i18n").getResourceBundle();

            aTasks.forEach(function (oTask) {
                var sTypeLabel = that._getRequestTypeLabel(oTask.RequestType);
                var sIcon = that._getRequestTypeIcon(oTask.RequestType);
                var sCreated = oTask.CreatedAt ? new Date(oTask.CreatedAt).toLocaleDateString("en-CA") : "";
                var sEmployee = oTask.EmployeeName || oTask.Pernr || "Employee";
                var sTitle = sTypeLabel + " - " + sEmployee;

                var oCard = new VBox({
                    items: [
                        new HBox({
                            alignItems: "Center",
                            items: [
                                new VBox({
                                    justifyContent: "Center",
                                    alignItems: "Center",
                                    items: [
                                        new Icon({ src: sIcon, size: "1.25rem", color: "#555" })
                                    ]
                                }).addStyleClass("todoIconBox sapUiSmallMarginEnd"),
                                new VBox({
                                    items: [
                                        new Title({ text: sTitle, level: "H5", wrapping: true }).addStyleClass("todoTitle"),
                                        new Text({ text: oBundle.getText("priorityMedium") }).addStyleClass("todoPriority")
                                    ]
                                })
                            ]
                        }).addStyleClass("sapUiSmallMarginBottom"),
                        new Link({ text: oBundle.getText("sourceAttendance"), press: that._onViewTodo.bind(that) }).addStyleClass("todoSource"),
                        new VBox({
                            items: [
                                new Text({ text: oBundle.getText("lblCreatedOn") }).addStyleClass("todoLabel"),
                                new Text({ text: sCreated }).addStyleClass("todoDateValue")
                            ]
                        }).addStyleClass("sapUiSmallMarginTop"),
                        new HBox({
                            justifyContent: "End",
                            items: [
                                new sap.m.Button({ text: oBundle.getText("btnView"), press: that._onViewTodo.bind(that) }).addStyleClass("todoViewBtn")
                            ]
                        }).addStyleClass("todoBtnContainer")
                    ]
                }).addStyleClass("todoCard sapUiSmallMarginEnd sapUiSmallMarginBottom");

                oContainer.addItem(oCard);
            });
        },

        _getRequestTypeLabel: function (sType) {
            var oBundle = this.getView().getModel("i18n").getResourceBundle();
            var map = {
                "DAYOFF": oBundle.getText("reqDayOff"),
                "EDIT_TIMESHEET": oBundle.getText("reqEditTimesheet"),
                "OVERTIME": oBundle.getText("reqOvertime")
            };
            return map[sType] || oBundle.getText("reqOther");
        },

        _getRequestTypeIcon: function (sType) {
            var map = {
                "DAYOFF": "sap-icon://date-time",
                "EDIT_TIMESHEET": "sap-icon://edit",
                "OVERTIME": "sap-icon://overtime"
            };
            return map[sType] || "sap-icon://task";
        },

        _onViewTodo: function () {
            try {
                window.sessionStorage.setItem("znxr09.timesheet.reqViewMode", "manager");
            } catch (e) {
                // Session storage can be unavailable in strict browser modes; event bus below is the fallback.
            }

            // Navigate to Timesheet app -> Team Approval tab
            this.onNavToTimesheet();
            setTimeout(function () {
                sap.ui.getCore().getEventBus().publish("Launchpad", "NavToRequests", { mode: "manager" });
            }, 0);
        },

        onNavToHome: function () {
            var bIsAuthorized = this.getView().getModel("user").getProperty("/authorized");
            if (bIsAuthorized === false) {
                return;
            }
            this.getView().getModel("user").setProperty("/shellTitle", "Nexora Employee Portal");
            this._setLaunchpadNavActive("home");
            var oNavContainer = this.byId("navContainer");
            oNavContainer.to(this.byId("homePage"));
            this._scrollHomePageTo("homeHero");
            this._loadTodos(); // Ensure To-Dos refresh when returning to home
        },

        onNavToTodos: function () {
            this._goHomeAndScrollTo("todoSection", "todos");
        },

        onNavToEmployeeServices: function () {
            this._goHomeAndScrollTo("homeTilesSection", "employee");
        },

        onNavToHrTools: function () {
            this._goHomeAndScrollTo("hrSection", "hr");
        },

        onNavToProfile: function () {
            this._setLaunchpadNavActive("employee");
            this._navigateToApp("profilePage", "znxr09.znxr09f300", "/profile/webapp");
        },

        onNavToTimesheet: function () {
            this._setLaunchpadNavActive("time");
            this._navigateToApp("timesheetPage", "znxr09.timesheet", "/timesheet/webapp");
        },

        onNavToHrUpload: function () {
            this._setLaunchpadNavActive("hr");
            this._navigateToApp("hrUploadPage", "znxr09.hrupload", "/hr-upload/webapp");
        },

        _setLaunchpadNavActive: function (sKey) {
            var oModel = this.getView().getModel("user");
            if (oModel) {
                oModel.setProperty("/activeNav", sKey);
            }

            var mNavButtons = {
                home: "navHome",
                todos: "navTodos",
                employee: "navEmployee",
                time: "navTime",
                hr: "navHr"
            };

            Object.keys(mNavButtons).forEach(function (sNavKey) {
                var oButton = this.byId(mNavButtons[sNavKey]);
                if (oButton) {
                    oButton.toggleStyleClass("isActive", sNavKey === sKey);
                }
            }.bind(this));
        },

        _goHomeAndScrollTo: function (sSectionId, sNavKey) {
            var bIsAuthorized = this.getView().getModel("user").getProperty("/authorized");
            if (bIsAuthorized === false) {
                return;
            }

            this.getView().getModel("user").setProperty("/shellTitle", "Nexora Employee Portal");
            this._setLaunchpadNavActive(sNavKey);

            var oNavContainer = this.byId("navContainer");
            var oHomePage = this.byId("homePage");
            if (oNavContainer && oHomePage && oNavContainer.getCurrentPage() !== oHomePage) {
                oNavContainer.to(oHomePage);
            }

            this._scrollHomePageTo(sSectionId);
        },

        _scrollHomePageTo: function (sSectionId) {
            setTimeout(function () {
                var oSection = this.byId(sSectionId);
                var oDomRef = oSection && oSection.getDomRef();
                if (oDomRef && oDomRef.scrollIntoView) {
                    oDomRef.scrollIntoView({ behavior: "smooth", block: "start" });
                }
            }.bind(this), 250);
        },

        _navigateToApp: function (sPageId, sComponentName, sComponentUrl) {
            var oNavContainer = this.byId("navContainer");
            var oPage = this.byId(sPageId);

            if (!oPage) {
                sap.ui.getCore().loadLibrary("sap.m");
                var oComponentContainer = new ComponentContainer({
                    name: sComponentName,
                    manifest: true,
                    async: true,
                    url: sComponentUrl,
                    height: "100%"
                });

                oPage = new Page(this.createId(sPageId), {
                    showHeader: false,
                    content: [oComponentContainer]
                });

                oNavContainer.addPage(oPage);
            }

            oNavContainer.to(oPage);
        },

        onAvatarPress: function (oEvent) {
            var oButton = oEvent.getSource();
            var oView = this.getView();

            if (!this._pUserMenuPopover) {
                this._pUserMenuPopover = Fragment.load({
                    id: oView.getId(),
                    name: "znxr09.portal.view.UserMenu",
                    controller: this
                }).then(function(oPopover) {
                    oView.addDependent(oPopover);
                    return oPopover;
                });
            }
            this._pUserMenuPopover.then(function(oPopover) {
                oPopover.openBy(oButton);
            });
        },

        onOpenSettings: function () {
            var oView = this.getView();
            
            // Close the popover first
            if (this.byId("userMenuPopover")) {
                this.byId("userMenuPopover").close();
            }

            if (!this._pSettingsDialog) {
                this._pSettingsDialog = Fragment.load({
                    id: oView.getId(),
                    name: "znxr09.portal.view.SettingsDialog",
                    controller: this
                }).then(function (oDialog) {
                    oView.addDependent(oDialog);
                    return oDialog;
                });
            }
            this._pSettingsDialog.then(function(oDialog) {
                oDialog.open();
                
                // Select default tab
                var oList = this.byId("settingsList");
                if (oList && oList.getItems().length > 0) {
                    var oFirstItem = oList.getItems()[0];
                    oList.setSelectedItem(oFirstItem, true);
                    this._navToSettingsTab(oFirstItem.data("key"));
                }
            }.bind(this));
        },

        onSaveSettings: function () {
            var oLangSelect = this.byId("languageSelect");
            var sTheme = this.getView().getModel("user").getProperty("/theme");
            var url = new URL(window.location.href);
            var bReload = false;

            if (oLangSelect) {
                var sLang = oLangSelect.getSelectedKey();
                if (sLang && url.searchParams.get("sap-language") !== sLang) {
                    url.searchParams.set("sap-language", sLang);
                    bReload = true;
                }
            }

            if (sTheme && url.searchParams.get("sap-theme") !== sTheme) {
                url.searchParams.set("sap-theme", sTheme);
                bReload = true;
            }

            if (bReload) {
                window.location.href = url.href;
            } else {
                this.onCloseSettings();
            }
        },

        onCloseSettings: function () {
            if (this.byId("settingsDialog")) {
                this.byId("settingsDialog").close();
            }
        },

        onSettingsTabSelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var sKey = oItem.data("key");
            this._navToSettingsTab(sKey);
        },

        _navToSettingsTab: function (sKey) {
            var oNavContainer = this.byId("settingsNavContainer");
            if (sKey && this.byId(sKey)) {
                oNavContainer.to(this.byId(sKey));
            } else {
                oNavContainer.to(this.byId("emptyTab"));
            }
        },

        onThemeSelect: function (oEvent) {
            var oItem = oEvent.getParameter("listItem");
            var sTheme = oItem.data("theme");
            
            if (sTheme) {
                // Update theme model
                this.getView().getModel("user").setProperty("/theme", sTheme);
                // Apply theme globally
                sap.ui.getCore().applyTheme(sTheme);
            }
        },

        onLogout: function () {
            window.location.href = "/auth/logout";
        },

        // =============================================
        // NOTIFICATIONS
        // =============================================

        /**
         * Initialize notification system: load initial count + connect WebSocket.
         */
        _initNotifications: function () {
            this._loadNotificationCount();
            this._connectWebSocket();
        },

        /**
         * Load notification count from REST API (used as fallback / initial load).
         */
        _loadNotificationCount: function () {
            var oNotifModel = this.getView().getModel("notification");
            jQuery.ajax({
                url: "/api/notifications/count",
                method: "GET",
                success: function (oData) {
                    oNotifModel.setProperty("/count", oData.count || 0);
                    oNotifModel.setProperty("/unreadCount", String(oData.unreadCount || 0));
                },
                error: function () {
                    oNotifModel.setProperty("/unreadCount", "0");
                }
            });
        },

        /**
         * Load full notification items from REST API.
         */
        _loadNotifications: function () {
            var oNotifModel = this.getView().getModel("notification");
            jQuery.ajax({
                url: "/api/notifications",
                method: "GET",
                success: function (oData) {
                    oNotifModel.setProperty("/items", oData.items || []);
                    oNotifModel.setProperty("/count", oData.count || 0);
                    oNotifModel.setProperty("/unreadCount", String(oData.unreadCount || 0));
                },
                error: function () {
                    oNotifModel.setProperty("/items", []);
                }
            });
        },

        /**
         * Connect Socket.IO for real-time notification updates.
         */
        _connectWebSocket: function () {
            var that = this;
            // Load Socket.IO client dynamically
            var oScript = document.createElement("script");
            oScript.src = "/socket.io/socket.io.js";
            oScript.onload = function () {
                try {
                    var socket = window.io(window.location.origin, {
                        path: "/socket.io",
                        transports: ["websocket", "polling"]
                    });

                    socket.on("connect", function () {
                        console.log("[WS] Connected to notification server");
                    });

                    socket.on("notificationUpdate", function (data) {
                        var oNotifModel = that.getView().getModel("notification");
                        oNotifModel.setProperty("/count", data.count || 0);
                        oNotifModel.setProperty("/unreadCount", String(data.unreadCount || 0));
                    });

                    socket.on("disconnect", function () {
                        console.log("[WS] Disconnected from notification server");
                    });

                    that._socket = socket;
                } catch (e) {
                    console.warn("[WS] Socket.IO connection failed, falling back to polling:", e.message);
                    that._startPollingFallback();
                }
            };
            oScript.onerror = function () {
                console.warn("[WS] Socket.IO client not available, falling back to polling.");
                that._startPollingFallback();
            };
            document.head.appendChild(oScript);
        },

        /**
         * Fallback: poll /api/notifications/count every 60s if WebSocket fails.
         */
        _startPollingFallback: function () {
            var that = this;
            if (this._notifPollingInterval) return;
            this._notifPollingInterval = setInterval(function () {
                that._loadNotificationCount();
            }, 60000);
        },

        /**
         * ShellBar notification bell pressed → open Notification Popover.
         */
        onNotificationsPress: function (oEvent) {
            var oButton = oEvent.getParameter("button") || oEvent.getSource();
            var oView = this.getView();
            var that = this;

            // Load full notification items
            this._loadNotifications();

            if (!this._pNotificationPopover) {
                this._pNotificationPopover = Fragment.load({
                    id: oView.getId(),
                    name: "znxr09.portal.view.NotificationPopover",
                    controller: this
                }).then(function (oPopover) {
                    oView.addDependent(oPopover);
                    return oPopover;
                });
            }
            this._pNotificationPopover.then(function (oPopover) {
                oPopover.openBy(oButton);
            });
        },

        /**
         * Click on a notification item → mark as read + navigate.
         */
        onNotificationItemPress: function (oEvent) {
            var oItem = oEvent.getSource();
            var oCtx = oItem.getBindingContext("notification");
            if (!oCtx) return;

            var oData = oCtx.getObject();
            var sPernr = this.getView().getModel("user").getProperty("/userId");

            // Mark as read
            if (!oData.isRead) {
                jQuery.ajax({
                    url: "/api/notifications/read",
                    method: "POST",
                    contentType: "application/json",
                    data: JSON.stringify({
                        pernr: sPernr,
                        notifType: oData.type,
                        requestId: oData.id
                    }),
                    success: function () {
                        this._loadNotifications();
                    }.bind(this)
                });
            }

            // Navigate to the target app
            if (oData.navigateTo === "timesheet") {
                // Close popover
                if (this.byId("notificationPopover")) {
                    this.byId("notificationPopover").close();
                }
                this.onNavToTimesheet();
            }
        },

        /**
         * Dismiss (close button) on a notification item → mark as read.
         */
        onNotificationDismiss: function (oEvent) {
            var oItem = oEvent.getSource();
            var oCtx = oItem.getBindingContext("notification");
            if (!oCtx) return;

            var oData = oCtx.getObject();
            var sPernr = this.getView().getModel("user").getProperty("/userId");

            jQuery.ajax({
                url: "/api/notifications/read",
                method: "POST",
                contentType: "application/json",
                data: JSON.stringify({
                    pernr: sPernr,
                    notifType: oData.type,
                    requestId: oData.id
                }),
                success: function () {
                    this._loadNotifications();
                }.bind(this)
            });
        },

        /**
         * Mark all notifications as read.
         */
        onMarkAllRead: function () {
            jQuery.ajax({
                url: "/api/notifications/read-all",
                method: "POST",
                contentType: "application/json",
                success: function () {
                    this._loadNotifications();
                }.bind(this)
            });
        }
    });
});
