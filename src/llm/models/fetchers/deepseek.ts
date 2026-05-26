/**
 * DeepSeek model-list fetcher (Group 14.1).
 *
 * Hits `GET https://api.deepseek.com/models` — the OpenAI-compatible
 * shape (`{ data: [{ id, created, owned_by }] }`). Capabilities are
 * inferred from the id (the `reasoner` family is reasoning-class, the
 * `coder` family is coding-tuned).
 *
 * DeepSeek does not return pricing through the model list; the
 * `cheapest` strategy degrades to "first available" for DeepSeek.
 */

import { ExternalServiceError } from "../../../utils/errors.js";
import type { ModelFetcher, ModelInfo } from "../types.js";

const DEEPSEEK_DEFAULT_BASE_URL = "https://api.deepseek.com";

function inferCapabilities(id: string): ModelInfo["capabilities"] {
  const lower = id.toLowerCase();
  return {
    chat: true,
    reasoning: lower.includes("reasoner") || lower.includes("reasoning") || undefined,
    coding: lower.includes("coder") || lower.includes("code") || undefined,
    structuredOutput: true,
    tools: true,
  };
}

export const deepseekFetcher: ModelFetcher = {
  provider: "deepseek",
  async fetchModels({ apiKey, baseURL } = {}) {
    const key = apiKey ?? process.env.DEEPSEEK_API_KEY;
    if (!key) {
      throw new ExternalServiceError(
        "DEEPSEEK_API_KEY not set — cannot fetch DeepSeek model list",
        { details: { provider: "deepseek" } }
      );
    }

    const url = `${baseURL ?? process.env.DEEPSEEK_BASE_URL ?? DEEPSEEK_DEFAULT_BASE_URL}/models`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
      });
    } catch (err) {
      throw new ExternalServiceError(
        `DeepSeek model-list fetch failed: ${(err as Error).message}`,
        { cause: err, details: { provider: "deepseek", url } }
      );
    }
    if (!resp.ok) {
      throw new ExternalServiceError(`DeepSeek model-list returned HTTP ${resp.status}`, {
        details: { provider: "deepseek", status: resp.status },
      });
    }
    const body = (await resp.json()) as {
      data?: Array<{ id: string; created?: number; owned_by?: string }>;
    };
    const rows = body.data ?? [];

    return rows.map<ModelInfo>((r) => ({
      id: r.id,
      provider: "deepseek",
      displayName: r.id,
      createdAt: r.created ? new Date(r.created * 1000) : undefined,
      capabilities: inferCapabilities(r.id),
      raw: r,
    }));
  },
};
