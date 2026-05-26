/**
 * Public surface of the Phase-2 LLM provider layer.
 *
 * Group 15 workflows import from here; Group 16 HTTP routes consume
 * `resolveLlmConfig` for the `GET /api/llm/settings` payload.
 */

export type {
  LlmProvider,
  LlmCallCommon,
  LlmGenerateObjectInput,
  LlmGenerateObjectResult,
  LlmGenerateTextInput,
  LlmGenerateTextResult,
  LlmUsage,
  SupportedProvider,
} from "./provider.js";
export { SUPPORTED_PROVIDERS, isSupportedProvider } from "./provider.js";

export {
  createLlmProvider,
  resolveLlmConfig,
  type CreateLlmProviderOptions,
  type ResolvedLlmConfig,
  type ResolveLlmConfigOptions,
} from "./factory.js";

export { PROVIDER_NOT_CONFIGURED_CODE } from "./providers/none.js";

// Group 14 — model discovery, selection, and per-call telemetry.
export {
  // types
  type ModelInfo,
  type ModelList,
  type ModelFetcher,
  type ModelPricing,
  type ModelCapabilities,
  type SelectionStrategy,
  type ResolveModelInput,
  type ResolveModelResult,
  type LlmCallRecord,
  // values
  SELECTION_STRATEGIES,
  isSelectionStrategy,
  selectByStrategy,
  ModelCache,
  modelCache,
  resolveModelForCall,
  getProviderModels,
  refreshProviderModels,
  recordLlmCall,
  withLlmTelemetry,
  MODEL_UNAVAILABLE_CODE,
  DEFAULT_SELECTION_STRATEGY,
  openaiFetcher,
  anthropicFetcher,
  openrouterFetcher,
  deepseekFetcher,
} from "./models/index.js";
