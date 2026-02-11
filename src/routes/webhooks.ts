import express from "express";
import twilio from "twilio";
import maintenanceRouter from "./maintenance";
import agentService from "../services/agentService";
import repo from "../services/repository";
import whatsappService from "../services/whatsappService";
import { setWebhookStatus } from "../services/webhookStatus";

const router = express.Router();

// Twilio signature verification middleware.
router.use("/twilio", express.urlencoded({ extended: false }));
router.use("/twilio", (req, res, next) => {
  const authToken = process.env.TWILIO_AUTH_TOKEN || "";
  const signature = req.get("X-Twilio-Signature") || "";
  const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;

  const valid = authToken
    ? twilio.validateRequest(authToken, signature, url, req.body)
    : false;

  if (!authToken) {
    return res.status(500).json({ error: "twilio_auth_token_missing" });
  }

  if (!valid) {
    return res.status(403).json({ error: "invalid_signature" });
  }

  return next();
    const APPROVAL_REQUIRED_SEVERITIES = new Set(["high", "critical"]);
});

// Handle inbound SMS webhook and route into maintenance flow.
router.post("/twilio", async (req, res, next) => {
  try {
    const tenantMessage = req.body?.Body || "";
    const tenantPhone = req.body?.From || "";

    if (!tenantMessage) {
      return res.status(400).json({ error: "missing_message_body" });
    }

    // Reuse maintenance route handler logic by delegating internally.
    req.body = {
      tenantMessage,
      tenantId: tenantPhone, // placeholder mapping until DB mapping exists
      unitId: undefined,
    };

    // Forward to maintenance router
    return (maintenanceRouter as unknown as express.RequestHandler)(req, res, next);
  } catch (err) {
    return next(err);
  }
});

const SAFE_AUTOPILOT_SEVERITIES = new Set(["low", "normal"]);
const CRITICAL_KEYWORDS = ["fire", "water leak", "gas leak", "gas", "no power", "no heat", "flood", "smoke"];
const DEFAULT_REPLY_DELAY_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between replies per tenant
const pendingTenantReplies = new Map<
  string,
  {
    messages: { content: string; at: number; media: boolean }[];
    timer: NodeJS.Timeout;
    replyTo: string;
    isGroup: boolean;
  }
>();
const lastReplySentAt = new Map<string, number>();

function normalizePhone(raw?: string) {
  if (!raw) return "";
  return raw.replace(/\D/g, "");
}

