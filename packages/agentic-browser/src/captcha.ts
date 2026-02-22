/**
 * captcha.ts — CAPTCHA detection and automated solving.
 *
 * Detects:  reCAPTCHA v2/v3, hCaptcha, Cloudflare Turnstile, image CAPTCHAs
 * Solves via: 2Captcha, Anti-Captcha, CapSolver, or LLM vision (image only)
 *
 * Flow:
 *  1. detectCaptcha(page) → CaptchaInfo | null
 *  2. solveCaptcha(page, info, config, llm?) → { solved, error? }
 *  3. If solved, the token is injected and the page callback is triggered
 */

import { CaptchaConfig, CaptchaInfo, LLMProvider } from "./types";

// ═══════════════════════════════════════════════════════════
//  DETECTION
// ═══════════════════════════════════════════════════════════

/**
 * Scan the current page for any known CAPTCHA challenges.
 */
export async function detectCaptcha(
    page: any,
): Promise<CaptchaInfo | null> {
    return await page.evaluate(() => {
        // ── reCAPTCHA v2 ─────────────────────────────────
        const rcV2 = document.querySelector(
            '.g-recaptcha, [data-sitekey], iframe[src*="recaptcha/api2"], iframe[src*="recaptcha/enterprise"]',
        );
        if (rcV2) {
            const siteKey =
                rcV2.getAttribute("data-sitekey") ||
                (rcV2 as HTMLIFrameElement).src?.match(
                    /k=([^&]+)/,
                )?.[1] ||
                "";
            return { type: "recaptcha-v2" as const, siteKey };
        }

        // ── reCAPTCHA v3 ─────────────────────────────────
        const rcV3 = document.querySelector(
            'script[src*="recaptcha/api.js?render="]',
        );
        if (rcV3) {
            const siteKey =
                (rcV3 as HTMLScriptElement).src?.match(
                    /render=([^&]+)/,
                )?.[1] || "";
            return { type: "recaptcha-v3" as const, siteKey };
        }

        // ── hCaptcha ─────────────────────────────────────
        const hc = document.querySelector(
            '.h-captcha, [data-hcaptcha-sitekey], iframe[src*="hcaptcha.com"]',
        );
        if (hc) {
            const siteKey =
                hc.getAttribute("data-sitekey") ||
                hc.getAttribute("data-hcaptcha-sitekey") ||
                "";
            return { type: "hcaptcha" as const, siteKey };
        }

        // ── Cloudflare Turnstile ─────────────────────────
        const cf = document.querySelector(
            '.cf-turnstile, [data-turnstile-sitekey], iframe[src*="challenges.cloudflare.com"]',
        );
        if (cf) {
            const siteKey =
                cf.getAttribute("data-sitekey") ||
                cf.getAttribute("data-turnstile-sitekey") ||
                "";
            return { type: "turnstile" as const, siteKey };
        }

        // ── Image CAPTCHA ────────────────────────────────
        const imgCaptcha = document.querySelector(
            'img[alt*="captcha" i], img[src*="captcha" i], img[class*="captcha" i], .captcha img',
        );
        if (imgCaptcha) {
            return { type: "image" as const };
        }

        return null;
    });
}

// ═══════════════════════════════════════════════════════════
//  SOLVING
// ═══════════════════════════════════════════════════════════

/**
 * Attempt to solve a detected CAPTCHA.
 * Supports external solver services and LLM vision for image CAPTCHAs.
 */
export async function solveCaptcha(
    page: any,
    captcha: CaptchaInfo,
    config: CaptchaConfig,
    llm?: LLMProvider,
): Promise<{ solved: boolean; error?: string }> {
    if (config.provider === "none") {
        return {
            solved: false,
            error: "No CAPTCHA solver configured. Set captcha.provider and captcha.apiKey.",
        };
    }

    // Image CAPTCHAs: try LLM vision first (cheaper + faster)
    if (
        captcha.type === "image" &&
        config.useLLMVision &&
        llm
    ) {
        const visionResult =
            await solveImageCaptchaWithVision(page, llm);
        if (visionResult.solved) return visionResult;
        // Fall through to external solver if vision fails
    }

    // Token-based CAPTCHAs → external solver
    if (
        [
            "recaptcha-v2",
            "recaptcha-v3",
            "hcaptcha",
            "turnstile",
        ].includes(captcha.type)
    ) {
        if (!config.apiKey)
            return {
                solved: false,
                error: `No API key for ${config.provider}`,
            };
        return await solveTokenCaptcha(page, captcha, config);
    }

    // Image CAPTCHA via external solver
    if (captcha.type === "image" && config.apiKey) {
        return await solveImageCaptchaExternal(
            page,
            config,
        );
    }

    return {
        solved: false,
        error: `Unsupported CAPTCHA type: ${captcha.type}`,
    };
}

