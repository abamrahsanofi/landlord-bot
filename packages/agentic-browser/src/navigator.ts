/**
 * navigator.ts — Goal-driven autonomous browser navigation.
 *
 * This is the core of the agentic browser.  Given a high-level goal like
 * "log into Ontario Hydro and get the latest bill amount", it runs a
 * ReAct loop:
 *
 *   Observe page → Ask LLM what to do → Execute action → Repeat
 *
 * The LLM sees:
 *  - Current URL + title
 *  - Numbered list of interactive elements
 *  - Page text content
 *  - Screenshot (multimodal vision)
 *  - Previous action history
 *
 * And responds with a JSON action like:
 *   { "type": "click", "elementId": 3, "description": "Click Login" }
 *   { "type": "type", "elementId": 5, "text": "user@email.com" }
 *   { "type": "done", "result": "Bill is $142.50, due March 15" }
 */

import { BrowserSession } from "./session";
import {
    extractElements,
    formatElementsForLLM,
    clickElementAtCenter,
} from "./elements";
import { detectCaptcha, solveCaptcha } from "./captcha";
import {
    BrowserAction,
    BrowserConfig,
    InteractiveElement,
    LLMProvider,
    NavigationGoal,
    NavigationResult,
    NavigationStep,
    PageState,
} from "./types";

// ═══════════════════════════════════════════════════════════
//  SYSTEM PROMPT — instructs the LLM how to navigate
// ═══════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `You are an AI browser agent. You navigate web pages to accomplish user goals.

You see the current page state:
- URL and page title
- A NUMBERED list of interactive elements: [1], [2], [3], etc.
- Page text content
- A screenshot of the page (if available)
- History of your previous actions

Based on the goal and what you see, decide the NEXT ACTION.

RESPOND WITH ONLY A JSON OBJECT (no markdown fences, no explanation outside JSON):
{
  "thinking": "brief 1-2 sentence reasoning about what you see and what to do next",
  "action": { ... }
}

ACTION TYPES:

1. click — Click an element by its [id] number
   { "type": "click", "elementId": 3, "description": "Click the Login button" }

2. type — Type text into a focused element (clicks it first)
   { "type": "type", "elementId": 5, "text": "user@email.com", "description": "Enter email" }

3. clear_and_type — Clear an input field first, then type new text
   { "type": "clear_and_type", "elementId": 5, "text": "new value", "description": "Replace email" }

4. select — Choose an option from a dropdown
   { "type": "select", "elementId": 7, "value": "option_value", "description": "Select province" }

5. navigate — Go to a specific URL
   { "type": "navigate", "url": "https://...", "description": "Go to billing page" }

6. scroll — Scroll the page
   { "type": "scroll", "direction": "down", "description": "Scroll to see more content" }

7. wait — Wait for dynamic content
   { "type": "wait", "milliseconds": 2000, "description": "Wait for page to load" }

8. press_key — Press a keyboard key (Enter, Tab, Escape, etc.)
   { "type": "press_key", "key": "Enter", "description": "Submit form" }

9. hover — Hover over an element
   { "type": "hover", "elementId": 3, "description": "Hover to reveal dropdown" }

10. done — Goal accomplished, report results
    { "type": "done", "result": "Successfully logged in and found bill: $142.50 due March 15", "extractedData": { "amount": "$142.50", "dueDate": "March 15" } }

11. fail — Goal cannot be completed
    { "type": "fail", "reason": "Login page requires 2FA code that we don't have" }

