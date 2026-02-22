type SendTextParams = {
  to: string;
  text: string;
  session?: string;
  landlordId?: string;
};

type SendResult = {
  ok: boolean;
  error?: string;
  response?: unknown;
};

function getConfig() {
  return {
    baseUrl: (process.env.EVOLUTION_API_BASE_URL || "").trim(),
    token: (process.env.EVOLUTION_API_TOKEN || "").trim(),
    tokenHeader: (process.env.EVOLUTION_API_TOKEN_HEADER || "apikey").trim(),
    sendPath: (process.env.EVOLUTION_API_SEND_PATH || "/message/sendText").trim(),
    session: (process.env.EVOLUTION_API_SESSION || "default").trim(),
    instance: (process.env.EVOLUTION_API_INSTANCE || "").trim(),
  };
}

function buildSendUrl(baseUrl: string, path: string, session: string) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  let fullPath = path.startsWith("/") ? path : `/${path}`;
  if (fullPath.includes("{session}")) {
    fullPath = fullPath.replace("{session}", encodeURIComponent(session));
  }
  return `${normalizedBase}${fullPath}`;
}

export function normalizeWhatsAppNumber(raw: string) {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.includes("@")) {
    return trimmed.split("@")[0];
  }
  return trimmed.replace(/\s+/g, "");
}

/**
 * Send a WhatsApp text message via Evolution API.
 * Now accepts optional landlordId for multi-tenant instance routing (future use).
 */
export async function sendWhatsAppText(params: SendTextParams): Promise<SendResult> {
  const cfg = getConfig();
  if (!cfg.baseUrl || !cfg.token) {
    // eslint-disable-next-line no-console
    console.error("sendWhatsAppText BLOCKED: Evolution API not configured", { baseUrl: Boolean(cfg.baseUrl), token: Boolean(cfg.token) });
    return { ok: false, error: "evolution_api_not_configured" };
  }
  const session = params.session || cfg.session;
  const url = buildSendUrl(cfg.baseUrl, cfg.sendPath, session);
  const payload: Record<string, unknown> = {
    number: normalizeWhatsAppNumber(params.to),
    text: params.text,
    session,
  };
  if (cfg.instance) payload.instance = cfg.instance;
  // eslint-disable-next-line no-console
  console.info("sendWhatsAppText →", { url, to: payload.number, textLen: (params.text || "").length });
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [cfg.tokenHeader]: cfg.token,
      },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.error("sendWhatsAppText FAILED", { status: res.status, error: data?.error || data?.message, url });
      return { ok: false, error: data?.error || `send_failed_${res.status}`, response: data };
    }
    // eslint-disable-next-line no-console
    console.info("sendWhatsAppText OK", { to: payload.number, status: res.status });
    return { ok: true, response: data };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("sendWhatsAppText EXCEPTION", { error: (err as Error).message, url });
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * Helper: send a message to all of a landlord's WhatsApp numbers
 */
export async function alertLandlord(landlordId: string, text: string): Promise<void> {
  // Import dynamically to avoid circular deps
  const { db } = require("../config/database");
  try {
    const landlord = await db.landlord.findUnique({ where: { id: landlordId }, select: { whatsappNumbers: true } });
    if (!landlord?.whatsappNumbers?.length) return;
    for (const number of landlord.whatsappNumbers) {
      await sendWhatsAppText({ to: number, text, landlordId });
    }
  } catch (err) {
    console.warn("alertLandlord failed", err); // eslint-disable-line no-console
  }
}

export default {
  sendWhatsAppText,
  normalizeWhatsAppNumber,
  alertLandlord,
};
