sap.ui.define([
    "sap/fe/test/JourneyRunner",
	"znxr09/znxr09f300/test/integration/pages/UserProfileMain"
], function (JourneyRunner, UserProfileMain) {
    'use strict';

    var runner = new JourneyRunner({
        launchUrl: sap.ui.require.toUrl('znxr09/znxr09f300') + '/test/flp.html#app-preview',
        pages: {
			onTheUserProfileMain: UserProfileMain
        },
        async: true
    });

    return runner;
});

