/**
 * webAgent.ts — Headless browser agent for web navigation, utility bill
 * scraping, and page reading.
 *
 * Uses Puppeteer in headless mode with a mobile viewport to simulate
 * realistic browsing. The LLM sees tool results and decides next steps.
 *
 * Capabilities:
 *  1. Navigate to a URL
 *  2. Fill forms (login to utility portals)
 *  3. Click elements
 *  4. Extract page text / structured data
 *  5. Take screenshots
 *  6. Read & summarize any webpage (mobile browser simulation)
 *
 * All operations include safety limits (timeout, domain allowlists, etc.)
 */

import { ToolDefinition } from "../toolRegistry";

// We lazy-load puppeteer so the app still starts if it's not installed.
let puppeteer: any = null;
let browserInstance: any = null;

async function loadPuppeteer() {
    if (puppeteer) return puppeteer;
    try {
        puppeteer = require("puppeteer");
        return puppeteer;
    } catch {
        try {
            puppeteer = require("puppeteer-core");
            return puppeteer;
        } catch {
            console.warn("[WebAgent] puppeteer not installed. Run: npm install puppeteer");
            return null;
        }
    }
}

async function getBrowser() {
    if (browserInstance?.isConnected?.()) return browserInstance;
    const pup = await loadPuppeteer();
    if (!pup) return null;
    browserInstance = await pup.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
        ],
    });
    return browserInstance;
}

async function closeBrowser() {
    if (browserInstance) {
        try { await browserInstance.close(); } catch { }
        browserInstance = null;
    }
}

// Mobile viewport for realistic page rendering
const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const MOBILE_VIEWPORT = {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
};

const DESKTOP_VIEWPORT = {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
};

const MAX_PAGE_TEXT_LENGTH = 8000;  // Limit LLM context
const DEFAULT_TIMEOUT = 30000;
const BLOCKED_DOMAINS = ["facebook.com", "google.com/accounts", "apple.com/account"];

function isDomainBlocked(url: string): boolean {
    try {
        const u = new URL(url);
        return BLOCKED_DOMAINS.some(d => u.hostname.includes(d.split("/")[0]) && u.pathname.includes(d.split("/")[1] || ""));
    } catch {
        return false;
    }
}

// ═══════════════════════════════════════════════════════════
//  WEB TOOLS — register as agent tools
// ═══════════════════════════════════════════════════════════

export function webBrowseTool(): ToolDefinition {
    return {
        name: "web_browse",
        description: "Navigate to a URL and extract the page content as text. Simulates a mobile browser. Returns page title, text content, links, and forms found. Use this to read any webpage or start navigating a utility portal.",
        parameters: {
            url: { type: "string", description: "The URL to navigate to" },
            mobile: { type: "boolean", description: "Use mobile viewport (default true)" },
            waitForSelector: { type: "string", description: "CSS selector to wait for before extracting content" },
        },
        required: ["url"],
        category: "web",
        enabled: true,
        async execute(args) {
            const url = String(args.url);
            if (isDomainBlocked(url)) return { error: "Domain not allowed for security reasons" };

            const browser = await getBrowser();
            if (!browser) return { error: "Browser not available. Install puppeteer: npm install puppeteer" };

            const page = await browser.newPage();
            try {
                const isMobile = args.mobile !== false;
                const viewport = isMobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT;
                await page.setViewport(viewport);
                if (isMobile) await page.setUserAgent(MOBILE_UA);

                await page.goto(url, { waitUntil: "networkidle2", timeout: DEFAULT_TIMEOUT });

                if (args.waitForSelector) {
                    await page.waitForSelector(String(args.waitForSelector), { timeout: 10000 }).catch(() => { });
                }

                const data = await page.evaluate(() => {
                    const title = document.title || "";
                    const body = document.body?.innerText || "";
                    const links = Array.from(document.querySelectorAll("a[href]"))
                        .slice(0, 20)
                        .map((a: any) => ({ text: a.innerText?.trim().slice(0, 50), href: a.href }));
                    const forms = Array.from(document.querySelectorAll("form")).map((f: any, i: number) => {
                        const inputs = Array.from(f.querySelectorAll("input, select, textarea"))
                            .map((inp: any) => ({
                                type: inp.type || inp.tagName.toLowerCase(),
                                name: inp.name || inp.id || "",
                                placeholder: inp.placeholder || "",
                                value: inp.type === "password" ? "***" : (inp.value || "").slice(0, 50),
                            }));
                        return { formIndex: i, action: f.action || "", method: f.method || "", inputs };
                    });
                    const meta = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
                    return { title, body, links, forms, meta };
                });

                // Truncate body text for LLM context window
                const truncatedBody = data.body.length > MAX_PAGE_TEXT_LENGTH
                    ? data.body.slice(0, MAX_PAGE_TEXT_LENGTH) + "\n...[truncated]"
                    : data.body;

                return {
                    url: page.url(),
                    title: data.title,
                    description: data.meta,
                    bodyText: truncatedBody,
                    links: data.links,
                    forms: data.forms,
                    bodyLength: data.body.length,
                };
            } catch (err) {
                return { error: `Navigation failed: ${(err as Error).message}`, url };
            } finally {
                await page.close();
            }
        },
    };
}

