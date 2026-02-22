/**
 * types.ts — All TypeScript types for the Agentic Browser package.
 *
 * This package is provider-agnostic: you supply any LLM that can take
 * text + images and return text.  Works with Gemini, OpenAI, Anthropic,
 * Ollama, or any other provider.
 */

// ═══════════════════════════════════════════════════════════
//  LLM PROVIDER — the only external dependency
// ═══════════════════════════════════════════════════════════

/** Provider-agnostic LLM interface.  Implement this with any model. */
export interface LLMProvider {
    generateText(
        prompt: string,
        options?: GenerateOptions,
    ): Promise<string>;
}

export interface GenerateOptions {
    systemPrompt?: string;
    images?: ImageInput[];
    temperature?: number;
}

export interface ImageInput {
    base64: string;
    mimeType: string; // "image/png" | "image/jpeg"
}

// ═══════════════════════════════════════════════════════════
//  BROWSER CONFIG
// ═══════════════════════════════════════════════════════════

export interface BrowserConfig {
    /** LLM used for vision + decision-making */
    llm: LLMProvider;
    /** Run headless (default true) */
    headless?: boolean;
    /** HTTP/SOCKS5 proxy URL */
    proxy?: string;
    /** Custom user-agent */
    userAgent?: string;
    /** Viewport size */
    viewport?: ViewportConfig;
    /** Navigation timeout ms (default 30000) */
    timeout?: number;
    /** CAPTCHA solver config */
    captcha?: CaptchaConfig;
    /** Log debug info to console */
    debug?: boolean;
    /** Path to Chrome/Chromium when using puppeteer-core */
    executablePath?: string;
}

export interface ViewportConfig {
    width: number;
    height: number;
    deviceScaleFactor?: number;
    isMobile?: boolean;
    hasTouch?: boolean;
}

// ═══════════════════════════════════════════════════════════
//  CAPTCHA
// ═══════════════════════════════════════════════════════════

export interface CaptchaConfig {
    /** Which solver service to use ('none' disables solving) */
    provider: "none" | "2captcha" | "anticaptcha" | "capsolver";
    /** API key for the solver service */
    apiKey?: string;
    /** Try LLM vision for simple image CAPTCHAs before calling solver */
    useLLMVision?: boolean;
}

export type CaptchaType =
    | "recaptcha-v2"
    | "recaptcha-v3"
    | "hcaptcha"
    | "turnstile"
    | "image"
    | "unknown";

export interface CaptchaInfo {
    type: CaptchaType;
    siteKey?: string;
    imageBase64?: string;
}

// ═══════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════

export interface NavigationGoal {
    /** Natural-language description of what to accomplish */
    goal: string;
    /** Starting URL */
    startUrl: string;
    /** Login credentials (optional) */
    credentials?: { username: string; password: string };
    /** Max agent steps before giving up (default 15) */
    maxSteps?: number;
    /** Schema of data to extract, e.g. { billAmount: "dollar amount", dueDate: "date" } */
    extractSchema?: Record<string, string>;
    /** Callback fired after each step */
    onStep?: (step: NavigationStep) => void;
}

export interface NavigationStep {
    stepNumber: number;
    url: string;
    pageTitle: string;
    action: BrowserAction;
    thinking?: string;
    screenshot?: string;
    elementsFound: number;
    timestamp: number;
}

export interface NavigationResult {
    success: boolean;
    goal: string;
    steps: NavigationStep[];
    extractedData?: Record<string, any>;
    finalUrl: string;
    finalScreenshot?: string;
    error?: string;
    totalTimeMs: number;
}

// ═══════════════════════════════════════════════════════════
//  ACTIONS — what the LLM can tell the browser to do
// ═══════════════════════════════════════════════════════════

export type BrowserAction =
    | { type: "click"; elementId: number; description: string }
    | { type: "type"; elementId: number; text: string; description: string }
    | { type: "clear_and_type"; elementId: number; text: string; description: string }
    | { type: "select"; elementId: number; value: string; description: string }
    | { type: "navigate"; url: string; description: string }
    | { type: "scroll"; direction: "up" | "down"; amount?: number; description: string }
    | { type: "wait"; milliseconds: number; description: string }
    | { type: "press_key"; key: string; description: string }
    | { type: "hover"; elementId: number; description: string }
    | { type: "done"; result: string; extractedData?: Record<string, any> }
    | { type: "fail"; reason: string };

// ═══════════════════════════════════════════════════════════
//  PAGE STATE
// ═══════════════════════════════════════════════════════════

export interface InteractiveElement {
    id: number;
    tag: string;
    type?: string;
    name?: string;
    placeholder?: string;
    text: string;
    ariaLabel?: string;
    href?: string;
    value?: string;
    isVisible: boolean;
    isDisabled?: boolean;
    rect: { x: number; y: number; width: number; height: number };
}

export interface PageState {
    url: string;
    title: string;
    elements: InteractiveElement[];
    bodyText: string;
    screenshot?: string;
    forms: FormInfo[];
    captchaDetected?: CaptchaInfo;
}

export interface FormInfo {
    index: number;
    action: string;
    method: string;
    fields: Array<{
        type: string;
        name: string;
        placeholder: string;
        required: boolean;
    }>;
}

// ═══════════════════════════════════════════════════════════
//  TOOL DEFINITIONS — for agent frameworks
// ═══════════════════════════════════════════════════════════

export interface AgentToolDefinition {
    name: string;
    description: string;
    parameters: Record<
        string,
        {
            type: string;
            description: string;
            required?: boolean;
            enum?: string[];
        }
    >;
    execute: (args: Record<string, any>) => Promise<any>;
}
