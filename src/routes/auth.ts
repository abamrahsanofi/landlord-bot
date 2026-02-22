import express from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "../config/database";
import { signToken, requireAuth, AuthRequest } from "../middleware/auth";
import { PLANS } from "../services/planService";

const router = express.Router();

const signupSchema = z.object({
    email: z.string().email("valid email required"),
    password: z.string().min(8, "password must be at least 8 characters"),
    name: z.string().min(1, "name required"),
    phone: z.string().optional(),
    company: z.string().optional(),
    province: z.string().default("ON"),
});

const loginSchema = z.object({
    email: z.string().email("valid email required"),
    password: z.string().min(1, "password required"),
});

// ── Signup ──────────────────────────────────────────────
router.post("/signup", async (req, res) => {
    const parsed = signupSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
    }

    try {
        const existing = await db.landlord.findUnique({ where: { email: parsed.data.email } });
        if (existing) {
            return res.status(409).json({ error: "email_in_use", message: "An account with this email already exists" });
        }

        const passwordHash = await bcrypt.hash(parsed.data.password, 12);
        const landlord = await db.landlord.create({
            data: {
                email: parsed.data.email,
                passwordHash,
                name: parsed.data.name,
                phone: parsed.data.phone,
                company: parsed.data.company,
                province: parsed.data.province,
                whatsappNumbers: parsed.data.phone ? [parsed.data.phone] : [],
            },
        });

        // Create default settings
        await db.landlordSettings.create({
            data: {
                landlordId: landlord.id,
                globalAutoReplyEnabled: false,
                batchDelaySeconds: 300,
                cooldownMinutes: 60,
            },
        });

        const token = signToken(landlord.id);
        const plan = PLANS[landlord.plan];

        res.json({
            token,
            landlord: {
                id: landlord.id,
                email: landlord.email,
                name: landlord.name,
                plan: landlord.plan,
                province: landlord.province,
                limits: plan,
            },
        });
    } catch (err) {
        console.error("Signup failed", err);
        return res.status(500).json({ error: "signup_failed" });
    }
});

// ── Login ───────────────────────────────────────────────
router.post("/login", async (req, res) => {
    const parsed = loginSchema.safeParse(req.body || {});
    if (!parsed.success) {
        return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });
    }

    try {
        const landlord = await db.landlord.findUnique({ where: { email: parsed.data.email } });
        if (!landlord) {
            return res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
        }

        const valid = await bcrypt.compare(parsed.data.password, landlord.passwordHash);
        if (!valid) {
            return res.status(401).json({ error: "invalid_credentials", message: "Invalid email or password" });
        }

        const token = signToken(landlord.id);
        const plan = PLANS[landlord.plan];

        res.json({
            token,
            landlord: {
                id: landlord.id,
                email: landlord.email,
                name: landlord.name,
                plan: landlord.plan,
                province: landlord.province,
                limits: plan,
            },
        });
    } catch (err) {
        console.error("Login failed", err);
        return res.status(500).json({ error: "login_failed" });
    }
});

// ── Get current user ────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
    const authReq = req as AuthRequest;
    try {
        const landlord = await db.landlord.findUnique({
            where: { id: authReq.landlordId },
            include: { settings: true },
        });
        if (!landlord) return res.status(404).json({ error: "not_found" });

        const plan = PLANS[landlord.plan];
        const unitCount = await db.unit.count({ where: { landlordId: authReq.landlordId } });
        const tenantCount = await db.tenant.count({ where: { landlordId: authReq.landlordId } });
        const ticketCount = await db.maintenanceRequest.count({ where: { landlordId: authReq.landlordId } });

        res.json({
            landlord: {
                id: landlord.id,
                email: landlord.email,
                name: landlord.name,
                company: landlord.company,
                phone: landlord.phone,
                plan: landlord.plan,
                province: landlord.province,
                whatsappNumbers: landlord.whatsappNumbers,
                settings: landlord.settings,
                messageCountThisMonth: landlord.messageCountThisMonth,
            },
            limits: plan,
            usage: { units: unitCount, tenants: tenantCount, tickets: ticketCount, messagesThisMonth: landlord.messageCountThisMonth },
        });
    } catch (err) {
        console.error("Get profile failed", err);
        return res.status(500).json({ error: "profile_error" });
    }
});

// ── Update profile ──────────────────────────────────────
router.patch("/me", requireAuth, async (req, res) => {
    const authReq = req as AuthRequest;
    const updateSchema = z.object({
        name: z.string().optional(),
        company: z.string().optional(),
        phone: z.string().optional(),
        province: z.string().optional(),
        whatsappNumbers: z.array(z.string()).optional(),
    });
    const parsed = updateSchema.safeParse(req.body || {});
    if (!parsed.success) return res.status(400).json({ error: "validation_failed", details: parsed.error.flatten() });

    try {
        const data: Record<string, unknown> = {};
        if (parsed.data.name) data.name = parsed.data.name;
        if (parsed.data.company !== undefined) data.company = parsed.data.company;
        if (parsed.data.phone) data.phone = parsed.data.phone;
        if (parsed.data.province) data.province = parsed.data.province;
        if (parsed.data.whatsappNumbers) data.whatsappNumbers = parsed.data.whatsappNumbers;

        const updated = await db.landlord.update({ where: { id: authReq.landlordId }, data });
        res.json({ landlord: { id: updated.id, email: updated.email, name: updated.name, plan: updated.plan, province: updated.province } });
    } catch (err) {
        console.error("Update profile failed", err);
        return res.status(500).json({ error: "update_failed" });
    }
});

export default router;
