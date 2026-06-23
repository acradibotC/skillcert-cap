const https = require('https');
https.get('https://s40lp1.ucc.cit.tum.de:443/sap/opu/odata4/sap/zui_nxr_attreq_o4/srvd/sap/zsd_nxr_attreq_post/0001/$metadata', { 
    auth: 'DEV-271:Hanoi@12345', 
    rejectUnauthorized: false 
}, (res) => { 
    let data = ''; 
    res.on('data', chunk => data += chunk); 
    res.on('end', () => require('fs').writeFileSync('srv/external/ZUI_NXR_ATTREQ_O4.edmx', data, 'utf8')); 
});
