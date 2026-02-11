type WebhookStatus = {
  receivedAt: string;
  routed?: string;
  llmInvoked?: boolean;
  autoReplySent?: boolean;
  autoReplyReason?: string;
  delayMs?: number;
  sender?: string;
  isGroup?: boolean;
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
