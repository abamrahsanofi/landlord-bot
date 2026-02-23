/**
 * test-all-changes.js — Verify all implemented changes
 * 
 * Tests:
 *  1-2.  Auth (signup + login)
 *  3-5.  Notification endpoints (list, unread count, read-all)
 *  6-7.  Push subscription (subscribe + unsubscribe)
 *  8-9.  NestMind endpoints removed (bot + group)
 *  10-11. Core endpoints (profile, agent tools)
 *  12.   Service Worker served
 *  13-19. Dashboard HTML checks (NestMind removal, new features)
 *  20.   Auth protection
 */

const http = require('http');
const BASE = process.argv[2] || 'http://localhost:3000';
const { hostname, port } = new URL(BASE);

function req(method, path, data, token) {
    return new Promise((resolve, reject) => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const body = data ? JSON.stringify(data) : null;
        if (body) headers['Content-Length'] = Buffer.byteLength(body);
        const r = http.request({ hostname, port: parseInt(port) || 3000, path, method, headers }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
                catch { resolve({ status: res.statusCode, data: d }); }
            });
        });
        r.on('error', reject);
        if (body) r.write(body);
        r.end();
    });
}

let passCount = 0, failCount = 0;
function check(ok, label, detail) {
    if (ok) {
        passCount++;
        console.log(`  PASS: ${label}${detail ? ' (' + detail + ')' : ''}`);
    } else {
        failCount++;
        console.log(`  FAIL: ${label}${detail ? ' (' + detail + ')' : ''}`);
    }
}

(async () => {
    console.log('\n=== Testing All Changes ===\n');

    const rand = Math.random().toString(36).slice(2, 8);

    // 1. Signup
    const signup = await req('POST', '/auth/signup', { email: `test_${rand}@test.com`, password: 'TestPass123!', name: 'Test ' + rand });
    check(signup.status === 200, 'Signup', signup.status);
    const token = signup.data.token;
    if (!token) { console.log('FATAL: No token received, aborting.'); process.exit(1); }

    // 2. Login
    const login = await req('POST', '/auth/login', { email: `test_${rand}@test.com`, password: 'TestPass123!' });
    check(login.status === 200, 'Login', login.status);

    console.log('\n--- Notification Endpoints ---');

    // 3. GET notifications
    const notifs = await req('GET', '/admin/notifications', null, token);
    check(notifs.status === 200 && Array.isArray(notifs.data.notifications), 'GET /admin/notifications', `status=${notifs.status} count=${notifs.data.notifications?.length}`);

    // 4. GET unread count
    const unread = await req('GET', '/admin/notifications/unread-count', null, token);
    check(unread.status === 200 && typeof unread.data.count === 'number', 'GET /admin/notifications/unread-count', `status=${unread.status} count=${unread.data.count}`);

    // 5. POST read-all
    const readAll = await req('POST', '/admin/notifications/read-all', {}, token);
    check(readAll.status === 200 && readAll.data.ok, 'POST /admin/notifications/read-all', `status=${readAll.status}`);

    console.log('\n--- Push Subscription ---');

    // 6. POST push subscribe
    const pushSub = await req('POST', '/admin/push/subscribe', { endpoint: 'https://test.example.com/push', keys: { p256dh: 'testkey', auth: 'testauthkey' } }, token);
    check(pushSub.status === 200 && pushSub.data.ok, 'POST /admin/push/subscribe', `status=${pushSub.status}`);

    // 7. DELETE push unsubscribe
    const pushUnsub = await req('DELETE', '/admin/push/unsubscribe', { endpoint: 'https://test.example.com/push' }, token);
    check(pushUnsub.status === 200 && pushUnsub.data.ok, 'DELETE /admin/push/unsubscribe', `status=${pushUnsub.status}`);

    console.log('\n--- NestMind Removal ---');

    // 8. Bot instance endpoint removed
    const botStatus = await req('GET', '/admin/whatsapp/bot-instance/status', null, token);
    check(botStatus.status === 404, 'Bot endpoint removed (404)', `status=${botStatus.status}`);

    // 9. NestMind group endpoint removed
    const grpStatus = await req('GET', '/admin/whatsapp/nestmind-group/status', null, token);
    check(grpStatus.status === 404, 'Group endpoint removed (404)', `status=${grpStatus.status}`);

    console.log('\n--- Core Endpoints ---');

    // 10. Profile
    const profile = await req('GET', '/admin/profile', null, token);
    check(profile.status === 200 && profile.data.name, 'GET /admin/profile', `status=${profile.status} name=${profile.data.name}`);

    // 11. Agent tools
    const tools = await req('GET', '/admin/agent/tools', null, token);
    check(tools.status === 200 && tools.data.tools?.length > 0, 'GET /admin/agent/tools', `status=${tools.status} tools=${tools.data.tools?.length}`);

    // 12. Service Worker
    const sw = await req('GET', '/sw.js');
    check(sw.status === 200, 'GET /sw.js (Service Worker)', `status=${sw.status}`);

    console.log('\n--- Dashboard HTML Checks ---');

    // Fetch dashboard
    const dash = await req('GET', '/dashboard.html');
    const html = typeof dash.data === 'string' ? dash.data : JSON.stringify(dash.data);

    // 13. No NestMind Bot panel
    check(!html.includes('id="waNestMindBot"'), 'No NestMind Bot panel in HTML');

    // 14. AI Chat panel still exists
    check(html.includes('waNestMindChat'), 'AI Chat panel present');

    // 15. Notification bell
    check(html.includes('notification-bell'), 'Notification bell icon present');

    // 16. WebSocket init code
    check(html.includes('connectWebSocket'), 'WebSocket initialization code present');

    // 17. Service Worker registration
    check(html.includes('serviceWorker'), 'Service Worker registration code present');

    // 18. No checkNestMindBotStatus function
    check(!html.includes('checkNestMindBotStatus'), 'checkNestMindBotStatus function removed');

    // 19. No connectNestMindBot function
    check(!html.includes('connectNestMindBot'), 'connectNestMindBot function removed');

    console.log('\n--- Auth Protection ---');

    // 20. Notifications without auth returns 401
    const noAuth = await req('GET', '/admin/notifications');
    check(noAuth.status === 401, 'Notifications requires auth (401)', `status=${noAuth.status}`);

    console.log(`\n=== Results: ${passCount} passed, ${failCount} failed out of ${passCount + failCount} tests ===\n`);
    process.exit(failCount > 0 ? 1 : 0);
})().catch(e => {
    console.error('Test suite error:', e.message);
    process.exit(1);
});
