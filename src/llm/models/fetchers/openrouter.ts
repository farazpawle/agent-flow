/**
 * OpenRouter model-list fetcher (Group 14.1).
 *
 * OpenRouter exposes the richest model catalogue of any provider —
 * capabilities, context length, per-token pricing, modality. We
 * normalise everything into `ModelInfo` so the selection strategies
 * can pick on price/latency without provider-specific branches.
 *
 * No API key required for the public model list (`/api/v1/models`),
 * which is convenient for the GUI Settings panel populating the model
 * selector before the user has supplied a key.
 */

import { ExternalServiceError } from "../../../utils/errors.js";
import type { ModelFetcher, ModelInfo } from "../types.js";

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";

interface OpenRouterModelRow {
  id: string;
  name?: string;
  created?: number; // unix seconds
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    instruct_type?: string;
  };
  top_provider?: {
    max_completion_tokens?: number;
  };
  pricing?: {
    /** USD per token, as a string. */
    prompt?: string;
    completion?: string;
  };
  supported_parameters?: string[];
}

/**
 * OpenRouter reports pricing as USD per token, not per 1M tokens.
 * Convert at parse time so the selection strategies don't have to
 * know about the unit.
 */
function parsePricing(row: OpenRouterModelRow): ModelInfo["pricing"] | undefined {
  const promptStr = row.pricing?.prompt;
  const completionStr = row.pricing?.completion;
  if (promptStr === undefined && completionStr === undefined) return undefined;
  const inputPer1M = promptStr !== undefined ? Number(promptStr) * 1_000_000 : undefined;
  const outputPer1M = completionStr !== undefined ? Number(completionStr) * 1_000_000 : undefined;
  return {
    ...(inputPer1M !== undefined && Number.isFinite(inputPer1M) ? { inputPer1M } : {}),
    ...(outputPer1M !== undefined && Number.isFinite(outputPer1M) ? { outputPer1M } : {}),
  };
}

function inferCapabilities(row: OpenRouterModelRow): ModelInfo["capabilities"] {
  const id = row.id.toLowerCase();
  const supports = row.supported_parameters ?? [];
  return {
    chat: row.architecture?.output_modalities?.includes("text") ?? true,
    reasoning:
      id.includes("reasoner") ||
      id.includes("thinking") ||
      /(?:^|[^a-z])o[0-9](?:[^a-z]|$)/.test(id) ||
      undefined,
    coding: id.includes("code") || id.includes("coder") || undefined,
    structuredOutput:
      supports.includes("response_format") || supports.includes("structured_outputs") || undefined,
    tools: supports.includes("tools") || undefined,
  };
}

export const openrouterFetcher: ModelFetcher = {
  provider: "openrouter",
  async fetchModels({ apiKey, baseURL } = {}) {
    const url = `${baseURL ?? process.env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL}/models`;
    // Public endpoint — auth header is optional but free-tier rate-limits are
    // friendlier when the key is supplied.
    const headers: Record<string, string> = {};
    const key = apiKey ?? process.env.OPENROUTER_API_KEY;
    if (key) headers.Authorization = `Bearer ${key}`;

    let resp: Response;
    try {
      resp = await fetch(url, { headers });
    } catch (err) {
      throw new ExternalServiceError(
        `OpenRouter model-list fetch failed: ${(err as Error).message}`,
        { cause: err, details: { provider: "openrouter", url } }
      );
    }
    if (!resp.ok) {
      throw new ExternalServiceError(`OpenRouter model-list returned HTTP ${resp.status}`, {
        details: { provider: "openrouter", status: resp.status },
      });
    }
    const body = (await resp.json()) as { data?: OpenRouterModelRow[] };
    const rows = body.data ?? [];

    return rows.map<ModelInfo>((r) => ({
      id: r.id,
      provider: "openrouter",
      displayName: r.name ?? r.id,
      createdAt: r.created ? new Date(r.created * 1000) : undefined,
      contextLength: r.context_length,
      maxOutputTokens: r.top_provider?.max_completion_tokens,
      pricing: parsePricing(r),
      capabilities: inferCapabilities(r),
      raw: r,
    }));
  },
};
