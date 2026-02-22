/**
 * mediaService.ts — Download and process media from Evolution API.
 *
 * Handles:
 *  - Downloading images/video/audio/documents from Evolution API
 *  - Image analysis via Gemini Vision
 *  - Audio/voice note transcription via Gemini
 *  - Video keyframe extraction + analysis
 *
 * Media types supported by WhatsApp / Evolution:
 *  - imageMessage   → image/jpeg, image/png, image/webp
 *  - videoMessage    → video/mp4
 *  - audioMessage    → audio/ogg (voice notes via ptt), audio/mpeg
 *  - documentMessage → application/pdf, etc.
 */

import { vertexAI, defaultModel } from "../config/gemini";

// ═══════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════

function getEvolutionConfig() {
    return {
        baseUrl: (process.env.EVOLUTION_API_BASE_URL || "").trim().replace(/\/+$/, ""),
        token: (process.env.EVOLUTION_API_TOKEN || "").trim(),
        instance: (process.env.EVOLUTION_API_INSTANCE || "").trim(),
    };
}

// ═══════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════

export type MediaType = "image" | "video" | "audio" | "document" | "unknown";

export interface ExtractedMedia {
    /** What kind of media */
    type: MediaType;
    /** Raw base64 data */
    base64: string;
    /** MIME type */
    mimeType: string;
    /** Caption text if any */
    caption: string;
    /** Human-readable description (from vision/transcription) */
    description: string;
    /** For audio: the transcribed text */
    transcription?: string;
    /** File name if available */
    fileName?: string;
}

// ═══════════════════════════════════════════════════════════
//  MEDIA EXTRACTION FROM WEBHOOK PAYLOAD
// ═══════════════════════════════════════════════════════════

/**
 * Detect the media type from an Evolution API webhook payload.
 */
export function detectMediaType(payload: any): MediaType {
    const data = payload?.data || payload;
    const msg = data?.message || {};
    if (msg.imageMessage) return "image";
    if (msg.videoMessage) return "video";
    if (msg.audioMessage || msg.ptt) return "audio";
    if (msg.documentMessage) return "document";
    return "unknown";
}

/**
 * Extract the media message key needed to download from Evolution API.
 */
function extractMediaMessageId(payload: any): string | null {
    const data = payload?.data || payload;
    const key = data?.key;
    if (!key) return null;
    return key.id || null;
}

/**
 * Extract inline base64 from the webhook payload (images sent with webhook_base64=true).
 */
function extractInlineBase64(payload: any): { base64: string; mimeType: string } | null {
    const data = payload?.data || payload;
    const msg = data?.message || {};

    // Image paths
    const imageSources = [
        msg.imageMessage?.base64,
        msg.imageMessage?.imageBase64,
        msg.imageMessage?.media?.base64,
        msg.imageMessage?.media?.data,
        msg.imageMessage?.data,
    ];
    const imageRaw = imageSources.find((s) => typeof s === "string" && s.trim());
    if (imageRaw) {
        const mimeType = msg.imageMessage?.mimetype || msg.imageMessage?.mimeType || "image/jpeg";
        return { base64: cleanBase64(imageRaw), mimeType };
    }

    // Audio paths
    const audioSources = [
        msg.audioMessage?.base64,
        msg.audioMessage?.media?.base64,
        msg.audioMessage?.data,
        msg.ptt?.base64,
    ];
    const audioRaw = audioSources.find((s) => typeof s === "string" && s.trim());
    if (audioRaw) {
        const mimeType = msg.audioMessage?.mimetype || msg.ptt?.mimetype || "audio/ogg; codecs=opus";
        return { base64: cleanBase64(audioRaw), mimeType };
    }

    // Video paths
    const videoSources = [
        msg.videoMessage?.base64,
        msg.videoMessage?.media?.base64,
        msg.videoMessage?.data,
    ];
    const videoRaw = videoSources.find((s) => typeof s === "string" && s.trim());
    if (videoRaw) {
        const mimeType = msg.videoMessage?.mimetype || "video/mp4";
        return { base64: cleanBase64(videoRaw), mimeType };
    }

    // Document paths
    const docSources = [
        msg.documentMessage?.base64,
        msg.documentMessage?.media?.base64,
        msg.documentMessage?.data,
    ];
    const docRaw = docSources.find((s) => typeof s === "string" && s.trim());
    if (docRaw) {
        const mimeType = msg.documentMessage?.mimetype || "application/octet-stream";
        return { base64: cleanBase64(docRaw), mimeType };
    }

    // Generic base64 field
    if (typeof data?.base64 === "string" && data.base64.trim()) {
        return { base64: cleanBase64(data.base64), mimeType: data.mimeType || "application/octet-stream" };
    }

    return null;
}