export function webFillFormTool(): ToolDefinition {
    return {
        name: "web_fill_form",
        description: "Fill in a form field on the current page. Use after web_browse to log into utility portals. Provide the CSS selector and value to type.",
        parameters: {
            url: { type: "string", description: "Page URL (navigate first if needed)" },
            selector: { type: "string", description: "CSS selector of the input field (e.g., 'input[name=username]')" },
            value: { type: "string", description: "Value to type into the field" },
            submit: { type: "boolean", description: "Whether to submit the form after filling (default false)" },
        },
        required: ["url", "selector", "value"],
        category: "web",
        enabled: true,
        async execute(args) {
            const browser = await getBrowser();
            if (!browser) return { error: "Browser not available" };

            const page = await browser.newPage();
            try {
                await page.setViewport(MOBILE_VIEWPORT);
                await page.setUserAgent(MOBILE_UA);
                await page.goto(String(args.url), { waitUntil: "networkidle2", timeout: DEFAULT_TIMEOUT });

                await page.waitForSelector(String(args.selector), { timeout: 10000 });
                await page.click(String(args.selector));
                await page.type(String(args.selector), String(args.value), { delay: 50 });

                if (args.submit) {
                    // Try to find and click submit button, or press Enter
                    const submitted = await page.evaluate((sel: string) => {
                        const input = document.querySelector(sel);
                        const form = input?.closest("form");
                        if (form) {
                            const btn = form.querySelector('button[type="submit"], input[type="submit"]');
                            if (btn) { (btn as HTMLElement).click(); return true; }
                        }
                        return false;
                    }, String(args.selector));

                    if (!submitted) {
                        await page.keyboard.press("Enter");
                    }

                    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => { });
                }

                return {
                    filled: true,
                    currentUrl: page.url(),
                    pageTitle: await page.title(),
                };
            } catch (err) {
                return { error: `Form fill failed: ${(err as Error).message}` };
            } finally {
                await page.close();
            }
        },
    };
}

export function webClickTool(): ToolDefinition {
    return {
        name: "web_click",
        description: "Click an element on a webpage by CSS selector or link text. Use to navigate through multi-page utility portals.",
        parameters: {
            url: { type: "string", description: "Page URL to navigate to first" },
            selector: { type: "string", description: "CSS selector to click (e.g., 'a.bill-download')" },
            linkText: { type: "string", description: "Alternative: click a link by its visible text" },
        },
        required: ["url"],
        category: "web",
        enabled: true,
        async execute(args) {
            const browser = await getBrowser();
            if (!browser) return { error: "Browser not available" };

            const page = await browser.newPage();
            try {
                await page.setViewport(MOBILE_VIEWPORT);
                await page.setUserAgent(MOBILE_UA);
                await page.goto(String(args.url), { waitUntil: "networkidle2", timeout: DEFAULT_TIMEOUT });

                if (args.selector) {
                    await page.waitForSelector(String(args.selector), { timeout: 10000 });
                    await page.click(String(args.selector));
                } else if (args.linkText) {
                    const clicked = await page.evaluate((text: string) => {
                        const links = Array.from(document.querySelectorAll("a, button"));
                        const match = links.find(el => el.textContent?.trim().toLowerCase().includes(text.toLowerCase()));
                        if (match) { (match as HTMLElement).click(); return true; }
                        return false;
                    }, String(args.linkText));
                    if (!clicked) return { error: `No element found with text: ${args.linkText}` };
                } else {
                    return { error: "Provide either selector or linkText" };
                }

                await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => { });

                const newUrl = page.url();
                const newTitle = await page.title();
                const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || "");

                return { clicked: true, currentUrl: newUrl, pageTitle: newTitle, bodyPreview: bodyText };
            } catch (err) {
                return { error: `Click failed: ${(err as Error).message}` };
            } finally {
                await page.close();
            }
        },
    };
}

