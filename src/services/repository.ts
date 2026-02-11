import { db } from "../config/database";
import { Prisma, Priority, MaintenanceStatus, UtilityType } from "@prisma/client";

const isDbEnabled = Boolean(process.env.DATABASE_URL);

type ChatEntry = {
  role: "tenant" | "ai" | "landlord";
  content: string;
  createdAt?: string;
  meta?: Record<string, unknown>;
};

type AutopilotEntry = {
  type: string;
  message: string;
  status?: string;
  meta?: Record<string, unknown>;
  createdAt: string;
};

type TriagePayload = Record<string, unknown>;
type AiDraftPayload = { draft?: string; [key: string]: unknown };
type UtilityCheckPayload = { anomalyFound?: boolean; notes?: string; [key: string]: unknown };

function normalizeChatLog(log: unknown): ChatEntry[] {
  if (!Array.isArray(log)) return [];
  return log
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const role = (entry as any).role;
      const content = (entry as any).content;
      if (!content || (role !== "tenant" && role !== "ai" && role !== "landlord")) return null;
      return {
        role,
        content,
        createdAt: typeof (entry as any).createdAt === "string" ? (entry as any).createdAt : new Date().toISOString(),
        meta: (entry as any).meta && typeof (entry as any).meta === "object" ? (entry as any).meta : undefined,
      } as ChatEntry;
    })
    .filter(Boolean) as ChatEntry[];
}

function normalizeAutopilotLog(log: unknown): AutopilotEntry[] {
  if (!Array.isArray(log)) return [];
  return log
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const type = (entry as any).type;
      const message = (entry as any).message;
      if (!type || !message) return null;
      return {
        type,
        message,
        status: typeof (entry as any).status === "string" ? (entry as any).status : undefined,
        meta: (entry as any).meta && typeof (entry as any).meta === "object" ? (entry as any).meta : undefined,
        createdAt: typeof (entry as any).createdAt === "string" ? (entry as any).createdAt : new Date().toISOString(),
      } as AutopilotEntry;
    })
    .filter(Boolean) as AutopilotEntry[];
}

function buildAutopilotEntry(params: { type: string; message: string; status?: string; meta?: Record<string, unknown> }): AutopilotEntry {
  return {
    type: params.type,
    message: params.message,
    status: params.status,
    meta: params.meta,
    createdAt: new Date().toISOString(),
  };
}

