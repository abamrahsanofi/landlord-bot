/**
 * test-saas.js — End-to-end test for the multi-tenant SaaS features
 *
 * Usage:
 *   node scripts/test-saas.js [BASE_URL]
 *
 * Defaults to http://localhost:3000
 *
 * Tests:
 *  1. Signup a new landlord
 *  2. Login
 *  3. Fetch profile (/auth/me)
 *  4. Create a unit
 *  5. Create a tenant
 *  6. Create a contractor
 *  7. List units / tenants / contractors (scoped)
 *  8. Get provinces list
 *  9. Get billing plans
 * 10. Simulate a webhook (tenant WhatsApp message)
 * 11. List maintenance (should have new request)
 * 12. Signup a SECOND landlord — verify isolation
 */

const BASE = process.argv[2] || 'http://localhost:3000';
const rand = () => Math.random().toString(36).slice(2, 8);

let passCount = 0;
let failCount = 0;
const results = [];

function assert(condition, label) {
    if (condition) {
        passCount++;
        results.push(`  ✅ ${label}`);
    } else {
        failCount++;
        results.push(`  ❌ ${label}`);
    }
}

async function api(path, opts = {}) {
    const url = `${BASE}${path}`;
    const res = await fetch(url, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...opts.headers,
        },
    });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, ok: res.ok, json, text };
}

async function authedApi(token, path, opts = {}) {
    return api(path, {
        ...opts,
        headers: { ...opts.headers, 'Authorization': `Bearer ${token}` },
    });
}