// ═══════════════════════════════════════════════════════════
//  IMAGE CAPTCHA — LLM Vision
// ═══════════════════════════════════════════════════════════

async function solveImageCaptchaWithVision(
    page: any,
    llm: LLMProvider,
): Promise<{ solved: boolean; error?: string }> {
    try {
        // Screenshot the area near the CAPTCHA
        const screenshot = await page.screenshot({
            encoding: "base64",
            type: "png",
        });

        const response = await llm.generateText(
            [
                "Look at this page screenshot. There is a CAPTCHA challenge visible.",
                "What text or characters does the CAPTCHA image show?",
                "Respond with ONLY the CAPTCHA text/answer, nothing else.",
            ].join("\n"),
            {
                images: [
                    {
                        base64: screenshot,
                        mimeType: "image/png",
                    },
                ],
                temperature: 0,
            },
        );

        const answer = response?.trim();
        if (!answer)
            return {
                solved: false,
                error: "LLM returned empty response",
            };

        // Find and fill the CAPTCHA input
        const filled = await page.evaluate(
            (answer: string) => {
                const inputs = document.querySelectorAll(
                    'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], input[class*="captcha" i]',
                );
                if (inputs.length === 0) return false;
                const input = inputs[0] as HTMLInputElement;
                input.value = answer;
                input.dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
                input.dispatchEvent(
                    new Event("change", { bubbles: true }),
                );
                return true;
            },
            answer,
        );

        if (!filled)
            return {
                solved: false,
                error: "CAPTCHA input field not found",
            };

        return { solved: true };
    } catch (err) {
        return {
            solved: false,
            error: `Vision solve failed: ${(err as Error).message}`,
        };
    }
}

// ═══════════════════════════════════════════════════════════
//  IMAGE CAPTCHA — External solver (for complex images)
// ═══════════════════════════════════════════════════════════

async function solveImageCaptchaExternal(
    page: any,
    config: CaptchaConfig,
): Promise<{ solved: boolean; error?: string }> {
    try {
        // Get CAPTCHA image as base64
        const imgBase64 = await page.evaluate(() => {
            const img = document.querySelector(
                'img[alt*="captcha" i], img[src*="captcha" i], img[class*="captcha" i], .captcha img',
            ) as HTMLImageElement;
            if (!img) return null;

            const canvas = document.createElement("canvas");
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext("2d");
            if (!ctx) return null;
            ctx.drawImage(img, 0, 0);
            return canvas
                .toDataURL("image/png")
                .replace("data:image/png;base64,", "");
        });

        if (!imgBase64)
            return {
                solved: false,
                error: "Could not extract CAPTCHA image",
            };

        // Send to solver
        const taskId = await submitImageCaptcha(
            imgBase64,
            config,
        );
        if (!taskId)
            return {
                solved: false,
                error: "Failed to submit image CAPTCHA",
            };

        const answer = await pollCaptchaSolution(
            taskId,
            config,
            60000,
        );
        if (!answer)
            return {
                solved: false,
                error: "Image CAPTCHA solve timed out",
            };

        // Fill the answer
        await page.evaluate((answer: string) => {
            const inputs = document.querySelectorAll(
                'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i]',
            );
            if (inputs.length > 0) {
                (inputs[0] as HTMLInputElement).value = answer;
                inputs[0].dispatchEvent(
                    new Event("input", { bubbles: true }),
                );
            }
        }, answer);

        return { solved: true };
    } catch (err) {
        return {
            solved: false,
            error: `External image solve failed: ${(err as Error).message}`,
        };
    }
}

// ═══════════════════════════════════════════════════════════
//  TOKEN CAPTCHA — reCAPTCHA, hCaptcha, Turnstile
// ═══════════════════════════════════════════════════════════

