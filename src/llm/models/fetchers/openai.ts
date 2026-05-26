/**
 * OpenAI model-list fetcher (Group 14.1).
 *
 * Hits `GET https://api.openai.com/v1/models`, then filters to
 * chat-capable models — the legacy list mixes in embeddings, image
 * generation, TTS, etc. which aren't usable through `generateText` /
 * `generateObject`. We use a name-prefix allow-list rather than a
 * hard-coded model list (plan §14.6: no concrete IDs in `src/llm/**`).
 *
 * Pricing is intentionally NOT requested here — OpenAI doesn't expose
 * per-model pricing through `/v1/models`. The `cheapest` strategy
 * silently skips models without pricing data.
 */

import { ExternalServiceError } from "../../../utils/errors.js";
import type { ModelFetcher, ModelInfo } from "../types.js";

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";

/**
 * Prefixes that identify chat-capable model families. The list is
 * deliberately broad (matches *any* model whose id begins with the
 * prefix) so new revisions are picked up automatically.
 */
const CHAT_CAPABLE_PREFIXES = ["gpt", "chatgpt", "o", "computer-use"];

/**
 * Sub-strings that, when present in the id, identify the model as
 * non-chat (embeddings, TTS, image, moderation, etc.).
 */
const NON_CHAT_MARKERS = [
  "embedding",
  "embed-",
  "tts",
  "whisper",
  "dall-e",
  "image",
  "moderation",
  "search",
  "audio",
];

function looksChatCapable(id: string): boolean {
  const lower = id.toLowerCase();
  if (NON_CHAT_MARKERS.some((m) => lower.includes(m))) return false;
  return CHAT_CAPABLE_PREFIXES.some((p) => lower.startsWith(p));
}

function inferCapabilities(id: string): ModelInfo["capabilities"] {
  const lower = id.toLowerCase();
  const reasoning = /^o[0-9]/.test(lower) || lower.includes("reason");
  const coding = lower.includes("code") || lower.includes("coder");
  return {
    chat: true,
    reasoning: reasoning || undefined,
    coding: coding || undefined,
    structuredOutput: true,
    tools: true,
  };
}

export const openaiFetcher: ModelFetcher = {
  provider: "openai",
  async fetchModels({ apiKey, baseURL } = {}) {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new ExternalServiceError("OPENAI_API_KEY not set — cannot fetch OpenAI model list", {
        details: { provider: "openai" },
      });
    }

    const url = `${baseURL ?? OPENAI_DEFAULT_BASE_URL}/models`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch (err) {
      throw new ExternalServiceError(`OpenAI model-list fetch failed: ${(err as Error).message}`, {
        cause: err,
        details: { provider: "openai", url },
      });
    }
    if (!resp.ok) {
      throw new ExternalServiceError(`OpenAI model-list returned HTTP ${resp.status}`, {
        details: { provider: "openai", status: resp.status },
      });
    }
    const body = (await resp.json()) as {
      data?: Array<{ id: string; created?: number; owned_by?: string }>;
    };
    const rows = body.data ?? [];

    return rows
      .filter((r) => looksChatCapable(r.id))
      .map<ModelInfo>((r) => ({
        id: r.id,
        provider: "openai",
        displayName: r.id,
        createdAt: r.created ? new Date(r.created * 1000) : undefined,
        capabilities: inferCapabilities(r.id),
        raw: r,
      }));
  },
};
