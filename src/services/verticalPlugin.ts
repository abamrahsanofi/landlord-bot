/**
 * verticalPlugin.ts — Interface for business vertical plugins.
 *
 * The platform core (agent loop, tool registry, WhatsApp, billing, auth)
 * is generic. Each business vertical (property management, dental office,
 * law firm, restaurant, etc.) implements this interface to plug in its
 * domain-specific logic.
 *
 * This is what makes the codebase reusable across different businesses —
 * the agentic AI, browser automation, messaging, and billing stay the same;
 * only the domain knowledge, tools, prompts, and data models change.
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │              PLATFORM CORE (generic)                     │
 * │  agentFramework · toolRegistry · whatsappService         │
 * │  auth · billing · agentic-browser · reminders            │
 * ├──────────────────────────────────────────────────────────┤
 * │           VERTICAL PLUGIN (domain-specific)              │
 * │  property-mgmt · dental · legal · restaurant · ...       │
 * │  tools · prompts · roles · routes · knowledge base       │
 * └──────────────────────────────────────────────────────────┘
 */

import { Router } from "express";
import { ToolDefinition } from "./toolRegistry";
import { AgentRunResult } from "./agentFramework";

// ═══════════════════════════════════════════════════════════
//  VERTICAL PLUGIN INTERFACE
// ═══════════════════════════════════════════════════════════

export interface VerticalPlugin {
    /** Unique identifier for this vertical: "property-management", "dental-office", etc. */
    id: string;

    /** Display name: "Property Management", "Dental Practice", etc. */
    name: string;

    /** Version for compatibility checking */
    version: string;

    // ── Tools ────────────────────────────────────────────────

    /** Return domain-specific tools for the agent to use */
    registerTools(): ToolDefinition[];

    // ── Roles & Routing ─────────────────────────────────────

    /**
     * Resolve an inbound phone number to a role within this vertical.
     * e.g. "tenant", "patient", "client", "employee", "contractor"
     *
     * Returns null if the number is unknown — the platform handles fallback.
     */
    resolveRole(
        phone: string,
        accountId: string,
    ): Promise<ResolvedRole | null>;

    /** All possible roles this vertical defines */
    roleDefinitions: RoleDefinition[];

    // ── Message Handling ────────────────────────────────────

    /**
     * Handle an inbound message from a known contact.
     * This is where domain-specific business logic lives:
     * - Property mgmt: triage maintenance, draft RTA-compliant replies
     * - Dental: schedule appointments, handle insurance queries
     * - Legal: intake case details, route to correct lawyer
     */
    handleInboundMessage(ctx: InboundMessageContext): Promise<AgentRunResult>;

    /**
     * Handle a message FROM the business owner (account holder).
     * e.g. landlord approving a draft, dentist responding to a patient
     */
    handleOwnerMessage?(ctx: OwnerMessageContext): Promise<AgentRunResult | null>;

    // ── System Prompts ──────────────────────────────────────

    /**
     * Get the system prompt for a given use case.
     * Use cases are vertical-defined, e.g.:
     * - property-mgmt: "tenant-message", "utility-check", "landlord-assistant"
     * - dental: "patient-inquiry", "appointment-scheduling", "insurance-check"
     */
    getSystemPrompt(
        useCase: string,
        context: PromptContext,
    ): string;

    /** List all available use-case prompts */
    listUseCases(): UseCaseDefinition[];

    // ── Knowledge Base ──────────────────────────────────────

    /**
     * Domain-specific knowledge the LLM should know.
     * e.g. RTA profiles for property mgmt, dental procedure codes for dental
     *
     * Returns a text blob that gets appended to system prompts.
     */
    getKnowledge?(context: { region?: string; accountId?: string }): string;

    // ── Plan Limits ─────────────────────────────────────────

    /**
     * Define what plan limits mean for this vertical.
     * Generic resources like "messages" are handled by the platform.
     * Vertical-specific ones (e.g. "units", "patients", "cases") are defined here.
     */
    planLimits: VerticalPlanLimits;

    // ── Routes ──────────────────────────────────────────────

    /**
     * Express router with domain-specific API endpoints.
     * Mounted at /vertical/{plugin.id}/*
     * Auth middleware is applied by the platform before these routes.
     */
    getRouter(): Router;

