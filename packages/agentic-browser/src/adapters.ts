/**
 * adapters.ts — Pre-built LLM provider adapters.
 *
 * The Agentic Browser is provider-agnostic: you can pass ANY function that
 * takes text + images and returns text.  These adapters make it easy to
 * connect popular providers without writing boilerplate.
 *
 * Usage:
 *   import { createGeminiProvider } from 'agentic-browser';
 *   const llm = createGeminiProvider(model);
 *   const browser = new AgenticBrowser({ llm });
 */

import { LLMProvider, GenerateOptions } from "./types";

// ═══════════════════════════════════════════════════════════
//  GOOGLE GEMINI / Vertex AI
// ═══════════════════════════════════════════════════════════

/**
 * Create an LLM provider from a Gemini GenerativeModel instance.
 *
 * Works with both:
 *  - @google/generative-ai (AI Studio)
 *  - @google-cloud/vertexai (Vertex AI)
 *
 * @example
 *   const { GoogleGenerativeAI } = require('@google/generative-ai');
 *   const genAI = new GoogleGenerativeAI(apiKey);
 *   const model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
 *   const llm = createGeminiProvider(model);
 */
export function createGeminiProvider(model: any): LLMProvider {
    return {
        async generateText(
            prompt: string,
            options?: GenerateOptions,
        ): Promise<string> {
            const parts: any[] = [];

            // Images first (multimodal)
            if (options?.images) {
                for (const img of options.images) {
                    parts.push({
                        inlineData: {
                            mimeType: img.mimeType,
                            data: img.base64,
                        },
                    });
                }
            }

            // Text prompt
            parts.push({ text: prompt });

            const config: any = {
                contents: [{ role: "user", parts }],
            };

            // System instruction
            if (options?.systemPrompt) {
                config.systemInstruction = {
                    parts: [{ text: options.systemPrompt }],
                };
            }

            // Temperature
            if (options?.temperature !== undefined) {
                config.generationConfig = {
                    temperature: options.temperature,
                };
            }

            const result = await model.generateContent(config);
            return (
                result.response?.candidates?.[0]?.content
                    ?.parts?.[0]?.text || ""
            );
        },
    };
}

// ═══════════════════════════════════════════════════════════
//  OPENAI — GPT-4o, GPT-4-turbo, etc.
// ═══════════════════════════════════════════════════════════

/**
 * Create an LLM provider from an OpenAI client instance.
 *
 * @example
 *   const OpenAI = require('openai');
 *   const client = new OpenAI({ apiKey: 'sk-...' });
 *   const llm = createOpenAIProvider(client, 'gpt-4o');
 */
export function createOpenAIProvider(
    client: any,
    modelName: string = "gpt-4o",
): LLMProvider {
    return {
        async generateText(
            prompt: string,
            options?: GenerateOptions,
        ): Promise<string> {
            const messages: any[] = [];

            // System message
            if (options?.systemPrompt) {
                messages.push({
                    role: "system",
                    content: options.systemPrompt,
                });
            }

            // User message with optional images
            const content: any[] = [];

            if (options?.images) {
                for (const img of options.images) {
                    content.push({
                        type: "image_url",
                        image_url: {
                            url: `data:${img.mimeType};base64,${img.base64}`,
                            detail: "high",
                        },
                    });
                }
            }

            content.push({ type: "text", text: prompt });
            messages.push({ role: "user", content });

            const response =
                await client.chat.completions.create({
                    model: modelName,
                    messages,
                    temperature: options?.temperature ?? 0.1,
                    max_tokens: 2048,
                });

            return (
                response.choices?.[0]?.message?.content || ""
            );
        },
    };
}

// ═══════════════════════════════════════════════════════════
//  ANTHROPIC — Claude 3.5 Sonnet, Claude 4, etc.
// ═══════════════════════════════════════════════════════════

/**
 * Create an LLM provider from an Anthropic client instance.
 *
 * @example
 *   const Anthropic = require('@anthropic-ai/sdk');
 *   const client = new Anthropic({ apiKey: 'sk-ant-...' });
 *   const llm = createAnthropicProvider(client, 'claude-sonnet-4-20250514');
 */
export function createAnthropicProvider(
    client: any,
    modelName: string = "claude-sonnet-4-20250514",
): LLMProvider {
    return {
        async generateText(
            prompt: string,
            options?: GenerateOptions,
        ): Promise<string> {
            const content: any[] = [];

            // Images
            if (options?.images) {
                for (const img of options.images) {
                    content.push({
                        type: "image",
                        source: {
                            type: "base64",
                            media_type: img.mimeType,
                            data: img.base64,
                        },
                    });
                }
            }

            // Text
            content.push({ type: "text", text: prompt });

            const response = await client.messages.create({
                model: modelName,
                max_tokens: 2048,
                system: options?.systemPrompt || undefined,
                messages: [{ role: "user", content }],
                temperature: options?.temperature ?? 0.1,
            });

            return (
                response.content?.[0]?.text ||
                response.content
                    ?.map((c: any) => c.text)
                    .join("") ||
                ""
            );
        },
    };
}

// ═══════════════════════════════════════════════════════════
//  OLLAMA — Local models
// ═══════════════════════════════════════════════════════════

/**
 * Create an LLM provider for Ollama (local LLMs).
 *
 * @example
 *   const llm = createOllamaProvider('llava:latest', 'http://localhost:11434');
 */
export function createOllamaProvider(
    modelName: string = "llava:latest",
    baseUrl: string = "http://localhost:11434",
): LLMProvider {
    return {
        async generateText(
            prompt: string,
            options?: GenerateOptions,
        ): Promise<string> {
            const fullPrompt = options?.systemPrompt
                ? `${options.systemPrompt}\n\n${prompt}`
                : prompt;

            const body: any = {
                model: modelName,
                prompt: fullPrompt,
                stream: false,
                options: {
                    temperature: options?.temperature ?? 0.1,
                },
            };

            // Ollama supports images for multimodal models
            if (options?.images && options.images.length > 0) {
                body.images = options.images.map(
                    (img) => img.base64,
                );
            }

            const res = await fetch(
                `${baseUrl}/api/generate`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(body),
                },
            );

            const data: any = await res.json();
            return data.response || "";
        },
    };
}

// ═══════════════════════════════════════════════════════════
//  CUSTOM — bring your own function
// ═══════════════════════════════════════════════════════════

/**
 * Create an LLM provider from a simple async function.
 *
 * @example
 *   const llm = createCustomProvider(async (prompt, images) => {
 *     const result = await myCustomAPI(prompt, images);
 *     return result.text;
 *   });
 */
export function createCustomProvider(
    fn: (
        prompt: string,
        images?: Array<{ base64: string; mimeType: string }>,
    ) => Promise<string>,
): LLMProvider {
    return {
        async generateText(
            prompt: string,
            options?: GenerateOptions,
        ): Promise<string> {
            const fullPrompt = options?.systemPrompt
                ? `${options.systemPrompt}\n\n${prompt}`
                : prompt;
            return fn(fullPrompt, options?.images);
        },
    };
}
