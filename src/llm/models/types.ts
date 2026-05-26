/**
 * Shared types for model discovery & selection (Phase 2 — Group 14).
 *
 * Plan §4.6: provider model lists change constantly (OpenRouter pushes
 * weekly), so concrete IDs must never be baked into `src/llm/**`. This
 * module defines the normalised shape every fetcher emits so the
 * selection strategies (`src/llm/models/selection.ts`) can operate on
 * a uniform structure.
 */

import type { SupportedProvider } from "../provider.js";

export interface ModelPricing {
  /** USD per 1 million input tokens. */
  inputPer1M?: number;
  /** USD per 1 million output tokens. */
  outputPer1M?: number;
}

export interface ModelCapabilities {
  /** Standard chat / completion. Default true unless the provider says otherwise. */
  chat?: boolean;
  /** Marked by the provider as a reasoning-class model (e.g. OpenAI o-series, DeepSeek reasoner). */
  reasoning?: boolean;
  /** Marked / inferable as coding-tuned (name contains `code`/`coder`, or provider flags). */
  coding?: boolean;
  /** Supports tool calling. */
  tools?: boolean;
  /** Supports structured output / JSON schema. */
  structuredOutput?: boolean;
  /** Latency tier reported by the provider (lower = faster). Used by the `fastest` strategy. */
  latencyTier?: number;
}

/**
 * Normalised model row used by selection and the GUI panel. Optional
 * fields stay optional because no provider reports every dimension; the
 * selection strategy degrades gracefully when fields are missing.
 */
export interface ModelInfo {
  /** Provider-side model id passed to `LlmProvider.generateText({ model })`. */
  id: string;
  /** Owning provider — kept on the row so cross-provider lists (e.g. OpenRouter aggregations) remain unambiguous. */
  provider: SupportedProvider;
  /** Human-readable label for the GUI selector. */
  displayName?: string;
  /** Creation/release timestamp from the provider; drives "latest" sorting. */
  createdAt?: Date;
  /** Maximum context window in tokens. */
  contextLength?: number;
  /** Maximum output tokens, when reported separately. */
  maxOutputTokens?: number;
  pricing?: ModelPricing;
  capabilities?: ModelCapabilities;
  /** Raw provider payload kept for the GUI's "details" pane and for debugging. */
  raw?: unknown;
}

/**
 * Snapshot returned by the cache. `fetchedAt` lets the resolver compute
 * `modelListAge` for the workflow_steps audit row (plan §14.5).
 */
export interface ModelList {
  provider: SupportedProvider;
  models: ModelInfo[];
  fetchedAt: Date;
  /** True when the fetch failed and we served a stale cache instead. */
  servedStale?: boolean;
}

/**
 * Adapter contract: one implementation per provider in
 * `src/llm/models/fetchers/*.ts`. `fetchModels` is responsible for the
 * HTTP call and the normalisation; the cache wrapper handles TTL and
 * fallback semantics.
 */
export interface ModelFetcher {
  readonly provider: SupportedProvider;
  fetchModels(opts: { apiKey?: string; baseURL?: string }): Promise<ModelInfo[]>;
}
