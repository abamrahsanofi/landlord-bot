/**
 * leaseExpiryService.ts — Check for upcoming lease expirations and alert landlords.
 *
 * Scans UnitTenant records for endDate approaching within the configured
 * warning window and sends WhatsApp alerts to the landlord.
 */

import { db } from "../config/database";
import whatsappService from "./whatsappService";

const isDbEnabled = Boolean(process.env.DATABASE_URL);

export interface LeaseExpiryAlert {
    tenantName: string;
    tenantPhone: string | null;
    unitLabel: string;
    unitAddress: string;
    endDate: Date;
    daysRemaining: number;
    landlordId: string;
}

/**
 * Find all leases expiring within `daysAhead` days.
 */
export async function findExpiringLeases(daysAhead = 60): Promise<LeaseExpiryAlert[]> {
    if (!isDbEnabled) return [];

    const now = new Date();
    const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

    try {
        const expiring = await db.unitTenant.findMany({
            where: {
                endDate: {
                    not: null,
                    gte: now,
                    lte: cutoff,
                },
            },
            include: {
                tenant: true,
                unit: true,
            },
        });

        return expiring
            .filter((ut) => ut.unit?.landlordId)
            .map((ut) => ({
                tenantName: ut.tenant?.name || "Unknown",
                tenantPhone: ut.tenant?.phone || null,
                unitLabel: ut.unit?.label || "Unknown",
                unitAddress: ut.unit?.address || "",
                endDate: ut.endDate!,
                daysRemaining: Math.ceil((ut.endDate!.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
                landlordId: ut.unit!.landlordId!,
            }));
    } catch (err) {
        console.warn("findExpiringLeases failed", err);
        return [];
    }
}

/**
 * Send lease expiry alerts to landlords via WhatsApp.
 * Only alerts for leases expiring in 60, 30, 14, or 7 days (±1 day tolerance).
 */
export async function sendLeaseExpiryAlerts(): Promise<number> {
    const milestones = [60, 30, 14, 7];
    const alerts = await findExpiringLeases(61);
    let sent = 0;

    // Group by landlord
    const byLandlord = new Map<string, LeaseExpiryAlert[]>();
    for (const alert of alerts) {
        const match = milestones.find((m) => Math.abs(alert.daysRemaining - m) <= 1);
        if (!match) continue;
        const list = byLandlord.get(alert.landlordId) || [];
        list.push(alert);
        byLandlord.set(alert.landlordId, list);
    }

    for (const [landlordId, leaseAlerts] of byLandlord) {
        const lines = leaseAlerts.map((a) =>
            `• ${a.tenantName} at ${a.unitLabel} (${a.unitAddress}) — lease expires in ${a.daysRemaining} days (${a.endDate.toLocaleDateString("en-CA")})`
        );
        const message = `🏠 Lease Expiry Alert\n\nThe following leases are expiring soon:\n${lines.join("\n")}\n\nPlease review and take action (renew, notify tenant, etc).`;

        try {
            await whatsappService.alertLandlord(landlordId, message);
            sent += leaseAlerts.length;
            console.info(`Lease expiry alert sent to landlord ${landlordId}: ${leaseAlerts.length} leases`);
        } catch (err) {
            console.warn(`Failed to send lease expiry alert to ${landlordId}`, err);
        }
    }

    return sent;
}

export default {
    findExpiringLeases,
    sendLeaseExpiryAlerts,
};
