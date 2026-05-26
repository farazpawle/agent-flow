/**
 * Public surface of the Phase 2 model-discovery layer (Group 14).
 *
 * Group 15 workflows and the Group 16 HTTP routes both import from
 * here; nothing else in the codebase should reach into the per-fetcher
 * files directly.
 */

export type {
  ModelInfo,
  ModelList,
  ModelFetcher,
  ModelPricing,
  ModelCapabilities,
} from "./types.js";
export {
  SELECTION_STRATEGIES,
  isSelectionStrategy,
  selectByStrategy,
  selectCheapest,
  selectFastest,
  selectLatestCode,
  selectLatestReasoning,
  type SelectionStrategy,
  type SelectOptions,
  type CheapestOptions,
} from "./selection.js";

export { ModelCache, modelCache } from "./cache.js";

export {
  resolveModelForCall,
  getProviderModels,
  refreshProviderModels,
  MODEL_UNAVAILABLE_CODE,
  DEFAULT_SELECTION_STRATEGY,
  type ResolveModelInput,
  type ResolveModelResult,
} from "./registry.js";

export { recordLlmCall, withLlmTelemetry, type LlmCallRecord } from "./telemetry.js";

export { openaiFetcher } from "./fetchers/openai.js";
export { anthropicFetcher } from "./fetchers/anthropic.js";
export { openrouterFetcher } from "./fetchers/openrouter.js";
export { deepseekFetcher } from "./fetchers/deepseek.js";
