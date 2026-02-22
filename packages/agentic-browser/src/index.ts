/**
 * Agentic Browser — LLM-powered autonomous browser agent.
 *
 * A standalone TypeScript library for AI-driven web navigation with:
 *  - Vision-based page understanding (multimodal LLM)
 *  - Numbered element interaction (no CSS selectors needed)
 *  - Goal-driven autonomous navigation (ReAct loop)
 *  - CAPTCHA detection + solving (2captcha, anticaptcha, capsolver, LLM vision)
 *  - Provider-agnostic (Gemini, OpenAI, Anthropic, Ollama, custom)
 *  - Persistent browser sessions (cookies, auth state)
 *
 * Quick start:
 *   import { AgenticBrowser, createGeminiProvider } from 'agentic-browser';
 *
 *   const browser = new AgenticBrowser({
 *     llm: createGeminiProvider(myGeminiModel),
 *   });
 *
 *   const result = await browser.run(
 *     'Log into hydro.com and get the latest bill amount',
 *     'https://hydro.com/login',
 *     { credentials: { username: 'user', password: 'pass' } }
 *   );
 */

// ── Core classes ────────────────────────────────────────────
export { AgenticNavigator } from "./navigator";
export { BrowserSession, DEFAULT_UA, MOBILE_UA, DEFAULT_VIEWPORT } from "./session";

// ── Modules ─────────────────────────────────────────────────
export {
    extractElements,
    formatElementsForLLM,
    clickElementAtCenter,
} from "./elements";
export { detectCaptcha, solveCaptcha } from "./captcha";

// ── Tools for agent frameworks ──────────────────────────────
export {
    createBrowserTools,
    toOpenAITools,
    toGeminiTools,
} from "./tools";

// ── LLM provider adapters ───────────────────────────────────
export {
    createGeminiProvider,
    createOpenAIProvider,
    createAnthropicProvider,
    createOllamaProvider,
    createCustomProvider,
} from "./adapters";

// ── Types ───────────────────────────────────────────────────
export type {
    LLMProvider,
    GenerateOptions,
    ImageInput,
    BrowserConfig,
    ViewportConfig,
    CaptchaConfig,
    CaptchaType,
    CaptchaInfo,
    NavigationGoal,
    NavigationStep,
    NavigationResult,
    BrowserAction,
    InteractiveElement,
    PageState,
    FormInfo,
    AgentToolDefinition,
} from "./types";

// ═══════════════════════════════════════════════════════════
//  CONVENIENCE CLASS — one-liner setup
// ═══════════════════════════════════════════════════════════

import { BrowserConfig, NavigationResult } from "./types";
import { AgenticNavigator } from "./navigator";
import { createBrowserTools } from "./tools";

/**
 * High-level convenience wrapper.  Create once, use to navigate any site.
 *
 * @example
 *   const browser = new AgenticBrowser({
 *     llm: createGeminiProvider(model),
 *     captcha: { provider: '2captcha', apiKey: 'xxx' },
 *     debug: true,
 *   });
 *
 *   const result = await browser.run(
 *     'Log in and get the latest electricity bill',
 *     'https://myhydro.com/login',
 *     { credentials: { username: 'me@me.com', password: 's3cr3t' } }
 *   );
 */
export class AgenticBrowser {
    private config: BrowserConfig;

    constructor(config: BrowserConfig) {
        this.config = config;
    }

    /**
     * Run autonomous navigation toward a goal.
     */
    async run(
        goal: string,
        startUrl: string,
        options?: {
            credentials?: { username: string; password: string };
            maxSteps?: number;
            extractSchema?: Record<string, string>;
            onStep?: (step: any) => void;
        },
    ): Promise<NavigationResult> {
        const navigator = new AgenticNavigator(this.config);
        return navigator.run({
            goal,
            startUrl,
            ...options,
        });
    }

    /**
     * Get tool definitions for use with an external agent framework.
     * Supports format conversion via toOpenAITools() / toGeminiTools().
     */
    getTools() {
        return createBrowserTools(this.config);
    }
}
