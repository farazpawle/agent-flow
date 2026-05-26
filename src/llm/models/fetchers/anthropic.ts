/**
 * Anthropic model-list fetcher (Group 14.1).
 *
 * Anthropic's `GET https://api.anthropic.com/v1/models` endpoint
 * (announced late 2024) returns the live model catalogue. We use it
 * directly rather than the plan's original "static list from SDK"
 * fallback so the discovery path stays consistent across providers and
 * audit-hardcoded-models stays green.
 *
 * If the API key isn't configured the fetcher throws — the cache layer
 * then has to decide between a stale snapshot and a hard fail. The
 * GUI Settings panel (Group 17) is the typical consumer; until a key
 * is present the model selector simply shows "no providers configured".
 */

import { ExternalServiceError } from "../../../utils/errors.js";
import type { ModelFetcher, ModelInfo } from "../types.js";

const ANTHROPIC_DEFAULT_BASE_URL = "https://api.anthropic.com/v1";
const ANTHROPIC_API_VERSION = "2023-06-01";

function inferCapabilities(id: string): ModelInfo["capabilities"] {
  const lower = id.toLowerCase();
  return {
    chat: true,
    reasoning: lower.includes("opus") || lower.includes("sonnet") || undefined,
    coding: lower.includes("sonnet") || undefined,
    structuredOutput: true,
    tools: true,
  };
}

export const anthropicFetcher: ModelFetcher = {
  provider: "anthropic",
  async fetchModels({ apiKey, baseURL } = {}) {
    const key = apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new ExternalServiceError(
        "ANTHROPIC_API_KEY not set — cannot fetch Anthropic model list",
        { details: { provider: "anthropic" } }
      );
    }

    const url = `${baseURL ?? ANTHROPIC_DEFAULT_BASE_URL}/models`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        headers: {
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
      });
    } catch (err) {
      throw new ExternalServiceError(
        `Anthropic model-list fetch failed: ${(err as Error).message}`,
        { cause: err, details: { provider: "anthropic", url } }
      );
    }
    if (!resp.ok) {
      throw new ExternalServiceError(`Anthropic model-list returned HTTP ${resp.status}`, {
        details: { provider: "anthropic", status: resp.status },
      });
    }
    const body = (await resp.json()) as {
      data?: Array<{ id: string; display_name?: string; created_at?: string }>;
    };
    const rows = body.data ?? [];

    return rows.map<ModelInfo>((r) => ({
      id: r.id,
      provider: "anthropic",
      displayName: r.display_name ?? r.id,
      createdAt: r.created_at ? new Date(r.created_at) : undefined,
      capabilities: inferCapabilities(r.id),
      raw: r,
    }));
  },
};