function landlordNumbers() {
  const raw = process.env.LANDLORD_WHATSAPP_NUMBERS || "";
  return raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function isLandlordNumber(phone: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return false;
  return landlordNumbers().some((num) => normalizePhone(num) === normalized);
}

function extractWhatsAppText(payload: any): string {
  const data = payload?.data || payload;
  return (
    data?.message?.conversation ||
    data?.message?.extendedTextMessage?.text ||
    data?.message?.text ||
    data?.message?.imageMessage?.caption ||
    data?.message?.videoMessage?.caption ||
    data?.text ||
    data?.message ||
    ""
  );
}

function extractWhatsAppMediaDescription(payload: any): string {
  const data = payload?.data || payload;
  const caption =
    data?.message?.imageMessage?.caption ||
    data?.message?.videoMessage?.caption ||
    data?.message?.documentMessage?.caption ||
    "";
  if (data?.message?.imageMessage) return `[image received] ${caption}`.trim();
  if (data?.message?.videoMessage) return `[video received] ${caption}`.trim();
  if (data?.message?.audioMessage || data?.message?.ptt) return `[voice note received]`.trim();
  if (data?.message?.documentMessage) return `[document received] ${caption}`.trim();
  return "";
}

function extractWhatsAppSenderInfo(payload: any) {
  const data = payload?.data || payload;
  const remoteJid = data?.key?.remoteJid || data?.from || data?.sender || data?.remoteJid || "";
  const participant = data?.key?.participant || data?.participant || "";
  const isGroup = typeof remoteJid === "string" && remoteJid.endsWith("@g.us");
  const sender = isGroup
    ? whatsappService.normalizeWhatsAppNumber(participant)
    : whatsappService.normalizeWhatsAppNumber(remoteJid);
  const replyTo = whatsappService.normalizeWhatsAppNumber(remoteJid || sender);
  return { remoteJid, participant, isGroup, sender, replyTo };
}

function containsCriticalKeyword(text: string) {
  const normalized = text.toLowerCase();
  return CRITICAL_KEYWORDS.some((kw) => normalized.includes(kw));
}

function isFromMe(payload: any): boolean {
  const data = payload?.data || payload;
  return Boolean(data?.key?.fromMe || data?.fromMe);
}

async function maybeRunAutopilot(record: any, triage: any, aiDraft: any, reason = "tenant_message") {
  if (!record?.id || !record.autopilotEnabled) return false;
  const severity = (triage?.classification?.severity || record?.triageJson?.classification?.severity || "unknown")
    .toString()
    .toLowerCase();
  await repo.logAutopilotEvent({
    id: record.id,
    type: "system",
    message: "Autopilot evaluating latest activity",
    status: "evaluating",
    meta: { severity, reason },
  });
  if (!SAFE_AUTOPILOT_SEVERITIES.has(severity)) {
    await repo.logAutopilotEvent({
      id: record.id,
      type: "skip",
      message: `Autopilot blocked at severity ${severity}`,
      status: "blocked_severity",
      meta: { severity, reason },
    });
    return false;
  }
  const chatLog = Array.isArray(record.chatLog) ? record.chatLog : [];
  const lastEntry = chatLog[chatLog.length - 1];
  if (lastEntry?.role !== "tenant") {
    await repo.logAutopilotEvent({
      id: record.id,
      type: "skip",
      message: "Autopilot idle (no tenant awaiting reply)",
      status: "idle",
      meta: { severity, reason },
    });
    return false;
  }
  const text = (aiDraft?.draft || record?.aiDraft?.draft || "").trim();
  if (!text) {
    await repo.logAutopilotEvent({
      id: record.id,
      type: "skip",
      message: "Autopilot waiting for draft content",
      status: "awaiting_draft",
      meta: { severity, reason },
    });
    return false;
  }
  await repo.appendChatMessage({
    id: record.id,
    role: "ai",
    content: text,
    meta: { autopilot: true, severity, reason },
    setLandlordReply: text,
  });
  await repo.logAutopilotEvent({
    id: record.id,
    type: "auto_reply",
    message: "Autopilot sent reply using latest draft",
    status: "auto_replied",
    meta: { severity, reason, length: text.length },
  });
  return true;
}

async function computeDelayMs(tenantId: string, severity: string, text: string) {
  const now = Date.now();
  if (severity === "high" || severity === "critical" || containsCriticalKeyword(text)) return 0;
  const last = lastReplySentAt.get(tenantId) || 0;
  const cooldownSetting = await repo.getGlobalAutoReplyCooldownMinutes();
  const cooldownMs = Math.max(0, Math.round(cooldownSetting.minutes * 60 * 1000)) || DEFAULT_COOLDOWN_MS;
  const cooldownTarget = last + cooldownMs;
  const delaySetting = await repo.getGlobalAutoReplyDelayMinutes();
  const delayMs = Math.max(0, Math.round(delaySetting.minutes * 60 * 1000)) || DEFAULT_REPLY_DELAY_MS;
  const baseTarget = now + delayMs;
  return Math.max(baseTarget, cooldownTarget) - now;
}

function queueTenantReply(params: {
  tenantId: string;
  replyTo: string;
  isGroup: boolean;
  tenantMessage: string;
  media: boolean;
  delayMs: number;
}) {
  const bucket = pendingTenantReplies.get(params.tenantId);
  const messages = bucket?.messages || [];
  const updatedMessages = [...messages, { content: params.tenantMessage, at: Date.now(), media: params.media }];

  if (bucket?.timer) {
    clearTimeout(bucket.timer);
  }

  const timer = setTimeout(() => {
    flushTenantReply({ tenantId: params.tenantId }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("flush tenant reply failed", err);
    });
  }, params.delayMs);

  pendingTenantReplies.set(params.tenantId, {
    messages: updatedMessages,
    timer,
    replyTo: params.replyTo,
    isGroup: params.isGroup,
  });
}

