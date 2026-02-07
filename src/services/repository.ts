import { db } from "../config/database";
import { Prisma, Priority, MaintenanceStatus } from "@prisma/client";

const isDbEnabled = Boolean(process.env.DATABASE_URL);

type ChatEntry = {
  role: "tenant" | "ai" | "landlord";
  content: string;
  createdAt: string;
  meta?: Record<string, unknown>;
};

type AiDraftPayload = {
  draft?: string;
  skillLoaded?: boolean;
  generatedAt?: string;
  source?: string;
  instructions?: string;
  baseDraftExcerpt?: string;
  notes?: string;
};

type AutopilotLogEntry = {
  id: string;
  type: "system" | "config" | "auto_reply" | "skip" | "error";
  message: string;
  status?: string;
  createdAt: string;
  meta?: Record<string, unknown>;
};

type AutopilotEntryInput = Omit<AutopilotLogEntry, "id" | "createdAt">;

function normalizeAutopilotLog(raw: unknown): AutopilotLogEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry) => Boolean(entry)).map((entry) => entry as AutopilotLogEntry);
}

function buildAutopilotEntry(input: AutopilotEntryInput): AutopilotLogEntry {
  return {
    id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    ...input,
  };
}

function severityToPriority(severity?: string): Priority {
  const map: Record<string, Priority> = {
    critical: Priority.CRITICAL,
    high: Priority.HIGH,
    normal: Priority.NORMAL,
    low: Priority.LOW,
  };
  return (severity && map[severity.toLowerCase()]) || Priority.NORMAL;
}

export async function createMaintenanceRequest(params: {
  tenantId?: string;
  unitId?: string;
  message: string;
  triage?: {
    classification?: { severity?: string; category?: string };
    summary?: string;
    rawModelText?: string;
  };
  aiDraft?: AiDraftPayload | null;
}) {
  if (!isDbEnabled) return null;
  try {
    const priority = severityToPriority(params.triage?.classification?.severity);
    const chatLog: ChatEntry[] = [
      {
        role: "tenant",
        content: params.message,
        createdAt: new Date().toISOString(),
      },
    ];
    const autopilotLog = [
      buildAutopilotEntry({
        type: "system",
        message: "Request created",
        status: "manual_review",
      }),
    ];

    const data = {
      tenantId: params.tenantId ?? null,
      unitId: params.unitId ?? null,
      message: params.message,
      statusChangedAt: new Date(),
      priority,
      category: params.triage?.classification?.category,
      triageJson: params.triage ? params.triage : undefined,
      aiDraft: (params.aiDraft as Prisma.InputJsonValue) ?? undefined,
      autopilotStatus: "manual_review",
      autopilotLog: autopilotLog as Prisma.InputJsonValue,
      chatLog: chatLog as Prisma.InputJsonValue,
    };

    try {
      return await db.maintenanceRequest.create({ data });
    } catch (err) {
      // If tenant/unit IDs don’t exist, retry without them so flow continues during testing.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        const fallback = { ...data, tenantId: null, unitId: null };
        return await db.maintenanceRequest.create({ data: fallback });
      }
      throw err;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("maintenance create skipped", err);
    return null;
  }
}

export async function updateMaintenanceUtility(params: {
  maintenanceId?: string;
  utilityCheck?: {
    anomalyFound?: boolean;
    notes?: string;
    mcpResponse?: unknown;
  };
}) {
  if (!isDbEnabled || !params.maintenanceId) return null;
  try {
    const record = await db.maintenanceRequest.update({
      where: { id: params.maintenanceId },
      data: {
        utilityAnomaly: Boolean(params.utilityCheck?.anomalyFound),
        utilityNotes: params.utilityCheck?.notes,
      },
    });
    return record;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("maintenance utility update skipped", err);
    return null;
  }
}

export async function logUtilityBill(params: {
  maintenanceId?: string;
  tenantId?: string;
  unitId?: string;
  utilityType: string;
  amountCents?: number;
  currency?: string;
  anomalyFlag?: boolean;
  anomalyNotes?: string;
  statementUrl?: string;
  portalUsername?: string;
  rawData?: unknown;
}) {
  if (!isDbEnabled) return null;
  try {
    const record = await db.utilityBill.create({
      data: {
        utilityType: params.utilityType as any,
        amountCents: params.amountCents ?? 0,
        currency: params.currency || "CAD",
        anomalyFlag: Boolean(params.anomalyFlag),
        anomalyNotes: params.anomalyNotes,
        statementUrl: params.statementUrl,
        portalUsername: params.portalUsername,
        rawData: params.rawData as any,
        maintenanceId: params.maintenanceId,
        tenantId: params.tenantId,
        unitId: params.unitId,
        billingPeriodStart: new Date(),
        billingPeriodEnd: new Date(),
      },
    });
    return record;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("utility bill log skipped", err);
    return null;
  }
}

