/**
 * session.ts — Persistent browser session manager.
 *
 * Unlike basic Puppeteer tooling that opens a new page for every action,
 * BrowserSession keeps ONE browser + ONE page alive across the entire
 * navigation.  This preserves cookies, login state, and JS context.
 *
 * Uses puppeteer-extra with stealth plugin for comprehensive anti-bot evasion.
 */

import { BrowserConfig, ViewportConfig } from "./types";

const DEFAULT_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const DEFAULT_VIEWPORT: ViewportConfig = {
    width: 1280,
    height: 900,
    deviceScaleFactor: 1,
    isMobile: false,
};

/** Random delay between min and max ms (human-like jitter) */
function humanDelay(minMs: number, maxMs: number): Promise<void> {
    const delay = minMs + Math.random() * (maxMs - minMs);
    return new Promise((r) => setTimeout(r, delay));
}

export class BrowserSession {
    private browser: any = null;
    private page: any = null;
    private puppeteer: any = null;
    private config: BrowserConfig;

    constructor(config: BrowserConfig) {
        this.config = config;
    }

    // ── Lifecycle ────────────────────────────────────────────

    async init(): Promise<void> {
        this.puppeteer = await this.loadPuppeteer();
        if (!this.puppeteer)
            throw new Error(
                "Puppeteer not installed. Run: npm install puppeteer",
            );

        const args = [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--window-size=1280,900",
            "--lang=en-US,en",
        ];
        if (this.config.proxy)
            args.push(`--proxy-server=${this.config.proxy}`);

        this.browser = await this.puppeteer.launch({
            headless:
                this.config.headless !== false ? "new" : false,
            args,
            executablePath: this.config.executablePath || undefined,
        });

        this.page = await this.browser.newPage();

        // Viewport
        const vp = this.config.viewport || DEFAULT_VIEWPORT;
        await this.page.setViewport(vp);

        // User-agent
        const ua =
            this.config.userAgent ||
            (vp.isMobile ? MOBILE_UA : DEFAULT_UA);
        await this.page.setUserAgent(ua);

        // Comprehensive anti-bot evasion (supplements stealth plugin)
        await this.page.evaluateOnNewDocument(() => {
            // 1. Hide webdriver flag
            Object.defineProperty(navigator, "webdriver", {
                get: () => false,
            });

            // 2. Proper chrome object
            // @ts-ignore
            window.chrome = {
                runtime: {
                    onMessage: { addListener: () => {}, removeListener: () => {} },
                    sendMessage: () => {},
                },
                loadTimes: () => {},
                csi: () => {},
            };

            // 3. Override navigator.plugins to look non-empty
            Object.defineProperty(navigator, "plugins", {
                get: () => [
                    { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer" },
                    { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai" },
                    { name: "Native Client", filename: "internal-nacl-plugin" },
                ],
            });

            // 4. Override navigator.languages
            Object.defineProperty(navigator, "languages", {
                get: () => ["en-US", "en"],
            });

            // 5. Override permissions query
            const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
            if (origQuery) {
                // @ts-ignore
                window.navigator.permissions.query = (params: any) => {
                    if (params.name === "notifications") {
                        return Promise.resolve({ state: "denied" } as any);
                    }
                    return origQuery(params);
                };
            }

            // 6. Mask WebGL vendor/renderer
            const getParameter = WebGLRenderingContext.prototype.getParameter;
            WebGLRenderingContext.prototype.getParameter = function (param: number) {
                if (param === 37445) return "Intel Inc.";
                if (param === 37446) return "Intel Iris OpenGL Engine";
                return getParameter.call(this, param);
            };
        });

        // Default timeout
        this.page.setDefaultTimeout(this.config.timeout || 30000);

        // Add small random mouse movement to mimic human
        await this.simulateHumanPresence();
    }

    async close(): Promise<void> {
        if (this.page) await this.page.close().catch(() => { });
        if (this.browser) await this.browser.close().catch(() => { });
        this.page = null;
        this.browser = null;
    }

    get isActive(): boolean {
        return !!(
            this.browser?.isConnected?.() &&
            this.page &&
            !this.page.isClosed()
        );
    }

    // ── Navigation ──────────────────────────────────────────

    async navigate(url: string): Promise<void> {
        if (!this.page) throw new Error("Session not initialized");
        await this.page.goto(url, {
            waitUntil: "networkidle2",
            timeout: this.config.timeout || 30000,
        });
    }

    async waitForNavigation(timeout = 10000): Promise<void> {
        await this.page
            .waitForNavigation({
                waitUntil: "networkidle2",
                timeout,
            })
            .catch(() => { });
    }

    async waitForSelector(
        selector: string,
        timeout = 10000,
    ): Promise<void> {
        await this.page
            .waitForSelector(selector, { timeout })
            .catch(() => { });
    }

    // ── Interaction ─────────────────────────────────────────

    async click(selector: string): Promise<void> {
        await this.page.click(selector);
    }

    async clickAtPosition(x: number, y: number): Promise<void> {
        await this.page.mouse.click(x, y);
    }

    async type(selector: string, text: string): Promise<void> {
        await this.page.click(selector);
        await humanDelay(100, 300);
        await this.page.type(selector, text, { delay: 50 + Math.random() * 80 });
    }

    async typeAtCurrentFocus(text: string): Promise<void> {
        await this.page.keyboard.type(text, { delay: 50 + Math.random() * 80 });
    }

    async pressKey(key: string): Promise<void> {
        await this.page.keyboard.press(key);
    }

    async selectAll(): Promise<void> {
        await this.page.keyboard.down("Control");
        await this.page.keyboard.press("a");
        await this.page.keyboard.up("Control");
    }

    async hover(x: number, y: number): Promise<void> {
        await this.page.mouse.move(x, y);
    }

    async scroll(distance: number): Promise<void> {
        await this.page.evaluate(
            (d: number) => window.scrollBy(0, d),
            distance,
        );
    }

    // ── Information ─────────────────────────────────────────

    async screenshot(): Promise<string> {
        return await this.page.screenshot({
            encoding: "base64",
            type: "png",
            fullPage: false,
        });
    }

    async getUrl(): Promise<string> {
        return this.page.url();
    }

    async getTitle(): Promise<string> {
        return await this.page.title();
    }

    async evaluate(fn: Function, ...args: any[]): Promise<any> {
        return await this.page.evaluate(fn, ...args);
    }

    get currentPage(): any {
        return this.page;
    }

    // ── Cookies ─────────────────────────────────────────────

    async getCookies(): Promise<any[]> {
        return await this.page.cookies();
    }

    async setCookies(cookies: any[]): Promise<void> {
        await this.page.setCookie(...cookies);
    }

    // ── Private ─────────────────────────────────────────────

    /** Simulate small random mouse movements to look human */
    private async simulateHumanPresence(): Promise<void> {
        try {
            const x = 400 + Math.floor(Math.random() * 400);
            const y = 300 + Math.floor(Math.random() * 300);
            await this.page.mouse.move(x, y, { steps: 5 + Math.floor(Math.random() * 10) });
            await humanDelay(200, 500);
        } catch { /* ignore */ }
    }

    /**
     * Load puppeteer-extra with stealth plugin for anti-detection.
     * Falls back to regular puppeteer/puppeteer-core if extra is not installed.
     */
    private async loadPuppeteer(): Promise<any> {
        // Try puppeteer-extra + stealth first (preferred)
        try {
            const pExtra = require("puppeteer-extra");
            const StealthPlugin = require("puppeteer-extra-plugin-stealth");
            pExtra.use(StealthPlugin());
            return pExtra;
        } catch { }

        // Fallback to regular puppeteer
        try {
            return require("puppeteer");
        } catch { }
        try {
            return require("puppeteer-core");
        } catch { }
        return null;
    }
}

export { DEFAULT_UA, MOBILE_UA, DEFAULT_VIEWPORT };
