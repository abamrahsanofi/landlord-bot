import { db } from "../config/database";
import repo from "./repository";
import whatsappService from "./whatsappService";
import agentService from "./agentService";

const isDbEnabled = Boolean(process.env.DATABASE_URL);

type ReminderInput = {
  id?: string;
  landlordId?: string;
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

const templates: Record<string, Record<string, string>> = {
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

function shouldSendNow(reminder: { dayOfMonth: number; timeUtc: string; lastSentAt?: Date | null }, now: Date) {
  const time = parseTimeUtc(reminder.timeUtc);
  if (!time) return false;
  if (now.getUTCDate() !== reminder.dayOfMonth) return false;
  if (now.getUTCHours() !== time.hour) return false;
  if (now.getUTCMinutes() !== time.minute) return false;
  // Don't re-send if already sent this minute
  if (reminder.lastSentAt) {
    const lastMin = Math.floor(reminder.lastSentAt.getTime() / 60000);
    const nowMin = Math.floor(now.getTime() / 60000);
    if (lastMin === nowMin) return false;
  }
  return true;
}

export async function listReminders(landlordId?: string) {
  if (!isDbEnabled) return [];
  try {
    const where: any = {};
    if (landlordId) where.landlordId = landlordId;
    return await db.reminder.findMany({ where, orderBy: { createdAt: "desc" } });
  } catch (err) {
    console.warn("listReminders failed", err);
    return [];
  }
}

export async function addReminder(input: ReminderInput) {
  if (!isDbEnabled) return null;
  try {
    return await db.reminder.create({
      data: {
        id: input.id,
        landlordId: input.landlordId || null,
        type: input.type,
        dayOfMonth: input.dayOfMonth,
        timeUtc: input.timeUtc,
        style: input.style,
        active: true,
      },
    });
  } catch (err) {
    console.warn("addReminder failed", err);
    return null;
  }
}

export async function deleteReminder(id: string) {
  if (!isDbEnabled || !id) return false;
  try {
    await db.reminder.delete({ where: { id } });
    return true;
  } catch (err) {
    console.warn("deleteReminder failed", err);
    return false;
  }
}

export async function toggleReminder(id: string, active: boolean) {
  if (!isDbEnabled || !id) return null;
  try {
    return await db.reminder.update({ where: { id }, data: { active } });
  } catch (err) {
    console.warn("toggleReminder failed", err);
    return null;
  }
}

export async function runDueReminders(now = new Date()): Promise<ReminderResult[]> {
  if (!isDbEnabled) return [];
  const results: ReminderResult[] = [];

  try {
    const reminders = await db.reminder.findMany({ where: { active: true } });

    for (const reminder of reminders) {
      if (!shouldSendNow(reminder, now)) continue;

      // Mark as sent immediately to prevent duplicate sends
      await db.reminder.update({
        where: { id: reminder.id },
        data: { lastSentAt: now },
      });

      const tenants = await repo.listTenants(reminder.landlordId || undefined);
      const generated = await agentService.generateReminderMessage({
        type: reminder.type as "rent" | "utility",
        style: reminder.style as "short" | "medium" | "professional" | "casual",
        dueLabel: "today",
      });
      const fallback = templates[reminder.type]?.[reminder.style] || templates.rent.medium;
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
  } catch (err) {
    console.warn("runDueReminders failed", err);
  }

  return results;
}

export type { ReminderInput as Reminder };