async function flushTenantReply(params: { tenantId: string }) {
  const bucket = pendingTenantReplies.get(params.tenantId);
  if (!bucket) return null;
  clearTimeout(bucket.timer);
  pendingTenantReplies.delete(params.tenantId);

  const tenant = await repo.getTenantById(params.tenantId);
  if (!tenant) return null;
  const globalAutoReply = await repo.getGlobalAutoReplyEnabled();
  const canAutoReply = globalAutoReply.enabled && tenant.autoReplyEnabled !== false;

  const existing = await repo.findLatestMaintenanceForTenantId(tenant.id);
  const conversationLog = Array.isArray(existing?.chatLog) ? (existing?.chatLog as any[]) : [];
  const combinedMessage = bucket.messages.map((m) => m.content).join("\n---\n").trim();

  const triage = await agentService.triageMaintenance({
    tenantMessage: combinedMessage,
    tenantId: tenant.id,
    unitId: undefined,
  });
  const utilityCheck = await agentService.checkUtilityAnomaly({ tenantId: tenant.id, unitId: undefined });
  const draftResponse = await agentService.draftRtaResponse({
    tenantMessage: combinedMessage,
    triage,
    utilityCheck,
    conversationLog: [...conversationLog, { role: "tenant", content: combinedMessage, createdAt: new Date().toISOString() }],
    landlordReply: existing?.landlordReply,
  });
  // eslint-disable-next-line no-console
  console.info("llm invoked (tenant batch)", {
    tenantId: tenant.id,
    draftAvailable: Boolean((draftResponse?.draft || "").trim()),
    rawModelText: Boolean((triage as any)?.rawModelText || (draftResponse as any)?.notes),
  });

  let record = existing;
  if (record?.id) {
    await repo.updateMaintenanceAnalysis({ id: record.id, triage, aiDraft: draftResponse });
    await repo.updateMaintenanceUtility({ maintenanceId: record.id, utilityCheck });
    await repo.appendChatMessage({
      id: record.id,
      role: "tenant",
      content: combinedMessage,
      meta: { channel: bucket.isGroup ? "whatsapp_group" : "whatsapp", sender: tenant.phone, media: bucket.messages.some((m) => m.media) },
    });
  } else {
    record = await repo.createMaintenanceRequest({
      tenantId: tenant.id,
      unitId: undefined,
      message: combinedMessage,
      triage,
      aiDraft: draftResponse,
      autopilotEnabled: true,
    });
    if (record?.id) {
      await repo.updateMaintenanceUtility({ maintenanceId: record.id, utilityCheck });
      await repo.appendChatMessage({
        id: record.id,
        role: "tenant",
        content: combinedMessage,
        meta: { channel: bucket.isGroup ? "whatsapp_group" : "whatsapp", sender: tenant.phone, media: bucket.messages.some((m) => m.media) },
      });
    }
  }

  const draftText = (draftResponse?.draft || "").trim();
  if (draftText && canAutoReply) {
    await whatsappService.sendWhatsAppText({ to: bucket.replyTo, text: draftText });
    if (record?.id) {
      await repo.appendChatMessage({
        id: record.id,
        role: "ai",
        content: draftText,
        meta: { channel: bucket.isGroup ? "whatsapp_group" : "whatsapp", batched: true },
      });
    }
    lastReplySentAt.set(tenant.id, Date.now());
    // eslint-disable-next-line no-console
    console.info("auto-reply sent (tenant batch)", { tenantId: tenant.id });
  } else if (draftText && !canAutoReply) {
    // eslint-disable-next-line no-console
    console.info("auto-reply disabled for tenant", { tenantId: tenant.id });
  }

  const triageJson: any = record?.triageJson || triage || {};
  const aiDraft: any = record?.aiDraft || draftResponse || {};
  const severity = triageJson?.classification?.severity || "normal";
  const draft = aiDraft?.draft || "(no draft yet)";
  const alert = `Tenant ${tenant.name} (${tenant.phone || bucket.replyTo}) says: ${combinedMessage}\nSeverity: ${severity}\nDraft: ${draft}`;
  for (const number of landlordNumbers()) {
    await whatsappService.sendWhatsAppText({ to: number, text: alert });
  }

  return record;
}