function cleanBase64(raw: string): string {
    const trimmed = raw.trim().replace(/\s+/g, "");
    const match = /^data:[^;]+;base64,(.*)$/i.exec(trimmed);
    return match?.[1] || trimmed;
}

/**
 * Extract caption from media messages.
 */
function extractCaption(payload: any): string {
    const data = payload?.data || payload;
    const msg = data?.message || {};
    return (
        msg.imageMessage?.caption ||
        msg.videoMessage?.caption ||
        msg.documentMessage?.caption ||
        ""
    ).trim();
}

/**
 * Extract filename from document messages.
 */
function extractFileName(payload: any): string {
    const data = payload?.data || payload;
    const msg = data?.message || {};
    return (msg.documentMessage?.fileName || msg.documentMessage?.title || "").trim();
}

// ═══════════════════════════════════════════════════════════
//  DOWNLOAD FROM EVOLUTION API
// ═══════════════════════════════════════════════════════════

/**
 * Download media from Evolution API using the message key.
 * Evolution v2 endpoint: POST /chat/getBase64FromMediaMessage/{instance}
 * Requires the full message object (key + message with mediaKey/directPath).
 */
async function downloadFromEvolution(messageId: string, payload: any): Promise<{ base64: string; mimeType: string } | null> {
    const cfg = getEvolutionConfig();
    if (!cfg.baseUrl || !cfg.token || !cfg.instance) return null;

    const data = payload?.data || payload;
    const key = data?.key;
    if (!key) return null;

    // Evolution API needs both the key AND the full message object to decrypt media
    const message = data?.message;

    try {
        const url = `${cfg.baseUrl}/chat/getBase64FromMediaMessage/${cfg.instance}`;
        const requestBody: any = {
            message: { key },
        };

        // Include the full message object — Evolution needs mediaKey, directPath, etc. to decrypt
        if (message) {
            requestBody.message.message = message;
        }

        // eslint-disable-next-line no-console
        console.info("[MediaService] Downloading media from Evolution", {
            url,
            messageId,
            hasMessage: Boolean(message),
            messageKeys: message ? Object.keys(message) : [],
        });

        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: cfg.token,
            },
            body: JSON.stringify(requestBody),
        });

        if (!res.ok) {
            const errorBody = await res.text().catch(() => "");
            // eslint-disable-next-line no-console
            console.warn(`[MediaService] Evolution download failed: ${res.status}`, errorBody);

            // Fallback: try with convertToMp4 for audio/video
            if (message?.audioMessage || message?.videoMessage) {
                requestBody.convertToMp4 = true;
                const retryRes = await fetch(url, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        apikey: cfg.token,
                    },
                    body: JSON.stringify(requestBody),
                });
                if (retryRes.ok) {
                    const retryResult = await retryRes.json() as any;
                    const b64 = retryResult?.base64 || retryResult?.data || "";
                    if (b64) {
                        return {
                            base64: cleanBase64(b64),
                            mimeType: retryResult?.mimetype || retryResult?.mimeType || "application/octet-stream",
                        };
                    }
                }
            }
            return null;
        }

        const result = await res.json() as any;
        const base64 = result?.base64 || result?.data || "";
        const mimeType = result?.mimetype || result?.mimeType || "application/octet-stream";

        if (!base64) {
            // eslint-disable-next-line no-console
            console.warn("[MediaService] Evolution returned empty base64");
            return null;
        }

        // eslint-disable-next-line no-console
        console.info("[MediaService] Media downloaded successfully", {
            mimeType,
            base64Length: base64.length,
        });

        return { base64: cleanBase64(base64), mimeType };
    } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[MediaService] Evolution download error:", (err as Error).message);
        return null;
    }
}