async function solveTokenCaptcha(
    page: any,
    captcha: CaptchaInfo,
    config: CaptchaConfig,
): Promise<{ solved: boolean; error?: string }> {
    const pageUrl = page.url();

    try {
        // 1. Submit task to solver
        const taskId = await submitTokenCaptcha(
            captcha,
            pageUrl,
            config,
        );
        if (!taskId)
            return {
                solved: false,
                error: "Failed to submit CAPTCHA task to solver",
            };

        // 2. Poll for solution (up to 120s)
        const token = await pollCaptchaSolution(
            taskId,
            config,
            120_000,
        );
        if (!token)
            return {
                solved: false,
                error: "CAPTCHA solve timed out (120s)",
            };

        // 3. Inject token into page
        await injectCaptchaToken(page, captcha, token);

        return { solved: true };
    } catch (err) {
        return {
            solved: false,
            error: `Token solve failed: ${(err as Error).message}`,
        };
    }
}

// ═══════════════════════════════════════════════════════════
//  SOLVER API — submit / poll
// ═══════════════════════════════════════════════════════════

async function submitTokenCaptcha(
    captcha: CaptchaInfo,
    pageUrl: string,
    config: CaptchaConfig,
): Promise<string | null> {
    if (config.provider === "2captcha") {
        const params = new URLSearchParams({
            key: config.apiKey!,
            pageurl: pageUrl,
            json: "1",
        });

        if (captcha.type === "hcaptcha") {
            params.set("method", "hcaptcha");
            params.set("sitekey", captcha.siteKey || "");
        } else if (captcha.type === "turnstile") {
            params.set("method", "turnstile");
            params.set("sitekey", captcha.siteKey || "");
        } else {
            params.set("method", "userrecaptcha");
            params.set("googlekey", captcha.siteKey || "");
            if (captcha.type === "recaptcha-v3") {
                params.set("version", "v3");
                params.set("action", "verify");
                params.set("min_score", "0.5");
            }
        }

        const res = await fetch(
            `https://2captcha.com/in.php?${params}`,
        );
        const data: any = await res.json();
        return data.status === 1 ? data.request : null;
    }

    if (config.provider === "anticaptcha") {
        const typeMap: Record<string, string> = {
            "recaptcha-v2": "RecaptchaV2TaskProxyless",
            "recaptcha-v3": "RecaptchaV3TaskProxyless",
            hcaptcha: "HCaptchaTaskProxyless",
            turnstile: "TurnstileTaskProxyless",
        };

        const res = await fetch(
            "https://api.anti-captcha.com/createTask",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientKey: config.apiKey,
                    task: {
                        type: typeMap[captcha.type] || "RecaptchaV2TaskProxyless",
                        websiteURL: pageUrl,
                        websiteKey: captcha.siteKey,
                        ...(captcha.type === "recaptcha-v3"
                            ? {
                                minScore: 0.5,
                                pageAction: "verify",
                            }
                            : {}),
                    },
                }),
            },
        );
        const data: any = await res.json();
        return data.errorId === 0 ? String(data.taskId) : null;
    }

    if (config.provider === "capsolver") {
        const typeMap: Record<string, string> = {
            "recaptcha-v2": "ReCaptchaV2TaskProxyLess",
            "recaptcha-v3": "ReCaptchaV3TaskProxyLess",
            hcaptcha: "HCaptchaTaskProxyLess",
            turnstile: "AntiTurnstileTaskProxyLess",
        };

        const res = await fetch(
            "https://api.capsolver.com/createTask",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientKey: config.apiKey,
                    task: {
                        type: typeMap[captcha.type] || "ReCaptchaV2TaskProxyLess",
                        websiteURL: pageUrl,
                        websiteKey: captcha.siteKey,
                    },
                }),
            },
        );
        const data: any = await res.json();
        return data.errorId === 0 ? data.taskId : null;
    }

    return null;
}

async function submitImageCaptcha(
    imageBase64: string,
    config: CaptchaConfig,
): Promise<string | null> {
    if (config.provider === "2captcha") {
        const res = await fetch("https://2captcha.com/in.php", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                key: config.apiKey!,
                method: "base64",
                body: imageBase64,
                json: "1",
            }),
        });
        const data: any = await res.json();
        return data.status === 1 ? data.request : null;
    }

    if (config.provider === "anticaptcha") {
        const res = await fetch(
            "https://api.anti-captcha.com/createTask",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientKey: config.apiKey,
                    task: {
                        type: "ImageToTextTask",
                        body: imageBase64,
                    },
                }),
            },
        );
        const data: any = await res.json();
        return data.errorId === 0 ? String(data.taskId) : null;
    }

    if (config.provider === "capsolver") {
        const res = await fetch(
            "https://api.capsolver.com/createTask",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    clientKey: config.apiKey,
                    task: {
                        type: "ImageToTextTask",
                        body: imageBase64,
                    },
                }),
            },
        );
        const data: any = await res.json();
        return data.errorId === 0 ? data.taskId : null;
    }

    return null;
}