export async function createMaintenanceRequest(params: {
  tenantId?: string;
  unitId?: string;
  message: string;
  status?: MaintenanceStatus;
  priority?: Priority;
  category?: string;
  triage?: TriagePayload;
  aiDraft?: AiDraftPayload;
  autopilotEnabled?: boolean;
  utilityCheck?: UtilityCheckPayload;
  mcpTaskId?: string;
}) {
  if (!isDbEnabled) return null;
  try {
    const chatLog: ChatEntry[] = [
      {
        role: "tenant",
        content: params.message,
        createdAt: new Date().toISOString(),
      },
    ];
    return await db.maintenanceRequest.create({
      data: {
        tenantId: params.tenantId,
        unitId: params.unitId,
        message: params.message,
        status: params.status || MaintenanceStatus.OPEN,
        priority: params.priority || Priority.NORMAL,
        category: params.category,
        triageJson: params.triage as Prisma.InputJsonValue,
        aiDraft: params.aiDraft as Prisma.InputJsonValue,
        autopilotEnabled: Boolean(params.autopilotEnabled),
        autopilotStatus: params.autopilotEnabled ? "idle" : undefined,
        utilityAnomaly: Boolean(params.utilityCheck?.anomalyFound),
        utilityNotes: params.utilityCheck?.notes,
        chatLog: chatLog as Prisma.InputJsonValue,
        mcpTaskId: params.mcpTaskId,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("maintenance create failed", err);
    return null;
  }
}

export async function updateMaintenanceUtility(params: { maintenanceId: string; utilityCheck?: UtilityCheckPayload }) {
  if (!isDbEnabled || !params.maintenanceId) return null;
  try {
    return await db.maintenanceRequest.update({
      where: { id: params.maintenanceId },
      data: {
        utilityAnomaly: Boolean(params.utilityCheck?.anomalyFound),
        utilityNotes: params.utilityCheck?.notes,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("maintenance utility update failed", err);
    return null;
  }
}

export async function logUtilityBill(params: {
  maintenanceId?: string;
  unitId?: string;
  tenantId?: string;
  bill: {
    utilityType: UtilityType;
    amountCents: number;
    currency?: string;
    billingPeriodStart?: Date;
    billingPeriodEnd?: Date;
    statementUrl?: string;
    portalUsername?: string;
    anomalyFlag?: boolean;
    anomalyNotes?: string;
    rawData?: unknown;
  };
}) {
  if (!isDbEnabled) return null;
  try {
    return await db.utilityBill.create({
      data: {
        utilityType: params.bill.utilityType,
        amountCents: params.bill.amountCents,
        currency: params.bill.currency || "CAD",
        billingPeriodStart: params.bill.billingPeriodStart || new Date(),
        billingPeriodEnd: params.bill.billingPeriodEnd || new Date(),
        statementUrl: params.bill.statementUrl,
        portalUsername: params.bill.portalUsername,
        anomalyFlag: Boolean(params.bill.anomalyFlag),
        anomalyNotes: params.bill.anomalyNotes,
        rawData: params.bill.rawData as Prisma.InputJsonValue,
        maintenanceId: params.maintenanceId,
        unitId: params.unitId,
        tenantId: params.tenantId,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("log utility bill failed", err);
    return null;
  }
}

export async function listMaintenance(params: {
  limit?: number;
  status?: string | string[];
  unitId?: string;
  tenantId?: string;
}) {
  if (!isDbEnabled) return { items: [], dbEnabled: false };
  const limit = params.limit && params.limit > 0 ? params.limit : 100;
  const statusList = Array.isArray(params.status)
    ? params.status
    : typeof params.status === "string"
    ? params.status.split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const where: Prisma.MaintenanceRequestWhereInput = {};
  if (statusList?.length) where.status = { in: statusList as MaintenanceStatus[] };
  if (params.unitId) where.unitId = params.unitId;
  if (params.tenantId) where.tenantId = params.tenantId;
  try {
    const items = await db.maintenanceRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        tenant: true,
        unit: true,
      },
    });
    return { items, dbEnabled: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("list maintenance failed", err);
    return { items: [], dbEnabled: isDbEnabled };
  }
}

export async function getMaintenanceById(id?: string) {
  if (!isDbEnabled || !id) return null;
  try {
    return await db.maintenanceRequest.findUnique({ where: { id }, include: { utilityBills: true } });
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
    const record = await db.maintenanceRequest.findUnique({ where: { id: params.id } });
    if (!record) return null;
    const log = normalizeChatLog(record.chatLog);
    log.push({
      role: params.role,
      content: params.content,
      meta: params.meta,
      createdAt: new Date().toISOString(),
    });
    return await db.maintenanceRequest.update({
      where: { id: params.id },
      data: {
        chatLog: log as Prisma.InputJsonValue,
        landlordReply: params.setLandlordReply ?? record.landlordReply,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("append chat failed", err);
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
    console.warn("status update failed", err);
    return null;
  }
}

export async function updateMaintenanceAnalysis(params: {
  id: string;
  triage?: TriagePayload;
  aiDraft?: AiDraftPayload;
  priority?: Priority;
  category?: string;
}) {
  if (!isDbEnabled || !params.id) return null;
  try {
    return await db.maintenanceRequest.update({
      where: { id: params.id },
      data: {
        triageJson: params.triage as Prisma.InputJsonValue,
        aiDraft: params.aiDraft as Prisma.InputJsonValue,
        priority: params.priority,
        category: params.category,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("analysis update failed", err);
    return null;
  }
}

export async function listUtilityBills(params: { unitId?: string; tenantId?: string; limit?: number }) {
  if (!isDbEnabled) return [];
  const where: Prisma.UtilityBillWhereInput = {};
  if (params.unitId) where.unitId = params.unitId;
  if (params.tenantId) where.tenantId = params.tenantId;
  const limit = params.limit && params.limit > 0 ? params.limit : 100;
  try {
    return await db.utilityBill.findMany({ where, orderBy: { createdAt: "desc" }, take: limit });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("list utility bills failed", err);
    return [];
  }
}

export async function createUtilityCredential(params: {
  unitId: string;
  utilityType: UtilityType;
  username?: string;
  password?: string;
  notes?: string;
}) {
  if (!isDbEnabled) return null;
  try {
    return await db.utilityCredential.create({ data: { ...params } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("create utility credential failed", err);
    return null;
  }
}

export async function listUtilityCredentials(params?: { unitId?: string; utilityType?: string }) {
  if (!isDbEnabled) return [];
  const where: Prisma.UtilityCredentialWhereInput = {};
  if (params?.unitId) where.unitId = params.unitId;
  if (params?.utilityType) where.utilityType = params.utilityType as UtilityType;
  try {
    return await db.utilityCredential.findMany({ where, orderBy: { createdAt: "desc" } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("list utility credentials failed", err);
    return [];
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
  unitId?: string;
  autoReplyEnabled?: boolean;
}) {
  if (!isDbEnabled) return null;
  try {
    const record = await db.tenant.create({
      data: {
        id: params.id,
        name: params.name,
        phone: params.phone,
        email: params.email,
        autoReplyEnabled: typeof params.autoReplyEnabled === "boolean" ? params.autoReplyEnabled : undefined,
      },
    });
    if (params.unitId) {
      await db.unitTenant.create({ data: { unitId: params.unitId, tenantId: record.id } });
    }
    return record;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("tenant create skipped", err);
    return null;
  }
}

export async function updateTenantContact(params: { id: string; phone?: string; email?: string }) {
  if (!isDbEnabled || !params.id) return null;
  const data: Record<string, unknown> = {};
  if (typeof params.phone === "string") data.phone = params.phone;
  if (typeof params.email === "string") data.email = params.email;
  if (!Object.keys(data).length) return null;
  try {
    return await db.tenant.update({ where: { id: params.id }, data });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("tenant update skipped", err);
    return null;
  }
}

export async function createUnit(params: { id?: string; label: string; address: string }) {
  if (!isDbEnabled) return null;
  try {
    return await db.unit.create({
      data: {
        id: params.id,
        label: params.label,
        address: params.address,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("unit create skipped", err);
    return null;
  }
}

export async function listTenants() {
  if (!isDbEnabled) return [];
  try {
    return await db.tenant.findMany({ orderBy: { createdAt: "desc" }, include: { units: true } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("list tenants failed", err);
    return [];
  }
}

export async function updateTenant(params: {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  unitId?: string | null;
  autoReplyEnabled?: boolean;
}) {
  if (!isDbEnabled || !params.id) return null;
  const data: Record<string, unknown> = {};
  if (typeof params.name === "string") data.name = params.name;
  if (typeof params.phone === "string") data.phone = params.phone;
  if (typeof params.email === "string") data.email = params.email;
  if (typeof (params as { autoReplyEnabled?: boolean }).autoReplyEnabled === "boolean") {
    data.autoReplyEnabled = (params as { autoReplyEnabled: boolean }).autoReplyEnabled;
  }
  try {
    const updated = await db.tenant.update({ where: { id: params.id }, data });
    if (params.unitId !== undefined) {
      await db.unitTenant.deleteMany({ where: { tenantId: params.id } });
      if (params.unitId) {
        await db.unitTenant.create({ data: { tenantId: params.id, unitId: params.unitId } });
      }
    }
    return updated;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("tenant update skipped", err);
    return null;
  }
}

export async function getGlobalAutoReplyEnabled() {
  if (!isDbEnabled) return { enabled: true, source: "default" as const };
  try {
    const record = await db.appSetting.findUnique({ where: { key: "global_auto_reply_enabled" } });
    if (!record) return { enabled: true, source: "default" as const };
    return { enabled: record.value !== "false", source: "db" as const };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("get global auto-reply failed", err);
    return { enabled: true, source: "default" as const };
  }
}

export async function setGlobalAutoReplyEnabled(params: { enabled: boolean }) {
  if (!isDbEnabled) return null;
  try {
    return await db.appSetting.upsert({
      where: { key: "global_auto_reply_enabled" },
      create: { key: "global_auto_reply_enabled", value: params.enabled ? "true" : "false" },
      update: { value: params.enabled ? "true" : "false" },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("set global auto-reply failed", err);
    return null;
  }
}

export async function getGlobalAutoReplyDelayMinutes() {
  if (!isDbEnabled) return { minutes: 5, source: "default" as const };
  try {
    const record = await db.appSetting.findUnique({ where: { key: "global_auto_reply_delay_minutes" } });
    if (!record) return { minutes: 5, source: "default" as const };
    const parsed = Number(record.value);
    if (Number.isNaN(parsed) || parsed < 0) return { minutes: 5, source: "default" as const };
    return { minutes: parsed, source: "db" as const };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("get global auto-reply delay failed", err);
    return { minutes: 5, source: "default" as const };
  }
}

export async function setGlobalAutoReplyDelayMinutes(params: { minutes: number }) {
  if (!isDbEnabled) return null;
  try {
    return await db.appSetting.upsert({
      where: { key: "global_auto_reply_delay_minutes" },
      create: { key: "global_auto_reply_delay_minutes", value: String(params.minutes) },
      update: { value: String(params.minutes) },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("set global auto-reply delay failed", err);
    return null;
  }
}

export async function getGlobalAutoReplyCooldownMinutes() {
  if (!isDbEnabled) return { minutes: 60, source: "default" as const };
  try {
    const record = await db.appSetting.findUnique({ where: { key: "global_auto_reply_cooldown_minutes" } });
    if (!record) return { minutes: 60, source: "default" as const };
    const parsed = Number(record.value);
    if (Number.isNaN(parsed) || parsed < 0) return { minutes: 60, source: "default" as const };
    return { minutes: parsed, source: "db" as const };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("get global auto-reply cooldown failed", err);
    return { minutes: 60, source: "default" as const };
  }
}

export async function setGlobalAutoReplyCooldownMinutes(params: { minutes: number }) {
  if (!isDbEnabled) return null;
  try {
    return await db.appSetting.upsert({
      where: { key: "global_auto_reply_cooldown_minutes" },
      create: { key: "global_auto_reply_cooldown_minutes", value: String(params.minutes) },
      update: { value: String(params.minutes) },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("set global auto-reply cooldown failed", err);
    return null;
  }
}

export async function deleteTenant(params: { id: string; hard?: boolean }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    await db.unitTenant.deleteMany({ where: { tenantId: params.id } });
    return await db.tenant.delete({ where: { id: params.id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("tenant delete skipped", err);
    return null;
  }
}

export async function createContractor(params: { id?: string; name: string; phone: string; email?: string; role?: string }) {
  if (!isDbEnabled) return null;
  try {
    return await db.contractor.create({
      data: {
        id: params.id,
        name: params.name,
        phone: params.phone,
        email: params.email,
        role: params.role,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("create contractor failed", err);
    return null;
  }
}

export async function updateContractor(params: { id: string; name?: string; phone?: string; email?: string; role?: string }) {
  if (!isDbEnabled || !params.id) return null;
  const data: Record<string, unknown> = {};
  if (typeof params.name === "string") data.name = params.name;
  if (typeof params.phone === "string") data.phone = params.phone;
  if (typeof params.email === "string") data.email = params.email;
  if (typeof params.role === "string") data.role = params.role;
  try {
    return await db.contractor.update({ where: { id: params.id }, data });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("contractor update failed", err);
    return null;
  }
}

export async function deleteContractor(params: { id: string; hard?: boolean }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    return await db.contractor.delete({ where: { id: params.id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("contractor delete failed", err);
    return null;
  }
}

export async function listContractors() {
  if (!isDbEnabled) return [];
  try {
    return await db.contractor.findMany({ orderBy: { createdAt: "desc" } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("list contractors failed", err);
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

export async function updateUnit(params: { id: string; label?: string; address?: string }) {
  if (!isDbEnabled || !params.id) return null;
  const data: Record<string, unknown> = {};
  if (typeof params.label === "string") data.label = params.label;
  if (typeof params.address === "string") data.address = params.address;
  try {
    return await db.unit.update({ where: { id: params.id }, data });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("unit update skipped", err);
    return null;
  }
}

export async function deleteUnit(params: { id: string; hard?: boolean }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    await db.unitTenant.deleteMany({ where: { unitId: params.id } });
    await db.utilityBill.updateMany({ where: { unitId: params.id }, data: { unitId: null } });
    await db.utilityCredential.deleteMany({ where: { unitId: params.id } });
    await db.maintenanceRequest.updateMany({ where: { unitId: params.id }, data: { unitId: null } });
    return await db.unit.delete({ where: { id: params.id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("unit delete skipped", err);
    return null;
  }
}

export async function getTenantById(id?: string) {
  if (!isDbEnabled || !id) return null;
  try {
    return await db.tenant.findUnique({ where: { id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("get tenant failed", err);
    return null;
  }
}

export async function getUnitById(id?: string) {
  if (!isDbEnabled || !id) return null;
  try {
    return await db.unit.findUnique({ where: { id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("get unit failed", err);
    return null;
  }
}

export async function findTenantByEmail(email?: string) {
  if (!isDbEnabled || !email) return null;
  const trimmed = email.trim();
  if (!trimmed) return null;
  try {
    return await db.tenant.findFirst({ where: { email: trimmed } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("find tenant by email failed", err);
    return null;
  }
}

export async function findTenantByPhone(phone?: string) {
  if (!isDbEnabled || !phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\D/g, "");
  const withPlus = normalized ? `+${normalized}` : "";
  const candidates = Array.from(new Set([trimmed, normalized, withPlus].filter(Boolean)));
  try {
    return await db.tenant.findFirst({
      where: {
        OR: candidates.map((value) => ({ phone: value })),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("find tenant by phone failed", err);
    return null;
  }
}

export async function findContractorByPhone(phone?: string) {
  if (!isDbEnabled || !phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace(/\D/g, "");
  const withPlus = normalized ? `+${normalized}` : "";
  const candidates = Array.from(new Set([trimmed, normalized, withPlus].filter(Boolean)));
  try {
    return await db.contractor.findFirst({
      where: {
        OR: candidates.map((value) => ({ phone: value })),
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("find contractor by phone failed", err);
    return null;
  }
}

export async function findLatestMaintenanceForTenantId(tenantId?: string) {
  if (!isDbEnabled || !tenantId) return null;
  try {
    return await db.maintenanceRequest.findFirst({
      where: {
        tenantId,
        status: { in: [MaintenanceStatus.OPEN, MaintenanceStatus.IN_PROGRESS] },
      },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("find latest maintenance failed", err);
    return null;
  }
}

export async function findLatestOpenMaintenance() {
  if (!isDbEnabled) return null;
  try {
    return await db.maintenanceRequest.findFirst({
      where: { status: { in: [MaintenanceStatus.OPEN, MaintenanceStatus.IN_PROGRESS] } },
      orderBy: { createdAt: "desc" },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("find latest open maintenance failed", err);
    return null;
  }
}

export async function updateUtilityCredential(params: { id: string; username?: string; password?: string; notes?: string }) {
  if (!isDbEnabled || !params.id) return null;
  const data: Record<string, unknown> = {};
  if (typeof params.username === "string") data.username = params.username;
  if (typeof params.password === "string") data.password = params.password;
  if (typeof params.notes === "string") data.notes = params.notes;
  try {
    return await db.utilityCredential.update({ where: { id: params.id }, data });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("update utility credential failed", err);
    return null;
  }
}

export async function deleteUtilityCredential(params: { id: string }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    return await db.utilityCredential.delete({ where: { id: params.id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("delete utility credential failed", err);
    return null;
  }
}

export async function createUtilityBill(params: {
  unitId?: string;
  tenantId?: string;
  maintenanceId?: string;
  utilityType: UtilityType;
  amountCents: number;
  currency?: string;
  billingPeriodStart?: Date;
  billingPeriodEnd?: Date;
  statementUrl?: string;
  portalUsername?: string;
  anomalyFlag?: boolean;
  anomalyNotes?: string;
  rawData?: unknown;
}) {
  if (!isDbEnabled) return null;
  try {
    return await db.utilityBill.create({
      data: {
        utilityType: params.utilityType,
        amountCents: params.amountCents,
        currency: params.currency || "CAD",
        billingPeriodStart: params.billingPeriodStart || new Date(),
        billingPeriodEnd: params.billingPeriodEnd || new Date(),
        statementUrl: params.statementUrl,
        portalUsername: params.portalUsername,
        anomalyFlag: Boolean(params.anomalyFlag),
        anomalyNotes: params.anomalyNotes,
        rawData: params.rawData as Prisma.InputJsonValue,
        unitId: params.unitId,
        tenantId: params.tenantId,
        maintenanceId: params.maintenanceId,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("create utility bill failed", err);
    return null;
  }
}

export async function updateUtilityBill(params: {
  id: string;
  amountCents?: number;
  currency?: string;
  billingPeriodStart?: Date;
  billingPeriodEnd?: Date;
  statementUrl?: string;
  anomalyFlag?: boolean;
  anomalyNotes?: string;
}) {
  if (!isDbEnabled || !params.id) return null;
  const data: Record<string, unknown> = {};
  if (typeof params.amountCents === "number") data.amountCents = params.amountCents;
  if (typeof params.currency === "string") data.currency = params.currency;
  if (params.billingPeriodStart) data.billingPeriodStart = params.billingPeriodStart;
  if (params.billingPeriodEnd) data.billingPeriodEnd = params.billingPeriodEnd;
  if (typeof params.statementUrl === "string") data.statementUrl = params.statementUrl;
  if (typeof params.anomalyFlag === "boolean") data.anomalyFlag = params.anomalyFlag;
  if (typeof params.anomalyNotes === "string") data.anomalyNotes = params.anomalyNotes;
  try {
    return await db.utilityBill.update({ where: { id: params.id }, data });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("update utility bill failed", err);
    return null;
  }
}

export async function deleteUtilityBill(params: { id: string }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    return await db.utilityBill.delete({ where: { id: params.id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("delete utility bill failed", err);
    return null;
  }
}

export async function deleteMaintenance(params: { id: string }) {
  if (!isDbEnabled || !params.id) return null;
  try {
    return await db.maintenanceRequest.delete({ where: { id: params.id } });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("maintenance delete failed", err);
    return null;
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
  updateTenantContact,
  updateTenant,
  deleteTenant,
  createContractor,
  updateContractor,
  deleteContractor,
  listContractors,
  createUnit,
  updateUnit,
  deleteUnit,
  getTenantById,
  getUnitById,
  findTenantByPhone,
  findTenantByEmail,
  findContractorByPhone,
  findLatestMaintenanceForTenantId,
  findLatestOpenMaintenance,
  listTenants,
  listUnits,
  listUtilityBills,
  createUtilityBill,
  updateUtilityBill,
  deleteUtilityBill,
  createUtilityCredential,
  listUtilityCredentials,
  updateUtilityCredential,
  deleteUtilityCredential,
  deleteMaintenance,
  getGlobalAutoReplyEnabled,
  setGlobalAutoReplyEnabled,
  getGlobalAutoReplyDelayMinutes,
  setGlobalAutoReplyDelayMinutes,
  getGlobalAutoReplyCooldownMinutes,
  setGlobalAutoReplyCooldownMinutes,
};
