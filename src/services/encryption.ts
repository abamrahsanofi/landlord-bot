/**
 * encryption.ts — AES-256-GCM encryption for sensitive data (utility passwords, etc.)
 *
 * Uses ENCRYPTION_KEY from env, or derives a 32-byte key from JWT_SECRET.
 * Format: iv(hex):authTag(hex):ciphertext(hex)
 */

import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getKey(): Buffer {
    const raw = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "dev-secret-change-me";
    // Derive a consistent 32-byte key using SHA-256 hash
    return crypto.createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a plaintext string. Returns "iv:authTag:ciphertext" in hex.
 * Returns null if input is empty/null.
 */
export function encrypt(plaintext: string | null | undefined): string | null {
    if (!plaintext) return null;
    const key = getKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt an encrypted string in "iv:authTag:ciphertext" hex format.
 * Returns the original plaintext, or null on failure.
 */
export function decrypt(encrypted: string | null | undefined): string | null {
    if (!encrypted) return null;
    const parts = encrypted.split(":");
    if (parts.length !== 3) {
        // Not encrypted (legacy plaintext) — return as-is
        return encrypted;
    }
    try {
        const key = getKey();
        const iv = Buffer.from(parts[0], "hex");
        const authTag = Buffer.from(parts[1], "hex");
        const ciphertext = parts[2];
        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(ciphertext, "hex", "utf8");
        decrypted += decipher.final("utf8");
        return decrypted;
    } catch {
        // If decryption fails, it might be legacy plaintext
        return encrypted;
    }
}

/**
 * Check if a value looks like it's already encrypted (iv:authTag:ciphertext hex format)
 */
export function isEncrypted(value: string | null | undefined): boolean {
    if (!value) return false;
    const parts = value.split(":");
    return parts.length === 3 && /^[0-9a-f]+$/.test(parts[0]) && parts[0].length === IV_LENGTH * 2;
}
