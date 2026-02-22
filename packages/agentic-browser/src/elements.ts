/**
 * elements.ts — Extract and number all interactive elements on a page.
 *
 * This is the core innovation that makes the browser truly agentic:
 * instead of requiring exact CSS selectors, we assign every clickable /
 * typeable element a sequential number.  The LLM sees "[3] Button: Login"
 * and simply says "click [3]".  We then locate the element by its
 * bounding-box coordinates (reliable across dynamic pages).
 *
 * Inspired by the Browser Use library's element mapping approach.
 */

import { InteractiveElement, FormInfo } from "./types";

// ═══════════════════════════════════════════════════════════
//  EXTRACTION — runs inside the browser page context
// ═══════════════════════════════════════════════════════════

/**
 * Extract all interactive elements from the current page.
 * Returns numbered elements, form info, and page body text.
 */
export async function extractElements(page: any): Promise<{
    elements: InteractiveElement[];
    forms: FormInfo[];
    bodyText: string;
}> {
    return await page.evaluate(() => {
        const results: any[] = [];
        let id = 1;

        // Selectors for interactive elements, ordered by specificity
        const selectors = [
            'a[href]',
            'button',
            'input:not([type="hidden"])',
            'textarea',
            'select',
            '[role="button"]',
            '[role="link"]',
            '[role="tab"]',
            '[role="menuitem"]',
            '[role="checkbox"]',
            '[role="radio"]',
            '[role="switch"]',
            '[onclick]',
            '[tabindex]:not([tabindex="-1"])',
            'label[for]',
            'summary',
        ];

        const seen = new Set<Element>();

        for (const sel of selectors) {
            for (const el of document.querySelectorAll(sel)) {
                if (seen.has(el)) continue;
                seen.add(el);

                const rect = el.getBoundingClientRect();

                // Skip zero-size elements
                if (rect.width === 0 || rect.height === 0) continue;

                // Skip invisible elements
                const style = window.getComputedStyle(el);
                if (
                    style.display === "none" ||
                    style.visibility === "hidden" ||
                    style.opacity === "0"
                )
                    continue;

                // Skip elements way below the fold (>3 viewports)
                if (rect.top > window.innerHeight * 3) continue;

                const htmlEl = el as HTMLElement;
                const inputEl = el as HTMLInputElement;

                results.push({
                    id: id++,
                    tag: el.tagName.toLowerCase(),
                    type: inputEl.type || undefined,
                    name: inputEl.name || inputEl.id || undefined,
                    placeholder: inputEl.placeholder || undefined,
                    text: (htmlEl.innerText || htmlEl.textContent || "")
                        .trim()
                        .slice(0, 80),
                    ariaLabel: el.getAttribute("aria-label") || undefined,
                    href:
                        (el as HTMLAnchorElement).href || undefined,
                    value:
                        inputEl.type === "password"
                            ? "***"
                            : (inputEl.value || "").slice(0, 50) ||
                            undefined,
                    isVisible: true,
                    isDisabled: inputEl.disabled || false,
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                    },
                });
            }
        }

        // ── Extract forms ───────────────────────────────────
        const forms = Array.from(document.querySelectorAll("form")).map(
            (f, i) => {
                const fields = Array.from(
                    f.querySelectorAll("input, select, textarea"),
                ).map((inp: any) => ({
                    type: inp.type || inp.tagName.toLowerCase(),
                    name: inp.name || inp.id || "",
                    placeholder: inp.placeholder || "",
                    required: inp.required || false,
                }));
                return {
                    index: i,
                    action: (f as HTMLFormElement).action || "",
                    method: (f as HTMLFormElement).method || "get",
                    fields,
                };
            },
        );

        // ── Body text (truncated) ────────────────────────────
        const mainEl =
            document.querySelector(
                "main, article, [role=main], .content, #content",
            ) || document.body;
        const bodyText = (
            (mainEl as HTMLElement)?.innerText || ""
        ).slice(0, 8000);

        return { elements: results, forms, bodyText };
    });
}

// ═══════════════════════════════════════════════════════════
//  FORMATTING — turns element list into LLM-readable text
// ═══════════════════════════════════════════════════════════

/**
 * Format extracted elements as a numbered list for the LLM.
 *
 * Example output:
 *   [1] Link: "Home" → https://example.com
 *   [2] Input(email) name="email" placeholder="Enter your email"
 *   [3] Input(password) name="password"
 *   [4] Button: "Sign In"
 */
export function formatElementsForLLM(
    elements: InteractiveElement[],
): string {
    if (elements.length === 0)
        return "No interactive elements found on page.";

    return elements
        .map((el) => {
            const parts = [`[${el.id}]`];

            if (el.isDisabled) parts.push("(disabled)");

            if (el.tag === "a") {
                parts.push(
                    `Link: "${el.text || el.ariaLabel || "unnamed"}"`,
                );
                if (el.href && !el.href.startsWith("javascript:"))
                    parts.push(`→ ${el.href.slice(0, 100)}`);
            } else if (
                el.tag === "button" ||
                el.type === "submit"
            ) {
                parts.push(
                    `Button: "${el.text || el.ariaLabel || "unnamed"}"`,
                );
            } else if (el.tag === "input") {
                parts.push(`Input(${el.type || "text"})`);
                if (el.name) parts.push(`name="${el.name}"`);
                if (el.placeholder)
                    parts.push(`placeholder="${el.placeholder}"`);
                if (el.value && el.type !== "password")
                    parts.push(`value="${el.value}"`);
            } else if (el.tag === "select") {
                parts.push("Dropdown");
                if (el.name) parts.push(`name="${el.name}"`);
            } else if (el.tag === "textarea") {
                parts.push("Textarea");
                if (el.name) parts.push(`name="${el.name}"`);
                if (el.placeholder)
                    parts.push(`placeholder="${el.placeholder}"`);
            } else {
                parts.push(
                    `${el.tag}: "${(el.text || el.ariaLabel || "").slice(0, 50)}"`,
                );
            }

            return parts.join(" ");
        })
        .join("\n");
}

/**
 * Click an element by its bounding rectangle center.
 * More reliable than CSS selectors across dynamic pages.
 */
export async function clickElementAtCenter(
    page: any,
    element: InteractiveElement,
): Promise<void> {
    const x = element.rect.x + element.rect.width / 2;
    const y = element.rect.y + element.rect.height / 2;
    await page.mouse.click(x, y);
}