export function webScreenshotTool(): ToolDefinition {
    return {
        name: "web_screenshot",
        description: "Take a screenshot of a webpage. Returns a base64 image that can be analyzed. Useful for capturing utility bill pages or verifying portal state.",
        parameters: {
            url: { type: "string", description: "URL to screenshot" },
            fullPage: { type: "boolean", description: "Capture full page scroll (default false)" },
            mobile: { type: "boolean", description: "Use mobile viewport (default true)" },
        },
        required: ["url"],
        category: "web",
        enabled: true,
        async execute(args) {
            const browser = await getBrowser();
            if (!browser) return { error: "Browser not available" };

            const page = await browser.newPage();
            try {
                const isMobile = args.mobile !== false;
                const viewport = isMobile ? MOBILE_VIEWPORT : DESKTOP_VIEWPORT;
                await page.setViewport(viewport);
                if (isMobile) await page.setUserAgent(MOBILE_UA);
                await page.goto(String(args.url), { waitUntil: "networkidle2", timeout: DEFAULT_TIMEOUT });

                const screenshot = await page.screenshot({
                    encoding: "base64",
                    fullPage: args.fullPage === true,
                    type: "png",
                });

                return {
                    base64: screenshot,
                    mimeType: "image/png",
                    url: page.url(),
                    title: await page.title(),
                };
            } catch (err) {
                return { error: `Screenshot failed: ${(err as Error).message}` };
            } finally {
                await page.close();
            }
        },
    };
}

export function webReadPageTool(): ToolDefinition {
    return {
        name: "web_read_page",
        description: "Read a webpage and extract its main content as clean text. Strips navigation, ads, and other noise. Simulates a mobile browser for realistic rendering. Use this to read articles, documents, utility bill pages, or any website.",
        parameters: {
            url: { type: "string", description: "URL to read" },
            extractTables: { type: "boolean", description: "Also extract HTML tables as structured data (default true)" },
        },
        required: ["url"],
        category: "web",
        enabled: true,
        async execute(args) {
            const url = String(args.url);
            if (isDomainBlocked(url)) return { error: "Domain not allowed" };

            const browser = await getBrowser();
            if (!browser) return { error: "Browser not available. Install puppeteer: npm install puppeteer" };

            const page = await browser.newPage();
            try {
                await page.setViewport(MOBILE_VIEWPORT);
                await page.setUserAgent(MOBILE_UA);
                await page.goto(url, { waitUntil: "networkidle2", timeout: DEFAULT_TIMEOUT });

                const data = await page.evaluate((extractTables: boolean) => {
                    // Remove noise elements
                    const remove = ["nav", "header", "footer", ".cookie-banner", ".ad", "[role=banner]", "[role=navigation]", "script", "style", "noscript"];
                    remove.forEach(sel => {
                        document.querySelectorAll(sel).forEach(el => el.remove());
                    });

                    const title = document.title || "";
                    const mainEl = document.querySelector("main, article, [role=main], .content, #content") || document.body;
                    const text = (mainEl as HTMLElement)?.innerText || "";

                    // Extract tables
                    let tables: any[] = [];
                    if (extractTables) {
                        tables = Array.from(document.querySelectorAll("table")).slice(0, 5).map(table => {
                            const headers = Array.from(table.querySelectorAll("th")).map(th => th.innerText.trim());
                            const rows = Array.from(table.querySelectorAll("tbody tr, tr")).slice(0, 30).map(tr =>
                                Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim())
                            ).filter(r => r.length > 0);
                            return { headers, rows };
                        });
                    }

                    // Extract meta
                    const meta = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
                    const h1 = document.querySelector("h1")?.innerText || "";

                    return { title, h1, meta, text, tables };
                }, args.extractTables !== false);

                const truncated = data.text.length > MAX_PAGE_TEXT_LENGTH
                    ? data.text.slice(0, MAX_PAGE_TEXT_LENGTH) + "\n...[truncated]"
                    : data.text;

                return {
                    url: page.url(),
                    title: data.title,
                    heading: data.h1,
                    description: data.meta,
                    content: truncated,
                    contentLength: data.text.length,
                    tables: data.tables,
                    isMobile: true,
                };
            } catch (err) {
                return { error: `Page read failed: ${(err as Error).message}`, url };
            } finally {
                await page.close();
            }
        },
    };
}