export async function updateMaintenanceStatus(params: { id: string; status: MaintenanceStatus }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    return await db.maintenanceRequest.update({
      where: { id: params.id },
      data: { status: params.status, statusChangedAt: new Date() },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("maintenance status update skipped", err);
    return null;
  }
}

export async function updateMaintenanceAnalysis(params: {
  id: string;
  triage?: Record<string, unknown> | null;
  aiDraft?: AiDraftPayload | null;
}) {
  if (!isDbEnabled || !params.id) return null;
  try {
    return await db.maintenanceRequest.update({
      where: { id: params.id },
      data: {
        triageJson: params.triage ? (params.triage as Prisma.InputJsonValue) : undefined,
        aiDraft: params.aiDraft ? (params.aiDraft as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("maintenance analysis update skipped", err);
    return null;
  }
}

export async function listMaintenance(limit = 50) {
  if (!isDbEnabled) {
    return { dbEnabled: false, items: [] };
  }
  try {
    const items = await db.maintenanceRequest.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return { dbEnabled: true, items };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("list maintenance failed", err);
    return { dbEnabled: true, items: [] };
  }
}

export async function getMaintenanceById(id: string) {
  if (!isDbEnabled || !id) return null;
  try {
    return await db.maintenanceRequest.findUnique({ where: { id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("get maintenance failed", err);
    return null;
  }
}

export async function appendChatMessage(params: {
  id: string;
  role: ChatEntry["role"];
  content: string;
  meta?: Record<string, unknown>;
  setLandlordReply?: string;
}) {
  if (!isDbEnabled || !params.id) return null;
  try {
    const current = await db.maintenanceRequest.findUnique({ where: { id: params.id } });
    if (!current) return null;
    const existingLog = Array.isArray(current.chatLog)
      ? (current.chatLog as unknown as ChatEntry[])
      : [];

    const entry: ChatEntry = {
      role: params.role,
      content: params.content,
      meta: params.meta,
      createdAt: new Date().toISOString(),
    };

    const chatLog = [...existingLog, entry];

    return await db.maintenanceRequest.update({
      where: { id: params.id },
      data: {
        chatLog: chatLog as Prisma.InputJsonValue,
        landlordReply: params.setLandlordReply ?? current.landlordReply,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("append chat failed", err);
    return null;
  }
}

export async function updateAiDraft(params: { id: string; aiDraft: AiDraftPayload }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    return await db.maintenanceRequest.update({
      where: { id: params.id },
      data: { aiDraft: params.aiDraft as Prisma.InputJsonValue },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("update ai draft failed", err);
    return null;
  }
}

export async function setAutopilotEnabled(params: { id: string; enabled: boolean; note?: string }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    const current = await db.maintenanceRequest.findUnique({ where: { id: params.id } });
    if (!current) return null;
    const log = normalizeAutopilotLog(current.autopilotLog);
    const entry = buildAutopilotEntry({
      type: "config",
      message: params.note || (params.enabled ? "Autopilot enabled" : "Autopilot disabled"),
      status: params.enabled ? "enabled" : "disabled",
      meta: { enabled: params.enabled },
    });
    return await db.maintenanceRequest.update({
      where: { id: params.id },
      data: {
        autopilotEnabled: params.enabled,
        autopilotStatus: params.enabled ? "idle" : "disabled",
        autopilotLog: [...log, entry] as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("autopilot toggle failed", err);
    return null;
  }
}

export async function logAutopilotEvent(params: {
  id: string;
  type: "system" | "auto_reply" | "skip" | "error";
  message: string;
  status?: string;
  meta?: Record<string, unknown>;
}) {
  if (!isDbEnabled || !params.id) return null;
  try {
    const current = await db.maintenanceRequest.findUnique({ where: { id: params.id } });
    if (!current) return null;
    const log = normalizeAutopilotLog(current.autopilotLog);
    const entry = buildAutopilotEntry({
      type: params.type,
      message: params.message,
      status: params.status,
      meta: params.meta,
    });
    return await db.maintenanceRequest.update({
      where: { id: params.id },
      data: {
        autopilotStatus: params.status ?? current.autopilotStatus,
        autopilotLog: [...log, entry] as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("autopilot log failed", err);
    return null;
  }
}

export async function createTenant(params: {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
}) {
  if (!isDbEnabled) return null;
  try {
    const record = await db.tenant.create({
      data: {
        id: params.id,
        name: params.name,
        phone: params.phone,
        email: params.email,
      },
    });
    return record;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("tenant create skipped", err);
    return null;
  }
}

export async function createUnit(params: {
  id?: string;
  label: string;
  address: string;
}) {
  if (!isDbEnabled) return null;
  try {
    const record = await db.unit.create({
      data: {
        id: params.id,
        label: params.label,
        address: params.address,
      },
    });
    return record;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("unit create skipped", err);
    return null;
  }
}

export async function listTenants() {
  if (!isDbEnabled) return [];
  try {
    return await db.tenant.findMany({ orderBy: { createdAt: "desc" } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("list tenants failed", err);
    return [];
  }
}

export async function listUnits() {
  if (!isDbEnabled) return [];
  try {
    return await db.unit.findMany({ orderBy: { createdAt: "desc" } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("list units failed", err);
    return [];
  }
}

export default {
  createMaintenanceRequest,
  updateMaintenanceUtility,
  logUtilityBill,
  listMaintenance,
  getMaintenanceById,
  appendChatMessage,
  updateMaintenanceStatus,
  updateMaintenanceAnalysis,
  updateAiDraft,
  setAutopilotEnabled,
  logAutopilotEvent,
  createTenant,
  createUnit,
  listTenants,
  listUnits,
};
