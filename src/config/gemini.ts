import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// Prefer explicit Gemini API key. Fall back to Vertex-style project/location if ever provided.
const apiKey =
  process.env.GOOGLE_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.GENERATIVE_AI_API_KEY ||
  "";

const model = process.env.GOOGLE_VERTEX_MODEL || process.env.GOOGLE_MODEL || "gemini-2.5-pro";

if (!apiKey) {
  // eslint-disable-next-line no-console
  console.warn("GOOGLE_API_KEY (or GEMINI_API_KEY) is not set. Gemini client will be disabled until configured.");
}

// Shim a vertex-like object so existing agentService code keeps working.
export const vertexAI = apiKey
  ? {
      getGenerativeModel: (opts: { model: string }) => {
        const client = new GoogleGenerativeAI(apiKey);
        return client.getGenerativeModel({ model: opts.model });
      },
    }
  : null;

export const defaultModel = model;