RULES:
- Always reference elements by their [id] number, never by CSS selector
- For login: fill username FIRST, then password, then click submit
- If you see a CAPTCHA, note it — the system will attempt to solve it
- When filling forms, fill one field at a time
- After clicking submit/login, wait for the page to change before acting
- When the goal is fully accomplished, ALWAYS use "done" with extractedData
- If stuck after 3+ similar attempts, use "fail"
- Be efficient — minimize unnecessary actions`;

// ═══════════════════════════════════════════════════════════
//  NAVIGATOR CLASS
// ═══════════════════════════════════════════════════════════

export class AgenticNavigator {
    private session: BrowserSession;
    private llm: LLMProvider;
    private config: BrowserConfig;
    private debug: boolean;

    constructor(config: BrowserConfig) {
        this.config = config;
        this.llm = config.llm;
        this.session = new BrowserSession(config);
        this.debug = config.debug === true;
    }

    private log(...args: any[]) {
        if (this.debug)
            console.log("[AgenticBrowser]", ...args);
    }

    /**
     * Run autonomous navigation to accomplish a goal.
     * This is the main entry point.
     */
    async run(goal: NavigationGoal): Promise<NavigationResult> {
        const startTime = Date.now();
        const steps: NavigationStep[] = [];
        const maxSteps = goal.maxSteps || 15;

        try {
            await this.session.init();
            this.log(`Starting navigation: "${goal.goal}"`);
            this.log(`URL: ${goal.startUrl}`);

            await this.session.navigate(goal.startUrl);

            for (let step = 1; step <= maxSteps; step++) {
                this.log(`\n── Step ${step}/${maxSteps} ──`);

                // 1. OBSERVE — scan the page
                const pageState = await this.observePage();
                this.log(
                    `URL: ${pageState.url} | Elements: ${pageState.elements.length}`,
                );

                // 2. CHECK FOR CAPTCHA
                if (pageState.captchaDetected) {
                    this.log(
                        `⚠ CAPTCHA detected: ${pageState.captchaDetected.type}`,
                    );
                    if (
                        this.config.captcha &&
                        this.config.captcha.provider !== "none"
                    ) {
                        const solveResult = await solveCaptcha(
                            this.session.currentPage,
                            pageState.captchaDetected,
                            this.config.captcha,
                            this.llm,
                        );
                        if (solveResult.solved) {
                            this.log("✓ CAPTCHA solved");
                            await this.session.waitForNavigation();
                            continue; // Re-observe after solving
                        } else {
                            this.log(
                                `✗ CAPTCHA solver failed: ${solveResult.error}`,
                            );
                        }
                    }
                }

                // 3. THINK — ask LLM what action to take
                const { action, thinking } =
                    await this.decideAction(
                        pageState,
                        goal,
                        steps,
                    );
                this.log(`Thinking: ${thinking}`);
                this.log(
                    `Action: ${action.type}`,
                    JSON.stringify(action).slice(0, 200),
                );

                // 4. RECORD step
                const navStep: NavigationStep = {
                    stepNumber: step,
                    url: pageState.url,
                    pageTitle: pageState.title,
                    action,
                    thinking,
                    screenshot: pageState.screenshot,
                    elementsFound: pageState.elements.length,
                    timestamp: Date.now(),
                };
                steps.push(navStep);
                goal.onStep?.(navStep);

                // 5. CHECK terminal actions
                if (action.type === "done") {
                    this.log(
                        `✓ Goal accomplished: ${action.result}`,
                    );
                    return {
                        success: true,
                        goal: goal.goal,
                        steps,
                        extractedData: action.extractedData,
                        finalUrl: pageState.url,
                        finalScreenshot: pageState.screenshot,
                        totalTimeMs: Date.now() - startTime,
                    };
                }

                if (action.type === "fail") {
                    this.log(`✗ Goal failed: ${action.reason}`);
                    return {
                        success: false,
                        goal: goal.goal,
                        steps,
                        finalUrl: pageState.url,
                        finalScreenshot: pageState.screenshot,
                        error: action.reason,
                        totalTimeMs: Date.now() - startTime,
                    };
                }

                // 6. ACT — execute the action
                await this.executeAction(
                    action,
                    pageState.elements,
                );

                // Give page time to settle after action (human-like random delay)
                const settleDelay = 2000 + Math.floor(Math.random() * 2000);
                await new Promise((r) => setTimeout(r, settleDelay));
            }

            // Max steps exhausted
            const finalUrl = await this.session
                .getUrl()
                .catch(() => "");
            const finalScreenshot = await this.session
                .screenshot()
                .catch(() => undefined);

            return {
                success: false,
                goal: goal.goal,
                steps,
                finalUrl,
                finalScreenshot,
                error: `Max steps (${maxSteps}) reached without completing goal`,
                totalTimeMs: Date.now() - startTime,
            };
        } catch (err) {
            const finalUrl = await this.session
                .getUrl()
                .catch(() => "");
            return {
                success: false,
                goal: goal.goal,
                steps,
                finalUrl,
                error: `Navigation error: ${(err as Error).message}`,
                totalTimeMs: Date.now() - startTime,
            };
        } finally {
            await this.session.close();
        }
    }

    // ── Page observation ────────────────────────────────────

    private async observePage(): Promise<PageState> {
        const page = this.session.currentPage;

        const [url, title] = await Promise.all([
            this.session.getUrl(),
            this.session.getTitle(),
        ]);

        const { elements, forms, bodyText } =
            await extractElements(page);

        const screenshot = await this.session
            .screenshot()
            .catch(() => undefined);

        const captchaDetected =
            (await detectCaptcha(page)) || undefined;

        return {
            url,
            title,
            elements,
            bodyText,
            screenshot,
            forms,
            captchaDetected,
        };
    }

    // ── LLM decision ────────────────────────────────────────

    private async decideAction(
        pageState: PageState,
        goal: NavigationGoal,
        previousSteps: NavigationStep[],
    ): Promise<{ action: BrowserAction; thinking: string }> {
        const elementsList = formatElementsForLLM(
            pageState.elements,
        );

        // Build context
        const contextParts: string[] = [
            `GOAL: ${goal.goal}`,
        ];

        if (goal.credentials) {
            contextParts.push(
                `\nCREDENTIALS AVAILABLE: username="${goal.credentials.username}", password="[provided — use when filling password fields]"`,
            );
        }

        if (goal.extractSchema) {
            contextParts.push(
                `\nDATA TO EXTRACT: ${JSON.stringify(goal.extractSchema)}`,
            );
        }

        if (pageState.captchaDetected) {
            contextParts.push(
                `\n⚠ CAPTCHA DETECTED: ${pageState.captchaDetected.type} — the system is handling it. You may need to wait or try a different approach.`,
            );
        }

        contextParts.push(
            `\n═══ CURRENT PAGE ═══`,
            `URL: ${pageState.url}`,
            `Title: ${pageState.title}`,
            `\n═══ INTERACTIVE ELEMENTS ═══`,
            elementsList || "No interactive elements found.",
            `\n═══ PAGE TEXT (first 3000 chars) ═══`,
            pageState.bodyText.slice(0, 3000) || "[empty page]",
        );

        // Step history
        if (previousSteps.length > 0) {
            contextParts.push(
                `\n═══ PREVIOUS ACTIONS ═══`,
                ...previousSteps.map(
                    (s) =>
                        `Step ${s.stepNumber}: ${s.action.type} — ${(s.action as any).description || (s.action as any).result || (s.action as any).reason || ""} (${s.url})`,
                ),
            );
        }

        contextParts.push(
            `\nWhat is the next action? Respond with ONLY JSON.`,
        );

        const prompt = contextParts.join("\n");

        // Include screenshot for multimodal vision
        const images = pageState.screenshot
            ? [
                {
                    base64: pageState.screenshot,
                    mimeType: "image/png",
                },
            ]
            : undefined;

        try {
            const response = await this.llm.generateText(
                prompt,
                {
                    systemPrompt: SYSTEM_PROMPT,
                    images,
                    temperature: 0.1,
                },
            );

            return this.parseResponse(response);
        } catch (err) {
            this.log("LLM error:", (err as Error).message);
            return {
                action: {
                    type: "fail",
                    reason: `LLM error: ${(err as Error).message}`,
                },
                thinking: "LLM call failed",
            };
        }
    }

    private parseResponse(response: string): {
        action: BrowserAction;
        thinking: string;
    } {
        try {
            // Strip markdown code fences if present
            const clean = response
                .replace(/```json\n?|```\n?/g, "")
                .trim();
            const parsed = JSON.parse(clean);
            const thinking = parsed.thinking || "";
            const action = parsed.action || parsed;

            // Validate action type
            const validTypes = [
                "click",
                "type",
                "clear_and_type",
                "select",
                "navigate",
                "scroll",
                "wait",
                "press_key",
                "hover",
                "done",
                "fail",
            ];
            if (!validTypes.includes(action.type)) {
                return {
                    action: {
                        type: "fail",
                        reason: `Invalid action type from LLM: ${action.type}`,
                    },
                    thinking,
                };
            }

            return { action: action as BrowserAction, thinking };
        } catch {
            // Try to extract JSON from response
            const match = response.match(/\{[\s\S]*\}/);
            if (match) {
                try {
                    const parsed = JSON.parse(match[0]);
                    return {
                        action: (parsed.action ||
                            parsed) as BrowserAction,
                        thinking: parsed.thinking || "",
                    };
                } catch { }
            }

            return {
                action: {
                    type: "fail",
                    reason: `Could not parse LLM response as JSON: ${response.slice(0, 200)}`,
                },
                thinking: "",
            };
        }
    }

    // ── Action execution ────────────────────────────────────

    private async executeAction(
        action: BrowserAction,
        elements: InteractiveElement[],
    ): Promise<void> {
        const page = this.session.currentPage;

        switch (action.type) {
            case "click": {
                const el = this.findElement(
                    elements,
                    action.elementId,
                );
                // Small human-like pause before clicking
                await new Promise((r) => setTimeout(r, 300 + Math.random() * 500));
                await clickElementAtCenter(page, el);
                // Wait longer for potential navigation / SPA transitions
                await this.session.waitForNavigation(10000);
                // Extra settle time for SPAs that don't trigger navigation events
                await new Promise((r) => setTimeout(r, 2000 + Math.random() * 1500));
                break;
            }

            case "type": {
                const el = this.findElement(
                    elements,
                    action.elementId,
                );
                await clickElementAtCenter(page, el);
                await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
                await this.session.typeAtCurrentFocus(
                    action.text,
                );
                // Pause after typing like a human would
                await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
                break;
            }

            case "clear_and_type": {
                const el = this.findElement(
                    elements,
                    action.elementId,
                );
                await clickElementAtCenter(page, el);
                await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
                // Select all and delete
                await this.session.selectAll();
                await this.session.pressKey("Backspace");
                await new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
                await this.session.typeAtCurrentFocus(
                    action.text,
                );
                await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
                break;
            }

            case "select": {
                const el = this.findElement(
                    elements,
                    action.elementId,
                );
                await page.evaluate(
                    (rect: any, value: string) => {
                        const el = document.elementFromPoint(
                            rect.x + rect.width / 2,
                            rect.y + rect.height / 2,
                        ) as HTMLSelectElement;
                        if (el && el.tagName === "SELECT") {
                            el.value = value;
                            el.dispatchEvent(
                                new Event("change", {
                                    bubbles: true,
                                }),
                            );
                        }
                    },
                    el.rect,
                    action.value,
                );
                break;
            }

            case "navigate": {
                await this.session.navigate(action.url);
                break;
            }

            case "scroll": {
                const dist =
                    (action.direction === "down" ? 1 : -1) *
                    (action.amount || 500);
                await this.session.scroll(dist);
                await new Promise((r) => setTimeout(r, 500));
                break;
            }

            case "wait": {
                await new Promise((r) =>
                    setTimeout(
                        r,
                        Math.min(action.milliseconds, 10000),
                    ),
                );
                break;
            }

            case "press_key": {
                await this.session.pressKey(action.key);
                await this.session.waitForNavigation(3000);
                break;
            }

            case "hover": {
                const el = this.findElement(
                    elements,
                    action.elementId,
                );
                await this.session.hover(
                    el.rect.x + el.rect.width / 2,
                    el.rect.y + el.rect.height / 2,
                );
                break;
            }

            // done / fail are handled before executeAction is called
        }
    }

    private findElement(
        elements: InteractiveElement[],
        id: number,
    ): InteractiveElement {
        const el = elements.find((e) => e.id === id);
        if (!el)
            throw new Error(
                `Element [${id}] not found. Available: ${elements.map((e) => e.id).join(",")}`,
            );
        return el;
    }
}
