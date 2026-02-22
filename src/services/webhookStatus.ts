type WebhookStatus = {
  receivedAt: string;
  routed?: string;
  llmInvoked?: boolean;
  autoReplySent?: boolean;
  autoReplyReason?: string;
  delayMs?: number;
  sender?: string;
  isGroup?: boolean;
  /** Role of the sender: "owner", "tenant", "patient", "client", etc. */
  senderRole?: string;
  /** @deprecated Use senderRole instead. Kept for backward compat. */
  isLandlord?: boolean;
};

let lastWebhookStatus: WebhookStatus | null = null;

export function setWebhookStatus(status: WebhookStatus) {
  lastWebhookStatus = status;
}

export function getWebhookStatus() {
  return lastWebhookStatus;
}

export type { WebhookStatus };