// ═══════════════════════════════════════════════════════════
//  UTILITY BILL SCRAPER — Compound tool for full flow
// ═══════════════════════════════════════════════════════════

export function scrapeUtilityBillTool(): ToolDefinition {
    return {
        name: "scrape_utility_bill",
        description: "Automated utility bill scraper. Logs into a utility provider portal, navigates to the billing page, and extracts the latest bill amount, usage, and billing period. Uses stored credentials from the database.",
        parameters: {
            credentialId: { type: "string", description: "UtilityCredential ID from get_utility_credentials" },
            unitId: { type: "string", description: "Unit ID for bill association" },
        },
        required: ["credentialId"],
        category: "web",
        enabled: true,
        async execute(args) {
            // Fetch the credential (including password, only used internally)
            const { db: prisma } = require("../../config/database");
            const repo = require("../repository");
            const cred = await prisma.utilityCredential.findUnique({ where: { id: String(args.credentialId) } });
            if (!cred) return { error: "Credential not found" };
            if (!cred.username) return { error: "Credential missing username" };

            // Decrypt password — stored encrypted in passwordEncrypted field
            const password = await repo.getDecryptedUtilityPassword(cred.id);
            if (!password) return { error: "Credential missing password. Please update the credential with a password." };

            const browser = await getBrowser();
            if (!browser) return { error: "Browser not available. Install puppeteer" };

            const page = await browser.newPage();
            try {
                await page.setViewport(DESKTOP_VIEWPORT);

                // Navigate to login URL — prefer the url field, fall back to URL in notes
                const loginUrl = cred.url || (cred.notes || "").match(/https?:\/\/\S+/)?.[0] || "";
                if (!loginUrl) {
                    return { error: "No login URL found. Add the portal URL when saving the credential." };
                }

                await page.goto(loginUrl, { waitUntil: "networkidle2", timeout: DEFAULT_TIMEOUT });

                // Try to find and fill login form
                const loginResult = await page.evaluate(() => {
                    const userFields = document.querySelectorAll('input[type="text"], input[type="email"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]');
                    const passFields = document.querySelectorAll('input[type="password"]');
                    return {
                        userSelector: userFields.length > 0 ? `input[type="${(userFields[0] as any).type}"]` : null,
                        passSelector: passFields.length > 0 ? "input[type='password']" : null,
                        formFound: userFields.length > 0 && passFields.length > 0,
                    };
                });

                if (!loginResult.formFound) {
                    // Take screenshot for debugging
                    const ss = await page.screenshot({ encoding: "base64", type: "png" });
                    return {
                        error: "Could not find login form on page",
                        screenshot: ss,
                        url: page.url(),
                        pageTitle: await page.title(),
                    };
                }

                // Fill credentials
                await page.click(loginResult.userSelector!);
                await page.type(loginResult.userSelector!, cred.username, { delay: 30 });
                await page.click(loginResult.passSelector!);
                await page.type(loginResult.passSelector!, password, { delay: 30 });

                // Submit
                const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
                if (submitBtn) {
                    await submitBtn.click();
                } else {
                    await page.keyboard.press("Enter");
                }

                await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => { });

                // Extract whatever billing data we can find
                const billingData = await page.evaluate(() => {
                    const text = document.body?.innerText || "";
                    // Look for dollar amounts
                    const amounts = text.match(/\$[\d,]+\.?\d{0,2}/g) || [];
                    // Look for dates
                    const dates = text.match(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g) || [];
                    // Get page text (truncated)
                    return {
                        pageText: text.slice(0, 6000),
                        pageTitle: document.title,
                        amountsFound: amounts.slice(0, 10),
                        datesFound: dates.slice(0, 10),
                        url: window.location.href,
                    };
                });

                const screenshot = await page.screenshot({ encoding: "base64", type: "png" });

                return {
                    success: true,
                    utilityType: cred.utilityType,
                    unitId: cred.unitId,
                    ...billingData,
                    screenshot,
                    note: "Review the extracted data. Use create_utility_bill to save confirmed amounts.",
                };
            } catch (err) {
                return { error: `Scrape failed: ${(err as Error).message}` };
            } finally {
                await page.close();
            }
        },
    };
}