// ═══════════════════════════════════════════════════════════
//  AI PROCESSING
// ═══════════════════════════════════════════════════════════

/**
 * Analyze an image with Gemini Vision.
 */
async function analyzeImage(base64: string, mimeType: string, context?: string): Promise<string> {
    if (!vertexAI) return "";

    const model = vertexAI.getGenerativeModel({ model: defaultModel });
    const prompt = [
        "You are analyzing an image sent via WhatsApp.",
        "Describe what you see clearly and factually in 2-4 sentences.",
        "Focus on: visible damage, issues, objects, conditions, text, or anything noteworthy.",
        "If you see maintenance issues (leaks, damage, mold, broken items), describe them specifically.",
        "If it's a document/bill/receipt, extract the key information (amounts, dates, names).",
        "If it's a general photo, describe it briefly.",
        context ? `\nContext from sender: ${context}` : "",
    ].filter(Boolean).join("\n");

    try {
        const result = await model.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { data: base64, mimeType } },
                ],
            }],
        });
        const text = result.response?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text || "").join("") || "";
        return text.trim();
    } catch (err) {
        console.warn("[MediaService] Image analysis failed:", (err as Error).message);
        return "";
    }
}

/**
 * Transcribe audio/voice note using Gemini's audio understanding.
 * Gemini 2.5 Pro supports audio input natively.
 */
async function transcribeAudio(base64: string, mimeType: string): Promise<string> {
    if (!vertexAI) return "";

    const model = vertexAI.getGenerativeModel({ model: defaultModel });
    const prompt = [
        "Transcribe this audio message word for word.",
        "If the audio is in a language other than English, first transcribe in the original language, then provide an English translation.",
        "Format: just the transcription text, nothing else.",
        "If the audio is unclear or inaudible, say '[inaudible]' for those parts.",
    ].join("\n");

    // Normalize mime type for Gemini compatibility
    let normalizedMime = mimeType;
    if (mimeType.includes("ogg")) normalizedMime = "audio/ogg";
    if (mimeType.includes("mpeg") || mimeType.includes("mp3")) normalizedMime = "audio/mpeg";
    if (mimeType.includes("mp4") && !mimeType.includes("video")) normalizedMime = "audio/mp4";
    if (mimeType.includes("webm")) normalizedMime = "audio/webm";

    try {
        const result = await model.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { data: base64, mimeType: normalizedMime } },
                ],
            }],
        });
        const text = result.response?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text || "").join("") || "";
        return text.trim();
    } catch (err) {
        console.warn("[MediaService] Audio transcription failed:", (err as Error).message);
        return "";
    }
}

/**
 * Analyze a video using Gemini's video understanding.
 * Gemini 2.5 Pro supports video input natively.
 */
async function analyzeVideo(base64: string, mimeType: string, context?: string): Promise<string> {
    if (!vertexAI) return "";

    const model = vertexAI.getGenerativeModel({ model: defaultModel });
    const prompt = [
        "You are analyzing a video sent via WhatsApp.",
        "Describe what you see in the video in 3-5 sentences.",
        "Focus on: visible damage, issues, conditions, actions being shown.",
        "If it shows a maintenance problem (leak, damage, malfunction), describe the severity and location.",
        "If it's a walkthrough, summarize what areas are shown and their condition.",
        context ? `\nContext from sender: ${context}` : "",
    ].filter(Boolean).join("\n");

    try {
        const result = await model.generateContent({
            contents: [{
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { data: base64, mimeType: mimeType || "video/mp4" } },
                ],
            }],
        });
        const text = result.response?.candidates?.[0]?.content?.parts
            ?.map((p: any) => p.text || "").join("") || "";
        return text.trim();
    } catch (err) {
        console.warn("[MediaService] Video analysis failed:", (err as Error).message);
        return "";
    }
}

