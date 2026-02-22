/**
 * Stripe billing integration.
 * All Stripe calls are gated behind STRIPE_SECRET_KEY existing.
 * When the key is absent, the endpoints still work but return helpful placeholders.
 */
import { db } from "../config/database";

const isStripeConfigured = () => Boolean(process.env.STRIPE_SECRET_KEY);

let stripeInstance: any = null;
function getStripe() {
    if (!isStripeConfigured()) return null;
    if (!stripeInstance) {
        // Dynamic import so the app works without Stripe installed
        try {
            const Stripe = require("stripe");
            stripeInstance = new Stripe(process.env.STRIPE_SECRET_KEY!);
        } catch {
            console.warn("Stripe package not installed. Run: npm install stripe");
            return null;
        }
    }
    return stripeInstance;
}

const PRICE_IDS: Record<string, string> = {
    PRO: process.env.STRIPE_PRO_PRICE_ID || "",
    ENTERPRISE: process.env.STRIPE_ENTERPRISE_PRICE_ID || "",
};

export async function createCheckoutSession(landlordId: string, targetPlan: "PRO" | "ENTERPRISE") {
    const stripe = getStripe();
    if (!stripe) {
        return { url: null, error: "stripe_not_configured", message: "Set STRIPE_SECRET_KEY to enable billing" };
    }

    const landlord = await db.landlord.findUnique({ where: { id: landlordId } });
    if (!landlord) return { url: null, error: "landlord_not_found" };

    const priceId = PRICE_IDS[targetPlan];
    if (!priceId) return { url: null, error: "price_not_configured", message: `Set STRIPE_${targetPlan}_PRICE_ID env var` };

    try {
        const session = await stripe.checkout.sessions.create({
            customer_email: landlord.email,
            mode: "subscription",
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${process.env.APP_URL || "http://localhost:3000"}/dashboard?upgraded=true`,
            cancel_url: `${process.env.APP_URL || "http://localhost:3000"}/dashboard?cancelled=true`,
            metadata: { landlordId },
        });
        return { url: session.url, error: null };
    } catch (err: any) {
        console.error("Stripe checkout failed", err);
        return { url: null, error: "checkout_failed", message: err.message };
    }
}

export async function handleWebhook(payload: Buffer, signature: string) {
    const stripe = getStripe();
    if (!stripe) return { handled: false, error: "stripe_not_configured" };

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
    if (!webhookSecret) return { handled: false, error: "webhook_secret_not_configured" };

    try {
        const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            const landlordId = session.metadata?.landlordId;
            const priceId = session.line_items?.data?.[0]?.price?.id;
            if (landlordId) {
                const plan = Object.entries(PRICE_IDS).find(([_, pid]) => pid === priceId)?.[0] || "PRO";
                await db.landlord.update({
                    where: { id: landlordId },
                    data: {
                        plan: plan as any,
                        stripeCustomerId: session.customer as string,
                    },
                });
            }
            return { handled: true, event: event.type };
        }

        if (event.type === "customer.subscription.deleted") {
            const subscription = event.data.object;
            const customerId = subscription.customer;
            if (customerId) {
                await db.landlord.updateMany({
                    where: { stripeCustomerId: customerId as string },
                    data: { plan: "FREE" },
                });
            }
            return { handled: true, event: event.type };
        }

        return { handled: false, event: event.type, note: "unhandled_event_type" };
    } catch (err: any) {
        console.error("Stripe webhook failed", err);
        return { handled: false, error: err.message };
    }
}

export default { createCheckoutSession, handleWebhook };
