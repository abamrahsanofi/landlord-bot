type SendTextParams = {
  to: string;
  text: string;
  session?: string;
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

export async function sendWhatsAppText(params: SendTextParams): Promise<SendResult> {
  const cfg = getConfig();
  if (!cfg.baseUrl || !cfg.token) {
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
      return { ok: false, error: data?.error || `send_failed_${res.status}`, response: data };
    }
    return { ok: true, response: data };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export default {
  sendWhatsAppText,
  normalizeWhatsAppNumber,
};