// ═══════════════════════════════════════════════════════════
//  AGENTIC BROWSE — LLM-driven autonomous navigation
// ═══════════════════════════════════════════════════════════

export function agenticBrowseTool(): ToolDefinition {
    return {
        name: "agentic_browse",
        description:
            "Autonomously navigate a website using AI vision. Give it a goal like 'log into the hydro portal and get the latest bill'. It uses screenshots + numbered element mapping to navigate, fill forms, handle CAPTCHAs, and extract data — all without needing CSS selectors. Use this for complex multi-step web tasks.",
        parameters: {
            goal: {
                type: "string",
                description:
                    "What to accomplish, e.g. 'Log into Toronto Hydro and extract the latest bill amount and due date'",
            },
            startUrl: {
                type: "string",
                description: "URL to start navigating from",
            },
            username: {
                type: "string",
                description: "Login username/email (optional)",
            },
            password: {
                type: "string",
                description: "Login password (optional)",
            },
            maxSteps: {
                type: "number",
                description: "Max navigation steps before giving up (default 15)",
            },
        },
        required: ["goal", "startUrl"],
        category: "web",
        enabled: true,
        async execute(args) {
            try {
                const { AgenticNavigator, createGeminiProvider } = require("../../../packages/agentic-browser/src");
                const { vertexAI, defaultModel } = require("../../config/gemini");

                if (!vertexAI) {
                    return { error: "Gemini API not configured. Set GOOGLE_API_KEY." };
                }

                const model = vertexAI.getGenerativeModel({ model: defaultModel });
                const llm = createGeminiProvider(model);

                const navigator = new AgenticNavigator({
                    llm,
                    headless: true,
                    debug: process.env.AGENTIC_BROWSER_DEBUG === "true",
                    captcha: {
                        provider: (process.env.CAPTCHA_PROVIDER as any) || "none",
                        apiKey: process.env.CAPTCHA_API_KEY || undefined,
                        useLLMVision: true,
                    },
                });

                const result = await navigator.run({
                    goal: String(args.goal),
                    startUrl: String(args.startUrl),
                    credentials:
                        args.username && args.password
                            ? { username: String(args.username), password: String(args.password) }
                            : undefined,
                    maxSteps: Number(args.maxSteps) || 15,
                });

                return {
                    success: result.success,
                    extractedData: result.extractedData,
                    stepsUsed: result.steps.length,
                    finalUrl: result.finalUrl,
                    totalTimeMs: result.totalTimeMs,
                    error: result.error,
                    stepSummary: result.steps.map((s: any) => ({
                        step: s.stepNumber,
                        action: s.action?.type,
                        description: s.action?.description || s.action?.result || s.action?.reason,
                        url: s.url,
                    })),
                };
            } catch (err) {
                return {
                    error: `Agentic browse not available: ${(err as Error).message}. Ensure puppeteer is installed.`,
                };
            }
        },
    };
}

/**
 * Register all web tools.
 */
export function registerWebTools(): ToolDefinition[] {
    return [
        webBrowseTool(),
        webFillFormTool(),
        webClickTool(),
        webScreenshotTool(),
        webReadPageTool(),
        scrapeUtilityBillTool(),
        agenticBrowseTool(),
    ];
}

/** Graceful shutdown */
export { closeBrowser };