router.post("/whatsapp/evolution", async (req, res) => {
  try {
    let llmInvoked = false;
    let autoReplySent = false;
    let autoReplyReason: string | undefined;
    const text = extractWhatsAppText(req.body)?.trim();
    const mediaNote = extractWhatsAppMediaDescription(req.body)?.trim();
    const inboundContent = [text, mediaNote].filter(Boolean).join(" ").trim();
    if (!inboundContent) return res.json({ ok: true, ignored: "no_text" });
    const { remoteJid, participant, isGroup, sender, replyTo } = extractWhatsAppSenderInfo(req.body);
    if (!sender) {
      // For groups, ignore when no participant phone is available.
      return res.json({ ok: true, ignored: isGroup ? "no_group_participant" : "no_sender" });
    }
    const fromMe = isFromMe(req.body);

    // Ignore bot-echoed messages unless it's the landlord number initiating a request.
    if (fromMe) {
      if (!isLandlordNumber(sender)) return res.json({ ok: true, ignored: "from_me" });
      if (text?.startsWith("AI Assistance:")) return res.json({ ok: true, ignored: "from_me_ai_echo" });
      // landlord self-test allowed to proceed
    }

    const isLandlord = !isGroup && isLandlordNumber(sender);
    const respond = (payload: Record<string, unknown>) => {
      setWebhookStatus({
        receivedAt: new Date().toISOString(),
        routed: typeof payload.routed === "string" ? payload.routed : undefined,
        llmInvoked,
        autoReplySent,
        autoReplyReason,
        delayMs: typeof (payload as any).delayMs === "number" ? (payload as any).delayMs : undefined,
        sender,
        isGroup,
        isLandlord,
      });
      return res.json(payload);
    };
    if (isLandlord) {
      const record = await repo.findLatestOpenMaintenance();
      if (!record) {
        await whatsappService.sendWhatsAppText({
          to: sender,
          text: "No active tenant requests right now.",
        });
        return respond({ ok: true, routed: "landlord_no_active", llmInvoked, autoReplySent });
      }
      await repo.appendChatMessage({
        id: record.id,
        role: "landlord",
        content: text,
        meta: { channel: "whatsapp", sender },
        setLandlordReply: text,
      });
      // Offer the landlord an AI-assisted reply based on the current thread (no tenant visibility).
        const chatLog = Array.isArray(record.chatLog) ? (record.chatLog as any[]) : [];
        const augmentedLog = [
          ...chatLog,
          { role: "landlord", content: text, createdAt: new Date().toISOString() },
        ];
        const lastTenantMessage = [...augmentedLog].reverse().find((c) => c.role === "tenant")?.content || "";
        const triageJson: any = record.triageJson || { summary: record.message };
        const utilityCheck: any = record.utilityAnomaly
          ? { status: "ok", anomalyFound: true, notes: record.utilityNotes }
          : { status: "ok", anomalyFound: false };
        const baseDraft = (record.aiDraft as any)?.draft || "";
        const wantsDraft = /(draft|tenant\s*reply|tenant\s*message|forward|send to tenant|ok to send|approve|push)/i.test(text || "");
        let tenantDraft: string | undefined;
        if (wantsDraft) {
          const landlordAssist = await agentService.advisorSuggest({
            instructions: text || "",
            baseDraft,
            triage: triageJson,
            tenantMessage: lastTenantMessage,
            conversationLog: augmentedLog,
            landlordReply: text,
          });
          llmInvoked = true;
          const analysis = (() => {
            if (typeof (landlordAssist as any)?.analysis === "string") return (landlordAssist as any).analysis.trim();
            if (typeof (landlordAssist as any)?.suggestion === "string") return (landlordAssist as any).suggestion.trim();
            return "";
          })();
          tenantDraft = (() => {
            if (typeof (landlordAssist as any)?.reply === "string") return (landlordAssist as any).reply.trim();
            if (typeof (landlordAssist as any)?.draft === "string") return (landlordAssist as any).draft.trim();
            if (typeof baseDraft === "string") return baseDraft.trim();
            return "";
          })();
          const labeledAiReply = `AI Assistance:\nAction: ${analysis || "No analysis"}\nTenant draft: ${tenantDraft || "No draft yet"}`;
          await whatsappService.sendWhatsAppText({ to: sender, text: labeledAiReply });
          await repo.appendChatMessage({
            id: record.id,
            role: "ai",
            content: labeledAiReply,
            meta: { channel: "whatsapp", assistant: true },
          });
          await repo.updateAiDraft({
            id: record.id,
            aiDraft: {
              ...(record.aiDraft as any),
              draft: tenantDraft || baseDraft,
              analysis,
              source: "advisor",
            },
          });
        } else {
          const landlordChat = await agentService.advisorSuggest({
            instructions: text || "",
            baseDraft: baseDraft || undefined,
            triage: triageJson,
            tenantMessage: lastTenantMessage,
            conversationLog: augmentedLog,
            landlordReply: text,
          });
          llmInvoked = true;
          const chatReplyRaw = (() => {
            if (typeof (landlordChat as any)?.reply === "string") return (landlordChat as any).reply.trim();
            if (typeof (landlordChat as any)?.analysis === "string") return (landlordChat as any).analysis.trim();
            if (typeof (landlordChat as any)?.suggestion === "string") return (landlordChat as any).suggestion.trim();
            return "I’m here. Ask anything about the issue, approvals, or next steps.";
          })();
          const chatReply = (() => {
            const raw = chatReplyRaw || "";
            if (/^\s*\{/.test(raw)) {
              try {
                const parsed = JSON.parse(raw);
                if (typeof parsed?.reply === "string" && parsed.reply.trim()) return parsed.reply.trim();
                if (typeof parsed?.analysis === "string" && parsed.analysis.trim()) return parsed.analysis.trim();
              } catch (_) {
                // fall through
              }
            }
            return raw || "I’m here. Ask anything about the issue, approvals, or next steps.";
          })();
          await whatsappService.sendWhatsAppText({ to: sender, text: `AI Assistance: ${chatReply}` });
          await repo.appendChatMessage({
            id: record.id,
            role: "ai",
            content: `AI Assistance: ${chatReply}`,
            meta: { channel: "whatsapp", assistant: true },
          });
        }

        // Approval path: landlord can forward the latest AI draft to the tenant.
        const approved = /approve|approved|send it|ok to send/i.test(text || "");
        const forwardDraft = (tenantDraft || (record.aiDraft as any)?.draft || "").trim();
        if (approved && record.tenantId && forwardDraft) {
          const tenant = await repo.getTenantById(record.tenantId);
          if (tenant?.phone) {
            await whatsappService.sendWhatsAppText({ to: tenant.phone, text: forwardDraft });
            await repo.appendChatMessage({
              id: record.id,
              role: "ai",
              content: forwardDraft,
              meta: { channel: "whatsapp", forwarded: true, approvedBy: sender },
            });
          }
        }
      return respond({ ok: true, routed: "landlord", llmInvoked, autoReplySent, autoReplyReason });
    }

    const tenant = await repo.findTenantByPhone(sender);
    if (!tenant) {
      const contractor = await repo.findContractorByPhone(sender);
      if (contractor) {
        const note = `Contractor ${contractor.name} (${contractor.phone}) says: ${inboundContent}`;
        for (const number of landlordNumbers()) {
          await whatsappService.sendWhatsAppText({ to: number, text: note });
        }
        // eslint-disable-next-line no-console
        console.info("whatsapp routed contractor message", { sender, remoteJid, participant, isGroup });
        return respond({ ok: true, routed: "contractor", llmInvoked, autoReplySent, autoReplyReason });
      }
      // Ignore messages from numbers that are not registered tenants.
      // eslint-disable-next-line no-console
      console.warn("whatsapp ignored unknown sender", { sender, remoteJid, participant, isGroup });
      return respond({ ok: true, ignored: "unknown_sender", llmInvoked, autoReplySent, autoReplyReason });
    }

    let record = await repo.findLatestMaintenanceForTenantId(tenant.id);
    const tenantMessage = inboundContent;
    const triage = await agentService.triageMaintenance({
      tenantMessage,
      tenantId: tenant.id,
      unitId: undefined,
    });
    llmInvoked = true;

    const delayMs = await computeDelayMs(
      tenant.id,
      (triage?.classification?.severity || "normal").toString().toLowerCase(),
      tenantMessage
    );
    const isImmediate = delayMs <= 0;

    // Always log the inbound tenant message to the conversation.
    if (record?.id) {
      record = await repo.appendChatMessage({
        id: record.id,
        role: "tenant",
        content: tenantMessage,
        meta: { channel: isGroup ? "whatsapp_group" : "whatsapp", sender, media: Boolean(mediaNote) },
      });
    } else {
      record = await repo.createMaintenanceRequest({
        tenantId: tenant.id,
        unitId: undefined,
        message: tenantMessage,
        triage,
        autopilotEnabled: true,
      });
    }

    if (record?.id) {
      await repo.updateMaintenanceAnalysis({ id: record.id, triage });
    }

    if (!isImmediate) {
      queueTenantReply({
        tenantId: tenant.id,
        replyTo,
        isGroup,
        tenantMessage,
        media: Boolean(mediaNote),
        delayMs,
      });
      autoReplyReason = "queued_delay";
      return respond({ ok: true, routed: "tenant_queued", delayMs, llmInvoked, autoReplySent, autoReplyReason });
    }

    const conversationLog = Array.isArray(record?.chatLog) ? (record?.chatLog as any[]) : [];
    const utilityCheck = await agentService.checkUtilityAnomaly({ tenantId: tenant.id, unitId: undefined });

    const draftResponse = await agentService.draftRtaResponse({
      tenantMessage,
      triage,
      utilityCheck,
      conversationLog,
      landlordReply: record?.landlordReply,
    });
    llmInvoked = true;

    if (record?.id) {
      await repo.updateMaintenanceAnalysis({ id: record.id, triage, aiDraft: draftResponse });
      await repo.updateMaintenanceUtility({ maintenanceId: record.id, utilityCheck });
    }

    const globalAutoReply = await repo.getGlobalAutoReplyEnabled();
    const canAutoReply = globalAutoReply.enabled && tenant.autoReplyEnabled !== false;
    const draftText = (draftResponse?.draft || "").trim();
    if (draftText && canAutoReply) {
      await whatsappService.sendWhatsAppText({
        to: replyTo,
        text: draftText,
      });
      lastReplySentAt.set(tenant.id, Date.now());
      autoReplySent = true;
      autoReplyReason = "draft_sent";
    } else if (draftText && !canAutoReply) {
      // eslint-disable-next-line no-console
      console.info("auto-reply disabled for tenant", { tenantId: tenant.id });
      autoReplyReason = "auto_reply_disabled";
    } else if (!draftText) {
      autoReplyReason = "no_draft";
    }

    const triageJson: any = record?.triageJson || triage || {};
    const aiDraft: any = record?.aiDraft || draftResponse || {};
    const severity = triageJson?.classification?.severity || "normal";
    const draft = aiDraft?.draft || "(no draft yet)";
    const alert = `Tenant ${tenant.name} (${tenant.phone || sender}) says: ${tenantMessage}\nSeverity: ${severity}\nDraft: ${draft}`;
    for (const number of landlordNumbers()) {
      await whatsappService.sendWhatsAppText({ to: number, text: alert });
    }

    return respond({ ok: true, routed: "tenant", llmInvoked, autoReplySent, autoReplyReason });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("whatsapp webhook failed", err);
    return res.status(500).json({ error: "whatsapp_webhook_failed", detail: (err as Error).message });
  }
});

export default router;
