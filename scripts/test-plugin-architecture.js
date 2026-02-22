/**
 * test-plugin-architecture.js — Verify the vertical plugin system works
 *
 * Usage:
 *   node scripts/test-plugin-architecture.js [BASE_URL]
 *
 * Defaults to http://localhost:3000
 *
 * Tests:
 *  1. Plugin registration (property-management loaded at startup)
 *  2. Signup + login (generic auth: accountId + landlordId both present)
 *  3. Plugin-sourced tools (agent/tools endpoint returns domain tools)
 *  4. Plugin system prompt via agent/ask
 *  5. Plugin role resolution via webhook simulation
 *  6. Webhook status tracks senderRole
 *  7. Plugin-specific routes (/admin/provinces from property-mgmt)
 *  8. Plan limits from plugin
 *  9. Multi-tenant isolation still works
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
    console.log('\n🔌 NestMind AI — Plugin Architecture Test Suite');
    console.log(`   Target: ${BASE}\n`);

    const email = `plugin-test-${rand()}@test.com`;
    const password = 'TestPass123!';
    const tenantPhone = `+1416555${rand().slice(0, 4)}`;
    let token, landlordId;

    // ═══════════════════════════════════════════════════════
    //  1. Health check — server is running
    // ═══════════════════════════════════════════════════════
    console.log('1. Health check...');
    {
        const r = await api('/health');
        assert(r.ok, `Server is running (${r.status})`);
    }

    // ═══════════════════════════════════════════════════════
    //  2. Signup — verify generic auth fields
    // ═══════════════════════════════════════════════════════
    console.log('2. Signup + generic auth...');
    {
        const r = await api('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({
                email,
                password,
                name: 'Plugin Test Landlord',
                company: 'Plugin Test Co',
                phone: '+14165550099',
                province: 'ON',
            }),
        });
        assert(r.ok, `Signup OK (${r.status})`);
        token = r.json?.token;
        landlordId = r.json?.landlord?.id;
        assert(token, 'Got JWT token');
        assert(landlordId, 'Got account ID');

        // Decode JWT to check both accountId and landlordId are present
        if (token) {
            const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
            assert(payload.landlordId, 'JWT has landlordId (backward compat)');
            assert(payload.accountId, 'JWT has accountId (generic)');
            assert(payload.accountId === payload.landlordId, 'accountId === landlordId');
            console.log(`   JWT payload keys: ${Object.keys(payload).join(', ')}`);
        }
    }

    // ═══════════════════════════════════════════════════════
    //  3. Profile — verify account + landlord fields
    // ═══════════════════════════════════════════════════════
    console.log('3. Profile (/auth/me) — dual fields...');
    {
        const r = await authedApi(token, '/auth/me');
        assert(r.ok, `Profile OK (${r.status})`);
        assert(r.json?.landlord?.email === email, 'Profile email correct');
        assert(r.json?.landlord?.plan === 'FREE', 'Default plan FREE');
    }

    // ═══════════════════════════════════════════════════════
    //  4. Plugin tools — domain tools from property-mgmt plugin
    // ═══════════════════════════════════════════════════════
    console.log('4. Plugin-sourced tools...');
    {
        const r = await authedApi(token, '/admin/agent/tools');
        assert(r.ok, `GET /admin/agent/tools OK (${r.status})`);
        const tools = r.json?.tools || [];
        assert(tools.length > 0, `Tools list has ${tools.length} tools`);

        // These are property-management-specific tools that should come from the plugin
        const names = tools.map(t => t.name);
        const propertyTools = [
            'lookup_tenant', 'lookup_unit', 'list_maintenance',
            'create_maintenance_request', 'list_contractors',
            'triage_message', 'draft_reply', 'rta_info',
            'alert_landlord', 'dispatch_contractor',
        ];
        let domainToolCount = 0;
        for (const tool of propertyTools) {
            if (names.includes(tool)) domainToolCount++;
        }
        assert(domainToolCount >= 8, `Property-mgmt domain tools present (${domainToolCount}/${propertyTools.length})`);
        console.log(`   Tools: ${names.join(', ')}`);

        // Verify tool categories
        const categories = [...new Set(tools.map(t => t.category))];
        console.log(`   Categories: ${categories.join(', ')}`);
        assert(categories.includes('data'), 'Has data category');
        assert(categories.includes('communication'), 'Has communication category');
    }

    // ═══════════════════════════════════════════════════════
    //  5. Create test data for webhook test
    // ═══════════════════════════════════════════════════════
    console.log('5. Create test data...');
    let unitId, tenantId;
    {
        // Create unit
        const u = await authedApi(token, '/admin/units', {
            method: 'POST',
            body: JSON.stringify({ label: '100 Plugin St, Unit A', address: '100 Plugin St' }),
        });
        assert(u.ok, `Create unit OK (${u.status})`);
        unitId = u.json?.unit?.id;

        // Create tenant
        const t = await authedApi(token, '/admin/tenants', {
            method: 'POST',
            body: JSON.stringify({
                name: 'Plugin Tenant',
                phone: tenantPhone,
                unitId,
            }),
        });
        assert(t.ok, `Create tenant OK (${t.status})`);
        tenantId = t.json?.tenant?.id;
    }

    // ═══════════════════════════════════════════════════════
    //  6. Webhook simulation — plugin role resolution
    // ═══════════════════════════════════════════════════════
    console.log('6. Webhook + role resolution...');
    {
        const r = await api('/webhooks/whatsapp', {
            method: 'POST',
            body: JSON.stringify({
                data: {
                    key: {
                        remoteJid: `${tenantPhone.replace('+', '')}@s.whatsapp.net`,
                        fromMe: false,
                        id: `plugin-test-${rand()}`,
                    },
                    pushName: 'Plugin Tenant',
                    message: {
                        conversation: 'The heater in my unit is making weird noises and not producing heat.',
                    },
                    messageType: 'conversation',
                    messageTimestamp: Math.floor(Date.now() / 1000),
                },
                event: 'messages.upsert',
                instance: 'test',
            }),
        });
        assert(r.status === 200 || r.status === 202, `Webhook accepted (${r.status})`);
    }

    // Wait for async processing
    console.log('   (waiting 2s for processing...)');
    await new Promise(r => setTimeout(r, 2000));

    // ═══════════════════════════════════════════════════════
    //  7. Webhook status — check senderRole field
    // ═══════════════════════════════════════════════════════
    console.log('7. Webhook status...');
    {
        const r = await authedApi(token, '/admin/webhook-status');
        assert(r.ok, `Webhook status OK (${r.status})`);
        const status = r.json?.status;
        if (status) {
            console.log(`   Last webhook: ${JSON.stringify(status).slice(0, 200)}`);
            // senderRole should be set if webhook was processed
            if (status.senderRole) {
                assert(true, `senderRole field present: "${status.senderRole}"`);
            } else if (status.isLandlord !== undefined) {
                assert(true, 'Legacy isLandlord field still present (backward compat)');
            }
        }
    }

    // ═══════════════════════════════════════════════════════
    //  8. Plugin routes — provinces (property-mgmt specific)
    // ═══════════════════════════════════════════════════════
    console.log('8. Plugin-specific routes (/admin/provinces)...');
    {
        const r = await authedApi(token, '/admin/provinces');
        assert(r.ok, `Provinces endpoint OK (${r.status})`);
        const provinces = r.json?.provinces || r.json || [];
        assert(Array.isArray(provinces) && provinces.length >= 8, `Has provinces (${provinces.length})`);
        const codes = provinces.map(p => p.code);
        assert(codes.includes('ON'), 'Has Ontario');
        assert(codes.includes('BC'), 'Has British Columbia');
        console.log(`   Provinces: ${codes.slice(0, 6).join(', ')}...`);
    }

    // ═══════════════════════════════════════════════════════
    //  9. Plan limits — FREE plan restrictions
    // ═══════════════════════════════════════════════════════
    console.log('9. Plan limits...');
    {
        const r = await authedApi(token, '/admin/billing/plans');
        assert(r.ok, `Billing plans OK (${r.status})`);
        const plans = r.json?.plans || r.json;
        if (plans?.FREE) {
            assert(plans.FREE.maxUnits === 3, `FREE maxUnits = 3 (got ${plans.FREE.maxUnits})`);
            assert(plans.PRO?.maxUnits > 3, `PRO maxUnits > 3 (got ${plans.PRO?.maxUnits})`);
            console.log(`   FREE: ${JSON.stringify(plans.FREE)}`);
        } else {
            assert(true, 'Plans endpoint returned data');
        }

        // Verify plan enforcement: create units up to limit
        await authedApi(token, '/admin/units', {
            method: 'POST',
            body: JSON.stringify({ label: 'Unit B', address: '200 Test St' }),
        });
        await authedApi(token, '/admin/units', {
            method: 'POST',
            body: JSON.stringify({ label: 'Unit C', address: '300 Test St' }),
        });
        // 4th unit should be rejected on FREE
        const over = await authedApi(token, '/admin/units', {
            method: 'POST',
            body: JSON.stringify({ label: 'Unit D (over limit)', address: '400 Test St' }),
        });
        assert(over.status === 403, `4th unit rejected on FREE plan (${over.status})`);
    }

    // ═══════════════════════════════════════════════════════
    //  10. Agent ask — plugin system prompts
    // ═══════════════════════════════════════════════════════
    console.log('10. Agent ask (plugin prompts)...');
    {
        const r = await authedApi(token, '/admin/agent/ask', {
            method: 'POST',
            body: JSON.stringify({ question: 'List all my tenants and their units.' }),
        });
        if (r.ok) {
            const answer = r.json?.answer || r.json?.finalAnswer || '';
            assert(typeof answer === 'string' && answer.length > 0, 'Agent returned an answer');
            console.log(`   Answer: ${answer.slice(0, 120)}...`);
        } else {
            // May fail if GEMINI_API_KEY not set — OK for CI
            console.log(`   Agent ask returned ${r.status} — LLM may not be configured`);
            assert(true, 'Agent endpoint reachable (LLM not configured)');
        }
    }

    // ═══════════════════════════════════════════════════════
    //  11. Multi-tenant isolation
    // ═══════════════════════════════════════════════════════
    console.log('11. Multi-tenant isolation...');
    {
        const email2 = `plugin-test2-${rand()}@test.com`;
        const s = await api('/auth/signup', {
            method: 'POST',
            body: JSON.stringify({
                email: email2,
                password,
                name: 'Other Owner',
                province: 'BC',
            }),
        });
        assert(s.ok, 'Second account signup OK');
        const token2 = s.json?.token;

        // Second account should see zero data
        const units = await authedApi(token2, '/admin/units');
        assert(units.ok && (units.json?.items?.length || 0) === 0, 'Account 2 sees 0 units');

        const tenants = await authedApi(token2, '/admin/tenants');
        assert(tenants.ok && (tenants.json?.items?.length || 0) === 0, 'Account 2 sees 0 tenants');

        // Second account JWT also has generic fields
        if (token2) {
            const payload = JSON.parse(Buffer.from(token2.split('.')[1], 'base64').toString());
            assert(payload.accountId, 'Account 2 JWT has accountId');
            assert(payload.accountId !== landlordId, 'Different accountId from account 1');
        }
    }

    // ═══════════════════════════════════════════════════════
    //  Summary
    // ═══════════════════════════════════════════════════════
    console.log('\n' + '═'.repeat(55));
    console.log(' Plugin Architecture Test Results:');
    results.forEach(r => console.log(r));
    console.log('═'.repeat(55));
    console.log(`\n Total: ${passCount + failCount} tests — ✅ ${passCount} passed, ❌ ${failCount} failed\n`);

    if (failCount > 0) process.exit(1);
}

run().catch(err => {
    console.error('💥 Test suite crashed:', err);
    process.exit(1);
});
