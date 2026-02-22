/**
 * pageReader.ts — Standalone page reader service that uses the web agent
 * to fetch, render, and extract content from any URL using a mobile browser.
 *
 * This is used for:
 *  - Reading utility portal pages
 *  - Extracting bill amounts from utility websites
 *  - Reading any link a tenant or landlord shares
 *  - Summarizing documents and articles
 *
 * Exposes both raw extraction and AI-summarized results.
 */

import { vertexAI, defaultModel } from "../config/gemini";

// Lazy-load puppeteer
let puppeteer: any = null;

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
            return null;
        }
    }
}

const MOBILE_UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export type PageReadResult = {
    url: string;
    title: string;
    heading: string;
    content: string;
    contentLength: number;
    tables: Array<{ headers: string[]; rows: string[][] }>;
    isMobile: boolean;
    screenshot?: string; // base64 PNG
    error?: string;
};

export type PageSummary = PageReadResult & {
    summary: string;
    keyFacts: string[];
};

/**
 * Read a webpage using a headless mobile browser.
 * Strips noise (nav, footer, ads) and extracts main content + tables.
 */
export async function readPage(url: string, options?: {
    mobile?: boolean;
    screenshot?: boolean;
    maxLength?: number;
}): Promise<PageReadResult> {
    const mobile = options?.mobile !== false;
    const takeScreenshot = options?.screenshot === true;
    const maxLen = options?.maxLength ?? 12000;

    const pup = await loadPuppeteer();
    if (!pup) {
        return {
            url,
            title: "",
            heading: "",
            content: "",
            contentLength: 0,
            tables: [],
            isMobile: mobile,
            error: "Puppeteer not installed. Run: npm install puppeteer",
        };
    }

    let browser: any = null;
    let page: any = null;
    try {
        browser = await pup.launch({
            headless: "new",
            args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        page = await browser.newPage();

        if (mobile) {
            await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
            await page.setUserAgent(MOBILE_UA);
        } else {
            await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
        }

        await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });

        const data = await page.evaluate(() => {
            // Strip noise
            ["nav", "header", "footer", ".cookie-banner", ".ad", "[role=banner]", "[role=navigation]", "script", "style", "noscript", "iframe"]
                .forEach(sel => document.querySelectorAll(sel).forEach(el => el.remove()));

            const title = document.title || "";
            const h1 = document.querySelector("h1")?.innerText || "";
            const mainEl = document.querySelector("main, article, [role=main], .content, #content") || document.body;
            const text = (mainEl as HTMLElement)?.innerText || "";

            const tables = Array.from(document.querySelectorAll("table")).slice(0, 5).map(table => {
                const headers = Array.from(table.querySelectorAll("th")).map(th => th.innerText.trim());
                const rows = Array.from(table.querySelectorAll("tbody tr, tr")).slice(0, 50).map(tr =>
                    Array.from(tr.querySelectorAll("td")).map(td => td.innerText.trim())
                ).filter(r => r.length > 0);
                return { headers, rows };
            });

            return { title, h1, text, tables };
        });

        let screenshot: string | undefined;
        if (takeScreenshot) {
            screenshot = await page.screenshot({ encoding: "base64", type: "png", fullPage: false });
        }

        const truncated = data.text.length > maxLen
            ? data.text.slice(0, maxLen) + "\n...[truncated]"
            : data.text;

        return {
            url: page.url(),
            title: data.title,
            heading: data.h1,
            content: truncated,
            contentLength: data.text.length,
            tables: data.tables,
            isMobile: mobile,
            screenshot,
        };
    } catch (err) {
        return {
            url,
            title: "",
            heading: "",
            content: "",
            contentLength: 0,
            tables: [],
            isMobile: mobile,
            error: (err as Error).message,
        };
    } finally {
        if (page) await page.close().catch(() => { });
        if (browser) await browser.close().catch(() => { });
    }
}

/**
 * Read a webpage AND summarize it with AI.
 * Returns both raw content and an AI-generated summary + key facts.
 */
export async function readAndSummarizePage(url: string, options?: {
    mobile?: boolean;
    summaryPrompt?: string;
}): Promise<PageSummary> {
    const pageData = await readPage(url, { mobile: options?.mobile, screenshot: false });

    if (pageData.error || !pageData.content) {
        return {
            ...pageData,
            summary: pageData.error || "No content extracted",
            keyFacts: [],
        };
    }

    // Summarize with AI
    if (!vertexAI) {
        return {
            ...pageData,
            summary: pageData.content.slice(0, 500),
            keyFacts: [],
        };
    }

    const model = vertexAI.getGenerativeModel({ model: defaultModel });
    const prompt = options?.summaryPrompt || [
        "Summarize this webpage content for a landlord managing rental properties.",
        "Provide a 2-3 sentence summary and extract key facts as bullet points.",
        "If this is a utility bill page, extract: amount, billing period, usage, and due date.",
        "Return JSON with fields: summary (string), keyFacts (string array).",
        "--- PAGE CONTENT ---",
        `Title: ${pageData.title}`,
        `URL: ${pageData.url}`,
        pageData.content,
    ].join("\n");

    try {
        const result = await model.generateContent({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        const text = result.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        const clean = text.replace(/```json\n?|```\n?/g, "").trim();

        try {
            const parsed = JSON.parse(clean);
            return {
                ...pageData,
                summary: parsed.summary || text,
                keyFacts: Array.isArray(parsed.keyFacts) ? parsed.keyFacts : [],
            };
        } catch {
            return {
                ...pageData,
                summary: text,
                keyFacts: [],
            };
        }
    } catch (err) {
        return {
            ...pageData,
            summary: "AI summarization failed: " + (err as Error).message,
            keyFacts: [],
        };
    }
}
