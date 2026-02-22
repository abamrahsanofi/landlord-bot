import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { db } from "../config/database";

const JWT_SECRET = () => process.env.JWT_SECRET || "dev-secret-change-me";
const TOKEN_EXPIRY = "30d";

/**
 * Generic account user shape. In the current deployment this maps to a Landlord,
 * but the interface is generic so any vertical can reuse the auth layer.
 */
export interface AccountUser {
    id: string;
    email: string;
    name: string;
    plan: string;
    province: string;
    whatsappNumbers: string[];
}

export interface AuthRequest extends Request {
    /** @deprecated Use accountId. Kept for backward compat with property-mgmt vertical. */
    landlordId: string;
    /** Generic account identifier */
    accountId: string;
    /** @deprecated Use account. Kept for backward compat. */
    landlord: AccountUser;
    /** Generic authenticated account */
    account: AccountUser;
}

export function signToken(accountId: string): string {
    // JWT payload uses the generic key but we include landlordId for backward compat
    return jwt.sign({ landlordId: accountId, accountId }, JWT_SECRET(), { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): { landlordId: string; accountId: string } | null {
    try {
        const payload = jwt.verify(token, JWT_SECRET()) as any;
        const id = payload.accountId || payload.landlordId;
        return { landlordId: id, accountId: id };
    } catch {
        return null;
    }
}

/**
 * Middleware: requires a valid JWT in Authorization header or `token` cookie.
 * Attaches `landlordId` and `landlord` to the request.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
    const token =
        req.headers.authorization?.replace("Bearer ", "").trim() ||
        (req as any).cookies?.token ||
        (typeof req.query?.token === "string" ? req.query.token : "");

    if (!token) {
        return res.status(401).json({ error: "unauthorized", message: "Missing token" });
    }

    const payload = verifyToken(token);
    if (!payload) {
        return res.status(401).json({ error: "unauthorized", message: "Invalid or expired token" });
    }

    try {
        const landlord = await db.landlord.findUnique({
            where: { id: payload.accountId },
            select: { id: true, email: true, name: true, plan: true, province: true, whatsappNumbers: true },
        });
        if (!landlord) {
            return res.status(401).json({ error: "unauthorized", message: "Account not found" });
        }
        // Set both generic and backward-compat fields
        (req as AuthRequest).accountId = landlord.id;
        (req as AuthRequest).landlordId = landlord.id;
        (req as AuthRequest).account = landlord;
        (req as AuthRequest).landlord = landlord;
        return next();
    } catch (err) {
        console.warn("Auth lookup failed", err);
        return res.status(500).json({ error: "auth_error" });
    }
}

/**
 * Optional auth: if a token is present, attach landlord info. Otherwise continue anonymously.
 * Used for webhook routes that need to resolve landlord from phone number instead.
 */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
    const token =
        req.headers.authorization?.replace("Bearer ", "").trim() ||
        (req as any).cookies?.token ||
        "";

    if (!token) return next();

    const payload = verifyToken(token);
    if (!payload) return next();

    try {
        const landlord = await db.landlord.findUnique({
            where: { id: payload.accountId },
            select: { id: true, email: true, name: true, plan: true, province: true, whatsappNumbers: true },
        });
        if (landlord) {
            (req as AuthRequest).accountId = landlord.id;
            (req as AuthRequest).landlordId = landlord.id;
            (req as AuthRequest).account = landlord;
            (req as AuthRequest).landlord = landlord;
        }
    } catch {
        // Ignore — continue without auth
    }
    return next();
}
