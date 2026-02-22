/**
 * tools.ts — Exportable tool definitions for any agent framework.
 *
 * These can be registered with NestMind's tool registry, OpenAI function
 * calling, LangChain, or any other agent framework.
 *
 * Tools provided:
 *  1. agentic_browse — Full autonomous navigation (give it a goal, it does the rest)
 *  2. browse_page   — Simple page read (non-agentic, quick)
 *  3. screenshot     — Take a screenshot of a URL
 *
 * Format converters:
 *  - toOpenAITools()  — Convert to OpenAI function calling format
 *  - toGeminiTools()  — Convert to Gemini FunctionDeclaration format
 */

import { AgenticNavigator } from "./navigator";
import { BrowserSession } from "./session";
import {
    extractElements,
    formatElementsForLLM,
} from "./elements";
import { AgentToolDefinition, BrowserConfig } from "./types";

// ═══════════════════════════════════════════════════════════
//  CREATE TOOL SET
// ═══════════════════════════════════════════════════════════

/**
 * Create a set of browser tools configured with your LLM provider.
 * Register these with your agent framework.
 */
export function createBrowserTools(
    config: BrowserConfig,
): AgentToolDefinition[] {
    return [
        agenticNavigateTool(config),
        browseTool(config),
        screenshotTool(config),
    ];
}

// ── Tool: Agentic Navigate ──────────────────────────────────

function agenticNavigateTool(
    config: BrowserConfig,
): AgentToolDefinition {
    return {
        name: "agentic_browse",
        description:
            "Autonomously navigate a website to accomplish a goal. Uses AI vision to understand pages, handle CAPTCHAs, fill forms, and extract data. Give it a goal like 'log into hydro.com and get the latest bill amount' and it will do the rest.",
        parameters: {
            goal: {
                type: "string",
                description:
                    "What to accomplish (e.g., 'Log into the utility portal and extract the latest bill amount and due date')",
                required: true,
            },
            startUrl: {
                type: "string",
                description: "URL to start from",
                required: true,
            },
            username: {
                type: "string",
                description:
                    "Login username/email (optional)",
            },
            password: {
                type: "string",
                description: "Login password (optional)",
            },
            maxSteps: {
                type: "number",
                description:
                    "Max navigation steps (default 15)",
            },
        },
        async execute(args) {
            const navigator = new AgenticNavigator(config);
            const result = await navigator.run({
                goal: String(args.goal),
                startUrl: String(args.startUrl),
                credentials:
                    args.username && args.password
                        ? {
                            username: String(
                                args.username,
                            ),
                            password: String(
                                args.password,
                            ),
                        }
                        : undefined,
                maxSteps: Number(args.maxSteps) || 15,
            });

            return {
                success: result.success,
                result:
                    result.extractedData ||
                    result.error ||
                    "No data extracted",
                steps: result.steps.length,
                finalUrl: result.finalUrl,
                timeMs: result.totalTimeMs,
                error: result.error,
            };
        },
    };
}

// ── Tool: Simple Browse ─────────────────────────────────────

function browseTool(
    config: BrowserConfig,
): AgentToolDefinition {
    return {
        name: "browse_page",
        description:
            "Read a webpage and extract its content. Returns page title, text, interactive elements, and forms. Faster than agentic_browse but does not navigate autonomously.",
        parameters: {
            url: {
                type: "string",
                description: "URL to read",
                required: true,
            },
            mobile: {
                type: "boolean",
                description:
                    "Use mobile viewport (default false)",
            },
        },
        async execute(args) {
            const session = new BrowserSession({
                ...config,
                viewport: args.mobile
                    ? {
                        width: 390,
                        height: 844,
                        deviceScaleFactor: 3,
                        isMobile: true,
                    }
                    : undefined,
            });

            try {
                await session.init();
                await session.navigate(String(args.url));

                const { elements, forms, bodyText } =
                    await extractElements(
                        session.currentPage,
                    );
                const title = await session.getTitle();
                const url = await session.getUrl();

                return {
                    url,
                    title,
                    bodyText:
                        bodyText.length > 8000
                            ? bodyText.slice(0, 8000) +
                            "\n...[truncated]"
                            : bodyText,
                    bodyLength: bodyText.length,
                    elements: formatElementsForLLM(elements),
                    elementCount: elements.length,
                    forms,
                };
            } catch (err) {
                return {
                    error: `Browse failed: ${(err as Error).message}`,
                    url: args.url,
                };
            } finally {
                await session.close();
            }
        },
    };
}

// ── Tool: Screenshot ────────────────────────────────────────

function screenshotTool(
    config: BrowserConfig,
): AgentToolDefinition {
    return {
        name: "screenshot",
        description:
            "Take a screenshot of a webpage. Returns a base64 PNG image.",
        parameters: {
            url: {
                type: "string",
                description: "URL to screenshot",
                required: true,
            },
            fullPage: {
                type: "boolean",
                description:
                    "Capture full page (default false)",
            },
        },
        async execute(args) {
            const session = new BrowserSession(config);
            try {
                await session.init();
                await session.navigate(String(args.url));

                const screenshot =
                    await session.screenshot();
                const title = await session.getTitle();
                const url = await session.getUrl();

                return {
                    base64: screenshot,
                    mimeType: "image/png",
                    url,
                    title,
                };
            } catch (err) {
                return {
                    error: `Screenshot failed: ${(err as Error).message}`,
                };
            } finally {
                await session.close();
            }
        },
    };
}

// ═══════════════════════════════════════════════════════════
//  FORMAT CONVERTERS — for different agent frameworks
// ═══════════════════════════════════════════════════════════

/**
 * Convert tool definitions to OpenAI function calling format.
 */
export function toOpenAITools(
    tools: AgentToolDefinition[],
): any[] {
    return tools.map((tool) => ({
        type: "function",
        function: {
            name: tool.name,
            description: tool.description,
            parameters: {
                type: "object",
                properties: Object.fromEntries(
                    Object.entries(tool.parameters).map(
                        ([k, v]) => [
                            k,
                            {
                                type: v.type,
                                description: v.description,
                                ...(v.enum
                                    ? { enum: v.enum }
                                    : {}),
                            },
                        ],
                    ),
                ),
                required: Object.entries(tool.parameters)
                    .filter(([, v]) => v.required)
                    .map(([k]) => k),
            },
        },
    }));
}

/**
 * Convert tool definitions to Google Gemini FunctionDeclaration format.
 */
export function toGeminiTools(
    tools: AgentToolDefinition[],
): any[] {
    return tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: {
            type: "OBJECT",
            properties: Object.fromEntries(
                Object.entries(tool.parameters).map(
                    ([k, v]) => [
                        k,
                        {
                            type: v.type.toUpperCase(),
                            description: v.description,
                            ...(v.enum
                                ? { enum: v.enum }
                                : {}),
                        },
                    ],
                ),
            ),
            required: Object.entries(tool.parameters)
                .filter(([, v]) => v.required)
                .map(([k]) => k),
        },
    }));
}