// ═══════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════════

/**
 * Process all media from an Evolution API webhook payload.
 *
 * Steps:
 *  1. Detect media type
 *  2. Try extracting inline base64, or download from Evolution API
 *  3. Run appropriate AI analysis (vision/transcription/video)
 *  4. Return structured result
 */
export async function processMedia(payload: any, textContext?: string): Promise<ExtractedMedia | null> {
    const mediaType = detectMediaType(payload);
    if (mediaType === "unknown") return null;

    // Step 1: Get base64 — try inline first, then download
    let mediaData = extractInlineBase64(payload);
    if (!mediaData) {
        const messageId = extractMediaMessageId(payload);
        if (messageId) {
            mediaData = await downloadFromEvolution(messageId, payload);
        }
    }

    if (!mediaData) {
        // Can't get the media data — return description only
        return {
            type: mediaType,
            base64: "",
            mimeType: "",
            caption: extractCaption(payload),
            description: `[${mediaType} received but could not be downloaded]`,
            fileName: extractFileName(payload),
        };
    }

    const caption = extractCaption(payload);
    const enrichedContext = [textContext, caption].filter(Boolean).join(". ");

    // Step 2: Process based on type
    let description = "";
    let transcription: string | undefined;

    switch (mediaType) {
        case "image":
            description = await analyzeImage(mediaData.base64, mediaData.mimeType, enrichedContext);
            break;

        case "audio":
            transcription = await transcribeAudio(mediaData.base64, mediaData.mimeType);
            description = transcription
                ? `Voice note transcription: "${transcription}"`
                : "[Voice note received but could not be transcribed]";
            break;

        case "video":
            description = await analyzeVideo(mediaData.base64, mediaData.mimeType, enrichedContext);
            break;

        case "document":
            // For documents, describe what type it is
            const fileName = extractFileName(payload);
            description = fileName
                ? `[Document received: ${fileName}]`
                : "[Document received]";
            // If it's a PDF or image-like doc, try vision
            if (mediaData.mimeType.includes("pdf") || mediaData.mimeType.includes("image")) {
                const docAnalysis = await analyzeImage(mediaData.base64, mediaData.mimeType, enrichedContext);
                if (docAnalysis) description = docAnalysis;
            }
            break;
    }

    return {
        type: mediaType,
        base64: mediaData.base64,
        mimeType: mediaData.mimeType,
        caption,
        description: description || `[${mediaType} received]`,
        transcription,
        fileName: extractFileName(payload),
    };
}

/**
 * Build a comprehensive message from text + media for the AI agent.
 * Combines the text message with media analysis into a single string
 * the agent can reason about.
 */
export function buildMediaEnrichedMessage(
    textMessage: string,
    media: ExtractedMedia | null,
): string {
    const parts: string[] = [];

    if (textMessage) parts.push(textMessage);

    if (media) {
        if (media.transcription) {
            // For voice notes, the transcription IS the message
            parts.push(`[Voice note]: "${media.transcription}"`);
        }
        if (media.description && !media.transcription) {
            parts.push(`[${media.type} analysis]: ${media.description}`);
        }
        if (media.caption && !textMessage.includes(media.caption)) {
            parts.push(`[Caption]: ${media.caption}`);
        }
    }

    return parts.filter(Boolean).join("\n\n");
}

export default {
    processMedia,
    buildMediaEnrichedMessage,
    detectMediaType,
    analyzeImage,
    transcribeAudio,
    analyzeVideo,
};