async function pollCaptchaSolution(
    taskId: string,
    config: CaptchaConfig,
    timeoutMs: number,
): Promise<string | null> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        // Wait 5s between polls
        await new Promise((r) => setTimeout(r, 5000));

        if (config.provider === "2captcha") {
            const res = await fetch(
                `https://2captcha.com/res.php?key=${config.apiKey}&action=get&id=${taskId}&json=1`,
            );
            const data: any = await res.json();
            if (data.status === 1) return data.request;
            if (data.request !== "CAPCHA_NOT_READY") return null;
        }

        if (config.provider === "anticaptcha") {
            const res = await fetch(
                "https://api.anti-captcha.com/getTaskResult",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        clientKey: config.apiKey,
                        taskId: Number(taskId),
                    }),
                },
            );
            const data: any = await res.json();
            if (data.status === "ready")
                return (
                    data.solution?.gRecaptchaResponse ||
                    data.solution?.token ||
                    data.solution?.text
                );
            if (data.errorId !== 0) return null;
        }

        if (config.provider === "capsolver") {
            const res = await fetch(
                "https://api.capsolver.com/getTaskResult",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        clientKey: config.apiKey,
                        taskId,
                    }),
                },
            );
            const data: any = await res.json();
            if (data.status === "ready")
                return (
                    data.solution?.gRecaptchaResponse ||
                    data.solution?.token ||
                    data.solution?.text
                );
            if (data.errorId !== 0) return null;
        }
    }

    return null; // Timeout
}

// ═══════════════════════════════════════════════════════════
//  TOKEN INJECTION — puts solver token into the page
// ═══════════════════════════════════════════════════════════

async function injectCaptchaToken(
    page: any,
    captcha: CaptchaInfo,
    token: string,
): Promise<void> {
    if (
        captcha.type === "recaptcha-v2" ||
        captcha.type === "recaptcha-v3"
    ) {
        await page.evaluate((token: string) => {
            // Set the response textarea
            const textarea = document.getElementById(
                "g-recaptcha-response",
            ) as HTMLTextAreaElement;
            if (textarea) {
                textarea.value = token;
                textarea.style.display = "block";
            }

            // Also try all textareas with that name
            document
                .querySelectorAll(
                    'textarea[name="g-recaptcha-response"]',
                )
                .forEach((ta) => {
                    (ta as HTMLTextAreaElement).value = token;
                });

            // Trigger the reCAPTCHA callback
            const w = window as any;
            if (w.___grecaptcha_cfg?.clients) {
                const findCallback = (obj: any): any => {
                    if (!obj || typeof obj !== "object")
                        return null;
                    for (const val of Object.values(obj)) {
                        if (typeof val === "function")
                            return val;
                        const found = findCallback(val);
                        if (found) return found;
                    }
                    return null;
                };
                for (const client of Object.values(
                    w.___grecaptcha_cfg.clients,
                ) as any[]) {
                    const cb = findCallback(client);
                    if (cb) {
                        try {
                            cb(token);
                        } catch { }
                    }
                }
            }
            // Also try grecaptcha.execute callback
            if (w.grecaptcha?.enterprise?.execute) {
                try {
                    w.grecaptcha.enterprise.execute();
                } catch { }
            }
        }, token);
    } else if (captcha.type === "hcaptcha") {
        await page.evaluate((token: string) => {
            const resps = document.querySelectorAll(
                '[name="h-captcha-response"], [name="g-recaptcha-response"]',
            );
            resps.forEach((r) => {
                (r as HTMLTextAreaElement).value = token;
            });
            const w = window as any;
            if (w.hcaptcha) {
                try {
                    // Some hCaptcha implementations
                    const iframes = document.querySelectorAll(
                        'iframe[src*="hcaptcha"]',
                    );
                    iframes.forEach((iframe) => {
                        const container = iframe.parentElement;
                        if (container)
                            container.setAttribute(
                                "data-hcaptcha-response",
                                token,
                            );
                    });
                } catch { }
            }
        }, token);
    } else if (captcha.type === "turnstile") {
        await page.evaluate((token: string) => {
            const input = document.querySelector(
                '[name="cf-turnstile-response"]',
            ) as HTMLInputElement;
            if (input) input.value = token;

            const w = window as any;
            if (w.turnstile) {
                try {
                    w.turnstile.getResponse = () => token;
                } catch { }
            }
        }, token);
    }
}