    // ── Lifecycle ───────────────────────────────────────────

    /** Called once when the plugin is loaded */
    initialize?(): Promise<void>;

    /** Called on graceful shutdown */
    shutdown?(): Promise<void>;
}

// ═══════════════════════════════════════════════════════════
//  SUPPORTING TYPES
// ═══════════════════════════════════════════════════════════

export interface ResolvedRole {
    /** Role name as defined in roleDefinitions */
    role: string;
    /** ID of the person in the vertical's data model */
    personId: string;
    /** Display name */
    personName: string;
    /** Any extra data the vertical wants to pass through */
    metadata?: Record<string, unknown>;
}

export interface RoleDefinition {
    /** Internal role key: "tenant", "patient", "client" */
    role: string;
    /** Display name: "Tenant", "Patient", "Client" */
    label: string;
    /** Whether messages from this role trigger the AI agent */
    aiEnabled: boolean;
    /** Description shown in admin UI */
    description: string;
}

export interface InboundMessageContext {
    /** The resolved role info */
    sender: ResolvedRole;
    /** Account (business owner) this message belongs to */
    accountId: string;
    /** Account plan tier */
    plan: "FREE" | "PRO" | "ENTERPRISE";
    /** Raw message text */
    message: string;
    /** WhatsApp phone number */
    phone: string;
    /** Optional image description (from vision analysis) */
    imageDescription?: string;
    /** Optional image base64 */
    imageBase64?: string;
    /** Chat history context */
    chatHistory?: Array<{ role: string; content: string }>;
}

export interface OwnerMessageContext {
    /** Account (business owner) ID */
    accountId: string;
    /** Account plan tier */
    plan: "FREE" | "PRO" | "ENTERPRISE";
    /** Raw message text */
    message: string;
    /** Phone this was sent to (the contact they're replying to) */
    recipientPhone?: string;
    /** Who they're replying to (resolved role of recipient) */
    recipient?: ResolvedRole;
}

export interface PromptContext {
    accountId: string;
    plan: "FREE" | "PRO" | "ENTERPRISE";
    region?: string;
    /** Any extra context the platform provides */
    [key: string]: unknown;
}

export interface UseCaseDefinition {
    /** Unique key: "tenant-message", "appointment-booking" */
    id: string;
    /** Display name */
    label: string;
    /** Description */
    description: string;
    /** The role(s) this use case applies to */
    forRoles: string[];
}

export interface VerticalPlanLimits {
    /** Per-plan feature flags and numeric limits */
    FREE: Record<string, number | boolean>;
    PRO: Record<string, number | boolean>;
    ENTERPRISE: Record<string, number | boolean>;
}

// ═══════════════════════════════════════════════════════════
//  PLUGIN REGISTRY
// ═══════════════════════════════════════════════════════════

const plugins = new Map<string, VerticalPlugin>();

export function registerPlugin(plugin: VerticalPlugin): void {
    if (plugins.has(plugin.id)) {
        console.warn(`[PluginRegistry] Overwriting existing plugin: ${plugin.id}`);
    }
    plugins.set(plugin.id, plugin);
    console.log(`[PluginRegistry] Registered vertical: ${plugin.name} v${plugin.version}`);
}

export function getPlugin(id: string): VerticalPlugin | undefined {
    return plugins.get(id);
}

export function listPlugins(): VerticalPlugin[] {
    return [...plugins.values()];
}

export function getActivePlugin(): VerticalPlugin | undefined {
    // For now, return the first (and likely only) plugin.
    // In a multi-vertical deployment, this would be resolved per-account.
    return plugins.values().next().value || undefined;
}

/**
 * Initialize all registered plugins.
 * Called once during app startup.
 */
export async function initializePlugins(): Promise<void> {
    for (const plugin of plugins.values()) {
        if (plugin.initialize) {
            await plugin.initialize();
            console.log(`[PluginRegistry] Initialized: ${plugin.name}`);
        }
    }
}

/**
 * Shutdown all registered plugins.
 * Called during graceful app shutdown.
 */
export async function shutdownPlugins(): Promise<void> {
    for (const plugin of plugins.values()) {
        if (plugin.shutdown) {
            await plugin.shutdown();
        }
    }
}
