/**
 * rateLimiter.ts — Sliding window rate limiter using in-memory store.
 *
 * Protects API endpoints against abuse. No external dependency needed.
 * Each key (IP or token) gets a window of requests.
 */

import { Request, Response, NextFunction } from "express";

interface RateBucket {
    count: number;
    resetAt: number;
}

const buckets = new Map<string, RateBucket>();

// Cleanup stale buckets every 5 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
        if (bucket.resetAt < now) buckets.delete(key);
    }
}, 5 * 60 * 1000);

function getKey(req: Request, prefix: string): string {
    // Use JWT sub if authenticated, otherwise IP
    const user = (req as any).user?.landlordId || (req as any).user?.sub;
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    return `${prefix}:${user || ip}`;
}

/**
 * Create rate limiting middleware.
 * @param windowMs Time window in milliseconds
 * @param maxRequests Max requests allowed in the window
 * @param prefix Optional key prefix for different endpoint groups
 */
export function rateLimit(opts: {
    windowMs?: number;
    maxRequests?: number;
    prefix?: string;
    message?: string;
}) {
    const windowMs = opts.windowMs || 60 * 1000; // 1 minute default
    const maxRequests = opts.maxRequests || 60;   // 60 req/min default
    const prefix = opts.prefix || "global";
    const message = opts.message || "Too many requests, please try again later.";

    return (req: Request, res: Response, next: NextFunction) => {
        const key = getKey(req, prefix);
        const now = Date.now();
        let bucket = buckets.get(key);

        if (!bucket || bucket.resetAt < now) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }

        bucket.count++;

        // Set rate limit headers
        const remaining = Math.max(0, maxRequests - bucket.count);
        const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);
        res.set("X-RateLimit-Limit", String(maxRequests));
        res.set("X-RateLimit-Remaining", String(remaining));
        res.set("X-RateLimit-Reset", String(resetSeconds));

        if (bucket.count > maxRequests) {
            res.set("Retry-After", String(resetSeconds));
            return res.status(429).json({ error: message });
        }

        return next();
    };
}

/**
 * Stricter rate limit for auth endpoints (login, signup)
 */
export const authRateLimit = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    maxRequests: 10,            // 10 attempts per 15 min
    prefix: "auth",
    message: "Too many authentication attempts. Please try again in 15 minutes.",
});

/**
 * Standard API rate limit
 */
export const apiRateLimit = rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 100,
    prefix: "api",
});

/**
 * Webhook rate limit (more generous for Evolution API)
 */
export const webhookRateLimit = rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 300,
    prefix: "webhook",
});

/**
 * AI agent rate limit (expensive operations)
 */
export const agentRateLimit = rateLimit({
    windowMs: 60 * 1000,
    maxRequests: 20,
    prefix: "agent",
    message: "AI agent rate limit reached. Please wait before sending more requests.",
});