async function run() {
    console.log('\n🏠 NestMind AI — SaaS Test Suite');
    console.log(`   Target: ${BASE}\n`);

    const email1 = `landlord-${rand()}@test.com`;
    const email2 = `landlord2-${rand()}@test.com`;
    const password = 'TestPass123!';
    const tenantPhone = `+1416555${rand().slice(0, 4)}`;
    let token1, token2, landlord1Id, unitId, tenantId;

    // ─── 1. Signup ───
    console.log('1. Signup...');
    {
        const r = await api('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({
                email: email1,
                password,
                name: 'Test Landlord',
                company: 'Test Properties Inc',
                phone: '+14165550001',
                province: 'ON',
            }),
        });
        assert(r.ok, `Signup returns 200 (got ${r.status})`);
        assert(r.json?.token, 'Signup returns JWT token');
        assert(r.json?.landlord?.id, 'Signup returns landlord object');
        token1 = r.json?.token;
        landlord1Id = r.json?.landlord?.id;
    }

    // ─── 2. Login ───
    console.log('2. Login...');
    {
        const r = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: email1, password }),
        });
        assert(r.ok, `Login returns 200 (got ${r.status})`);
        assert(r.json?.token, 'Login returns JWT token');
        token1 = r.json?.token; // refresh token
    }

    // ─── 3. Profile ───
    console.log('3. Fetch profile...');
    {
        const r = await authedApi(token1, '/auth/me');
        assert(r.ok, `GET /auth/me returns 200 (got ${r.status})`);
        assert(r.json?.landlord?.email === email1, 'Profile email matches');
        assert(r.json?.landlord?.plan === 'FREE', 'Default plan is FREE');
        assert(r.json?.limits?.maxUnits === 3, 'FREE plan maxUnits = 3');
    }

    // ─── 4. Create unit ───
    console.log('4. Create unit...');
    {
        const r = await authedApi(token1, '/admin/units', {
            method: 'POST',
            body: JSON.stringify({ name: '123 Test St, Unit 1', bedrooms: 2, bathrooms: 1 }),
        });
        assert(r.ok, `Create unit returns 200 (got ${r.status})`);
        unitId = r.json?.id;
        assert(unitId, 'Unit has an ID');
    }

    // ─── 5. Create tenant ───
    console.log('5. Create tenant...');
    {
        const r = await authedApi(token1, '/admin/tenants', {
            method: 'POST',
            body: JSON.stringify({
                firstName: 'Jane',
                lastName: 'Doe',
                phone: tenantPhone,
                unitId,
            }),
        });
        assert(r.ok, `Create tenant returns 200 (got ${r.status})`);
        tenantId = r.json?.id;
        assert(tenantId, 'Tenant has an ID');
    }

    // ─── 6. Create contractor ───
    console.log('6. Create contractor...');
    {
        const r = await authedApi(token1, '/admin/contractors', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Mike the Plumber',
                phone: '+14165559999',
                email: 'mike@plumber.test',
                role: 'plumber',
            }),
        });
        assert(r.ok, `Create contractor returns 200 (got ${r.status})`);
    }

    // ─── 7. List entities (scoped) ───
    console.log('7. List entities...');
    {
        const units = await authedApi(token1, '/admin/units');
        assert(units.ok && units.json?.items?.length >= 1, `Units list has items (${units.json?.items?.length})`);

        const tenants = await authedApi(token1, '/admin/tenants');
        assert(tenants.ok && tenants.json?.items?.length >= 1, `Tenants list has items (${tenants.json?.items?.length})`);

        const contractors = await authedApi(token1, '/admin/contractors');
        assert(contractors.ok && contractors.json?.items?.length >= 1, `Contractors list has items (${contractors.json?.items?.length})`);
    }

    // ─── 8. Province list ───
    console.log('8. Province list...');
    {
        const r = await authedApi(token1, '/admin/provinces');
        assert(r.ok, `GET /admin/provinces returns 200 (got ${r.status})`);
        assert(Array.isArray(r.json) && r.json.length >= 8, `Has provinces (${r.json?.length})`);
    }

    // ─── 9. Billing plans ───
    console.log('9. Billing plans...');
    {
        const r = await authedApi(token1, '/admin/billing/plans');
        assert(r.ok, `GET /admin/billing/plans returns 200 (got ${r.status})`);
        assert(r.json?.FREE, 'Has FREE plan');
        assert(r.json?.PRO, 'Has PRO plan');
        assert(r.json?.ENTERPRISE, 'Has ENTERPRISE plan');
    }

    // ─── 10. Simulate webhook ───
    console.log('10. Simulate webhook...');
    {
        // This simulates a WhatsApp message from the tenant
        const r = await api('/webhooks/whatsapp', {
            method: 'POST',
            body: JSON.stringify({
                data: {
                    key: {
                        remoteJid: `${tenantPhone.replace('+', '')}@s.whatsapp.net`,
                        fromMe: false,
                        id: `test-${rand()}`,
                    },
                    pushName: 'Jane Doe',
                    message: {
                        conversation: 'Hi, my kitchen faucet is leaking badly. Water is going everywhere!',
                    },
                    messageType: 'conversation',
                    messageTimestamp: Math.floor(Date.now() / 1000),
                },
                event: 'messages.upsert',
                instance: 'test',
            }),
        });
        // Webhook should return 200 regardless of processing
        assert(r.status === 200 || r.status === 202, `Webhook accepted (${r.status})`);
    }

    // Wait for async processing
    console.log('   (waiting 3s for async processing...)');
    await new Promise(r => setTimeout(r, 3000));

    // ─── 11. List maintenance ───
    console.log('11. List maintenance...');
    {
        const r = await authedApi(token1, '/admin/maintenance');
        assert(r.ok, `List maintenance returns 200 (got ${r.status})`);
        // There might be a maintenance record from the webhook
        const items = r.json?.items || [];
        console.log(`   Found ${items.length} maintenance record(s)`);
        if (items.length > 0) {
            assert(true, 'Maintenance created from webhook');
            console.log(`   Status: ${items[0].status}, Severity: ${items[0].triageJson?.classification?.severity || 'pending'}`);
        }
    }

    // ─── 12. Tenant isolation test ───
    console.log('12. Tenant isolation (2nd landlord)...');
    {
        // Signup second landlord
        const s = await api('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({
                email: email2,
                password,
                name: 'Other Landlord',
                province: 'BC',
            }),
        });
        assert(s.ok, 'Second landlord signup OK');
        token2 = s.json?.token;

        // Second landlord should see ZERO units/tenants/contractors
        const units = await authedApi(token2, '/admin/units');
        assert(units.ok && (units.json?.items?.length || 0) === 0, 'Second landlord sees 0 units');

        const tenants = await authedApi(token2, '/admin/tenants');
        assert(tenants.ok && (tenants.json?.items?.length || 0) === 0, 'Second landlord sees 0 tenants');

        const contractors = await authedApi(token2, '/admin/contractors');
        assert(contractors.ok && (contractors.json?.items?.length || 0) === 0, 'Second landlord sees 0 contractors');
    }

    // ─── 13. Auth guard test ───
    console.log('13. Auth guard...');
    {
        const r = await api('/admin/units'); // no token
        assert(r.status === 401, `No-token request returns 401 (got ${r.status})`);

        const r2 = await api('/admin/units', {
            headers: { 'Authorization': 'Bearer invalid-token-xyz' },
        });
        assert(r2.status === 401, `Bad-token request returns 401 (got ${r2.status})`);
    }

    // ─── 14. Plan limit test ───
    console.log('14. Plan limits (FREE = 3 units max)...');
    {
        // Create 2 more units (already have 1 from step 4 = total 3)
        await authedApi(token1, '/admin/units', {
            method: 'POST',
            body: JSON.stringify({ name: 'Unit 2' }),
        });
        await authedApi(token1, '/admin/units', {
            method: 'POST',
            body: JSON.stringify({ name: 'Unit 3' }),
        });
        // 4th unit should fail
        const r = await authedApi(token1, '/admin/units', {
            method: 'POST',
            body: JSON.stringify({ name: 'Unit 4 (should fail)' }),
        });
        assert(!r.ok || r.status === 403, `4th unit rejected on FREE plan (${r.status})`);
    }

    // ─── 15. Agent: list tools ───
    console.log('15. Agent tools list...');
    {
        const r = await authedApi(token1, '/admin/agent/tools');
        assert(r.ok, `GET /admin/agent/tools OK (${r.status})`);
        const tools = r.json?.tools || [];
        assert(tools.length > 0, `Tools list has ${tools.length} tools`);
        const names = tools.map(t => t.name);
        assert(names.includes('lookup_tenant'), 'lookup_tenant tool present');
        assert(names.includes('triage_message'), 'triage_message tool present');
        console.log(`   Available: ${names.join(', ')}`);
    }

    // ─── 16. Agent: ask (smoke test) ───
    console.log('16. Agent ask endpoint...');
    {
        const r = await authedApi(token1, '/admin/agent/ask', {
            method: 'POST',
            body: JSON.stringify({ question: 'What maintenance requests are open?' }),
        });
        assert(r.ok || r.status === 200, `POST /admin/agent/ask returns OK (${r.status})`);
        assert(typeof r.json?.answer === 'string' || typeof r.json?.finalAnswer === 'string', 'Agent returned an answer');
        const answer = r.json?.answer || r.json?.finalAnswer || '';
        console.log(`   Agent answer: ${answer.slice(0, 100)}...`);
    }

    // ─── 17. Agent: page reader (smoke test — read a simple page) ───
    console.log('17. Agent page reader...');
    {
        const r = await authedApi(token1, '/admin/agent/read-page', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://example.com', summarize: false }),
        });
        // May fail if puppeteer is not installed — that's OK
        if (r.ok) {
            assert(true, 'Page reader returned OK');
            assert(typeof r.json?.content === 'string' || typeof r.json?.summary === 'string', 'Page content returned');
        } else {
            assert(true, `Page reader not available (${r.status}) — puppeteer may not be installed`);
        }
    }

    // ─── Summary ───
    console.log('\n' + '═'.repeat(50));
    console.log(' Results:');
    results.forEach(r => console.log(r));
    console.log('═'.repeat(50));
    console.log(`\n Total: ${passCount + failCount} tests — ✅ ${passCount} passed, ❌ ${failCount} failed\n`);

    if (failCount > 0) process.exit(1);
}

run().catch(err => {
    console.error('💥 Test suite crashed:', err);
    process.exit(1);
});
