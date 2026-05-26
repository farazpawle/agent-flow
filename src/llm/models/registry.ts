/**
 * Model resolution registry (Group 14.4).
 *
 * Implements plan §4.6 step-by-step:
 *   1. `manual` + `LLM_MODEL` set → use that id directly.
 *   2. Otherwise fetch the provider's model list (cache or live).
 *   3. Apply the selection strategy.
 *   4. (Group 15 concern.) Validate the model supports the call mode
 *      needed — recorded here as `requestedCapabilities` so callers
 *      can re-pick if the chosen model fails them.
 *   5. Return `{provider, model, selectionStrategy, modelListAge}` for
 *      the workflow_steps audit row (plan §14.5).
 *   6. On fetch failure: serve stale cache (handled inside
 *      `ModelCache.getModels`); if no cache, fall through to
 *      `LLM_MODEL` env when set; otherwise throw `MODEL_UNAVAILABLE`.
 */

import { ExternalServiceError, ValidationError } from "../../utils/errors.js";
import { applyEnvironmentAliases } from "../../utils/envConfig.js";
import type { SupportedProvider } from "../provider.js";
import { modelCache, ModelCache } from "./cache.js";
import { anthropicFetcher } from "./fetchers/anthropic.js";
import { deepseekFetcher } from "./fetchers/deepseek.js";
import { openaiFetcher } from "./fetchers/openai.js";
import { openrouterFetcher } from "./fetchers/openrouter.js";
import {
  isSelectionStrategy,
  selectByStrategy,
  SELECTION_STRATEGIES,
  type SelectionStrategy,
} from "./selection.js";
import type { ModelFetcher } from "./types.js";

export const MODEL_UNAVAILABLE_CODE = "MODEL_UNAVAILABLE" as const;

export const DEFAULT_SELECTION_STRATEGY: SelectionStrategy = "latest_code";

const FETCHERS: Record<Exclude<SupportedProvider, "none">, ModelFetcher> = {
  openai: openaiFetcher,
  anthropic: anthropicFetcher,
  openrouter: openrouterFetcher,
  deepseek: deepseekFetcher,
};

export interface ResolveModelInput {
  provider: SupportedProvider;
  /** Explicit per-call override. When omitted, env/DB-derived value applies. */
  preferredModel?: string;
  /** Explicit per-call strategy override. */
  strategy?: SelectionStrategy;
  /** Test seam — defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Test seam — defaults to module-singleton `modelCache`. */
  cache?: ModelCache;
}

export interface ResolveModelResult {
  provider: SupportedProvider;
  /** Concrete model id passed to `LlmProvider.generateText({ model })`. */
  model: string;
  selectionStrategy: SelectionStrategy;
  /** Age of the model list snapshot in ms (0 = fresh fetch, negative = served from env fallback / no list). */
  modelListAge: number;
  /** True when the chosen id never appeared in the live/cached list (env-fallback path). */
  fromEnvFallback?: boolean;
  /** True when the model list served came from a stale cache after a refetch failure. */
  servedStale?: boolean;
}

function resolveStrategy(env: NodeJS.ProcessEnv, override?: SelectionStrategy): SelectionStrategy {
  if (override) return override;
  const raw = env.LLM_SELECTION_STRATEGY?.trim();
  if (raw) {
    if (!isSelectionStrategy(raw)) {
      throw new ValidationError(`Unknown LLM_SELECTION_STRATEGY value '${raw}'`, {
        hint: `Allowed values: ${SELECTION_STRATEGIES.join(", ")}`,
      });
    }
    return raw;
  }
  return DEFAULT_SELECTION_STRATEGY;
}

function pickFetcher(provider: SupportedProvider): ModelFetcher {
  if (provider === "none") {
    throw new ValidationError("Cannot resolve a model for the 'none' provider", {
      hint: "Set LLM_PROVIDER to openai | anthropic | openrouter | deepseek first.",
    });
  }
  return FETCHERS[provider];
}

/**
 * Resolve `{provider, model, selectionStrategy, modelListAge}` for a
 * single LLM call. Group 15's `workflow_run(mode=agent)` calls this
 * before each provider invocation and threads the result into the
 * workflow_steps audit row.
 */
export async function resolveModelForCall(input: ResolveModelInput): Promise<ResolveModelResult> {
  const env = input.env ?? process.env;
  applyEnvironmentAliases(env);
  const cache = input.cache ?? modelCache;
  const strategy = resolveStrategy(env, input.strategy);
  const envModel = input.preferredModel ?? env.LLM_MODEL?.trim() ?? undefined;

  // §4.6 step 1: manual + concrete id → short-circuit.
  if (strategy === "manual" && envModel) {
    return {
      provider: input.provider,
      model: envModel,
      selectionStrategy: "manual",
      modelListAge: -1,
      fromEnvFallback: true,
    };
  }

  const fetcher = pickFetcher(input.provider);

  // §4.6 step 2-3: fetch (cached or live) + apply strategy.
  let list;
  try {
    list = await cache.getModels(fetcher, { env });
  } catch (fetchErr) {
    // §4.6 step 6 fallback: no cache available → env fallback → MODEL_UNAVAILABLE.
    if (envModel) {
      return {
        provider: input.provider,
        model: envModel,
        selectionStrategy: strategy,
        modelListAge: -1,
        fromEnvFallback: true,
      };
    }
    throw new ExternalServiceError(`No model available for provider '${input.provider}'`, {
      cause: fetchErr,
      details: {
        code: MODEL_UNAVAILABLE_CODE,
        provider: input.provider,
        strategy,
      },
    });
  }

  const chosen = selectByStrategy(list.models, strategy, { preferredId: envModel });
  if (chosen) {
    return {
      provider: input.provider,
      model: chosen.id,
      selectionStrategy: strategy,
      modelListAge: Date.now() - list.fetchedAt.getTime(),
      servedStale: list.servedStale,
    };
  }

  // Strategy returned nothing. Try env fallback before declaring unavailable.
  if (envModel) {
    return {
      provider: input.provider,
      model: envModel,
      selectionStrategy: strategy,
      modelListAge: Date.now() - list.fetchedAt.getTime(),
      fromEnvFallback: true,
      servedStale: list.servedStale,
    };
  }

  throw new ExternalServiceError(
    `No model available for provider '${input.provider}' under strategy '${strategy}'`,
    {
      details: {
        code: MODEL_UNAVAILABLE_CODE,
        provider: input.provider,
        strategy,
        listSize: list.models.length,
      },
    }
  );
}

/**
 * Lookup helper for the Group 16 routes — returns the cached model
 * list for a provider, refetching if expired. Throws when the fetcher
 * fails and no cache exists.
 */
export async function getProviderModels(
  provider: SupportedProvider,
  opts: { env?: NodeJS.ProcessEnv; cache?: ModelCache } = {}
) {
  const cache = opts.cache ?? modelCache;
  const fetcher = pickFetcher(provider);
  return cache.getModels(fetcher, { env: opts.env });
}

/**
 * Force-refresh helper for `POST /api/llm/model/refresh` (Group 16).
 */
export async function refreshProviderModels(
  provider: SupportedProvider,
  opts: { env?: NodeJS.ProcessEnv; cache?: ModelCache } = {}
) {
  const cache = opts.cache ?? modelCache;
  const fetcher = pickFetcher(provider);
  return cache.refresh(fetcher);
}
