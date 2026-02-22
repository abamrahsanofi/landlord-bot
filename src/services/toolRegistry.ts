/**
 * toolRegistry.ts — Pluggable tool definitions for the agentic framework.
 *
 * Each tool has:
 *  - name:        identifier the LLM uses to call it
 *  - description: what it does (shown to LLM)
 *  - parameters:  JSON Schema of accepted arguments
 *  - execute:     async function that runs the tool and returns a result
 *  - enabled:     whether the tool is available (can be toggled per-plan)
 *
 * Generic / domain-agnostic — used by any vertical plugin.
 */

export type ToolCategory = "data" | "communication" | "web" | "ai" | "utility";

export type ToolDefinition = {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    required?: string[];
    execute: (args: Record<string, unknown>) => Promise<unknown>;
    enabled: boolean;
    category: ToolCategory;
};

/** Config-driven plan restrictions. Each tier specifies which categories/tools to block. */
export type PlanRestrictions = Record<
    string,
    { disabledCategories?: ToolCategory[]; disabledTools?: string[] }
>;

/** Default restrictions used when no vertical-specific config is provided */
const DEFAULT_PLAN_RESTRICTIONS: PlanRestrictions = {
    FREE: {
        disabledCategories: ["web"],
        disabledTools: ["send_whatsapp", "dispatch_contractor"],
    },
    PRO: {},
    ENTERPRISE: {},
};

export class ToolRegistry {
    private tools = new Map<string, ToolDefinition>();

    register(tool: ToolDefinition) {
        this.tools.set(tool.name, tool);
    }

    registerMany(tools: ToolDefinition[]) {
        for (const t of tools) this.register(t);
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    has(name: string): boolean {
        return this.tools.has(name);
    }

    listAll(): ToolDefinition[] {
        return [...this.tools.values()];
    }

    listEnabled(): ToolDefinition[] {
        return [...this.tools.values()].filter((t) => t.enabled);
    }

    listByCategory(category: ToolDefinition["category"]): ToolDefinition[] {
        return [...this.tools.values()].filter((t) => t.category === category && t.enabled);
    }

    enable(name: string) {
        const t = this.tools.get(name);
        if (t) t.enabled = true;
    }

    disable(name: string) {
        const t = this.tools.get(name);
        if (t) t.enabled = false;
    }

    /**
     * Disable tools not available on the given plan tier.
     * Uses a config-driven approach so any vertical can define its own restrictions.
     *
     * @param plan - The plan tier
     * @param restrictions - Optional map of plan → { disabledCategories, disabledTools }.
     *   If not provided, uses sensible defaults (FREE blocks web + communication).
     */
    applyPlanRestrictions(
        plan: "FREE" | "PRO" | "ENTERPRISE",
        restrictions?: PlanRestrictions,
    ) {
        const config = restrictions || DEFAULT_PLAN_RESTRICTIONS;
        const tierConfig = config[plan];
        if (!tierConfig) {
            // No restrictions for this tier → enable everything
            for (const tool of this.tools.values()) tool.enabled = true;
            return;
        }

        for (const tool of this.tools.values()) {
            const categoryBlocked = tierConfig.disabledCategories?.includes(tool.category) ?? false;
            const nameBlocked = tierConfig.disabledTools?.includes(tool.name) ?? false;
            tool.enabled = !categoryBlocked && !nameBlocked;
        }
    }
}
