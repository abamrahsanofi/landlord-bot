import repo from "./repository";
import whatsappService from "./whatsappService";
import agentService from "./agentService";

type Reminder = {
  id: string;
  type: "rent" | "utility";
  dayOfMonth: number;
  timeUtc: string;
  style: "short" | "medium" | "professional" | "casual";
};

type ReminderResult = {
  reminderId: string;
  sent: number;
  failed: number;
};

const reminders: Reminder[] = [];
const lastSentStamp = new Map<string, string>();

const templates: Record<Reminder["type"], Record<Reminder["style"], string>> = {
  rent: {
    short: "Rent reminder: your payment is due today. Let me know if you need anything.",
    medium: "Hi! Friendly reminder that rent is due today. If you have a payment update, please share it.",
    professional: "Hello, this is a reminder that rent is due today. Please confirm once payment is sent.",
    casual: "Hey! Rent is due today. Ping me if anything comes up.",
  },
  utility: {
    short: "Utility bill reminder: payment is due today. Let me know if you have questions.",
    medium: "Hi! Friendly reminder that the utility bill is due today. Reach out if you need the statement.",
    professional: "Hello, this is a reminder that the utility bill is due today. Please confirm once paid.",
    casual: "Hey! Utility bill is due today. Let me know if you need the details.",
  },
};

function parseTimeUtc(timeUtc: string) {
  const parts = timeUtc.split(":");
  const hour = Number(parts[0]);
  const minute = Number(parts[1] || 0);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return { hour, minute };
}

function stampFor(now: Date, hour: number, minute: number) {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}Z`;
}

function shouldSendNow(reminder: Reminder, now: Date) {
  const time = parseTimeUtc(reminder.timeUtc);
  if (!time) return false;
  if (now.getUTCDate() !== reminder.dayOfMonth) return false;
  if (now.getUTCHours() !== time.hour) return false;
  if (now.getUTCMinutes() !== time.minute) return false;
  const stamp = stampFor(now, time.hour, time.minute);
  const lastStamp = lastSentStamp.get(reminder.id);
  if (lastStamp === stamp) return false;
  return true;
}

export function listReminders() {
  return reminders;
}

export function addReminder(reminder: Reminder) {
  reminders.push(reminder);
  return reminder;
}

export function deleteReminder(id: string) {
  const idx = reminders.findIndex((r) => r.id === id);
  if (idx === -1) return false;
  reminders.splice(idx, 1);
  lastSentStamp.delete(id);
  return true;
}

export async function runDueReminders(now = new Date()): Promise<ReminderResult[]> {
  const results: ReminderResult[] = [];
  for (const reminder of reminders) {
    if (!shouldSendNow(reminder, now)) continue;
    const time = parseTimeUtc(reminder.timeUtc);
    if (!time) continue;
    const stamp = stampFor(now, time.hour, time.minute);
    lastSentStamp.set(reminder.id, stamp);

    const tenants = await repo.listTenants();
    const generated = await agentService.generateReminderMessage({
      type: reminder.type,
      style: reminder.style,
      dueLabel: "today",
    });
    const fallback = templates[reminder.type][reminder.style];
    const message = generated.text || fallback;
    let sent = 0;
    let failed = 0;

    for (const tenant of tenants) {
      if (!tenant.phone) continue;
      const result = await whatsappService.sendWhatsAppText({
        to: tenant.phone,
        text: message,
      });
      if (result.ok) sent += 1;
      else failed += 1;
    }

    results.push({ reminderId: reminder.id, sent, failed });
  }
  return results;
}

export type { Reminder };
