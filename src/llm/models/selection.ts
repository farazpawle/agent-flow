/**
 * Selection strategies (Group 14.3).
 *
 * Pure functions over `ModelInfo[]`. Each strategy is allowed to
 * return `undefined` when the list contains no eligible model —
 * the registry (`registry.ts`) treats that as "fall through to env
 * fallback then MODEL_UNAVAILABLE" per plan §4.6 step 6.
 *
 * Capability heuristics use both provider-reported flags (when
 * present) and name-pattern fallbacks. Pattern fallbacks live here
 * intentionally — name fragments like `code` / `reasoner` are family
 * suffixes, not concrete model ids, so they don't trip the
 * `audit-hardcoded-models` script.
 */

import { ValidationError } from "../../utils/errors.js";
import type { ModelInfo } from "./types.js";

export const SELECTION_STRATEGIES = [
  "manual",
  "latest_code",
  "latest_reasoning",
  "cheapest",
  "fastest",
] as const;

export type SelectionStrategy = (typeof SELECTION_STRATEGIES)[number];

export function isSelectionStrategy(v: string): v is SelectionStrategy {
  return (SELECTION_STRATEGIES as readonly string[]).includes(v);
}

const DEFAULT_MIN_CONTEXT_TOKENS = 32_768;

/**
 * Order: newest first when `createdAt` known; otherwise lexicographic
 * descending on `id` as a stable secondary key (newer model ids
 * usually sort higher).
 */
function byNewest(a: ModelInfo, b: ModelInfo): number {
  const ta = a.createdAt?.getTime();
  const tb = b.createdAt?.getTime();
  if (ta !== undefined && tb !== undefined) return tb - ta;
  if (ta !== undefined) return -1;
  if (tb !== undefined) return 1;
  return b.id.localeCompare(a.id);
}

function isCoding(m: ModelInfo): boolean {
  if (m.capabilities?.coding === true) return true;
  const lower = m.id.toLowerCase();
  return (
    /\bcode|coder\b/.test(lower) ||
    lower.includes("-code-") ||
    lower.endsWith("-code") ||
    lower.includes("/code")
  );
}

function isReasoning(m: ModelInfo): boolean {
  if (m.capabilities?.reasoning === true) return true;
  const lower = m.id.toLowerCase();
  return (
    lower.includes("reasoner") ||
    lower.includes("thinking") ||
    lower.includes("reasoning") ||
    /(?:^|[^a-z])o[0-9](?:[^a-z]|$)/.test(lower)
  );
}

function totalPrice(m: ModelInfo): number | undefined {
  const input = m.pricing?.inputPer1M;
  const output = m.pricing?.outputPer1M;
  if (input === undefined && output === undefined) return undefined;
  return (input ?? 0) + (output ?? 0);
}

/** Find latest model where `predicate(m)` is true. */
function pickLatestMatching(
  models: ModelInfo[],
  predicate: (m: ModelInfo) => boolean
): ModelInfo | undefined {
  return models.filter(predicate).sort(byNewest)[0];
}

export function selectLatestCode(models: ModelInfo[]): ModelInfo | undefined {
  return pickLatestMatching(models, isCoding) ?? models.slice().sort(byNewest)[0];
}

export function selectLatestReasoning(models: ModelInfo[]): ModelInfo | undefined {
  return pickLatestMatching(models, isReasoning);
}

export interface CheapestOptions {
  /** Minimum context window the picked model must satisfy. Defaults to 32k. */
  minContextTokens?: number;
}

export function selectCheapest(
  models: ModelInfo[],
  opts: CheapestOptions = {}
): ModelInfo | undefined {
  const minCtx = opts.minContextTokens ?? DEFAULT_MIN_CONTEXT_TOKENS;
  const eligible = models.filter((m) => {
    if (m.contextLength !== undefined && m.contextLength < minCtx) return false;
    return totalPrice(m) !== undefined;
  });
  return eligible.sort((a, b) => (totalPrice(a) ?? Infinity) - (totalPrice(b) ?? Infinity))[0];
}

export function selectFastest(models: ModelInfo[]): ModelInfo | undefined {
  // Prefer providers' explicit latency tier (lower = faster).
  const ranked = models.slice().sort((a, b) => {
    const la = a.capabilities?.latencyTier;
    const lb = b.capabilities?.latencyTier;
    if (la !== undefined && lb !== undefined) return la - lb;
    if (la !== undefined) return -1;
    if (lb !== undefined) return 1;
    // Heuristic fallback: "smaller" models (shorter ids, contains "mini"/"flash"/"haiku"/"nano") are usually faster.
    const fastA = /mini|flash|haiku|nano|small|turbo/i.test(a.id);
    const fastB = /mini|flash|haiku|nano|small|turbo/i.test(b.id);
    if (fastA && !fastB) return -1;
    if (fastB && !fastA) return 1;
    return a.id.length - b.id.length;
  });
  return ranked[0];
}

export interface SelectOptions {
  /** Concrete model id supplied by the caller (used by `manual`). */
  preferredId?: string;
  cheapest?: CheapestOptions;
}

/**
 * Dispatcher used by the registry. `manual` requires `preferredId`
 * and verifies it appears in the list; otherwise the caller gets
 * `ValidationError` so the resolver knows to fall through to
 * env/MODEL_UNAVAILABLE.
 */
export function selectByStrategy(
  models: ModelInfo[],
  strategy: SelectionStrategy,
  opts: SelectOptions = {}
): ModelInfo | undefined {
  switch (strategy) {
    case "manual": {
      if (!opts.preferredId) {
        throw new ValidationError(
          "manual selection strategy requires a preferredId (env LLM_MODEL or DB llm_settings.model)"
        );
      }
      return models.find((m) => m.id === opts.preferredId);
    }
    case "latest_code":
      return selectLatestCode(models);
    case "latest_reasoning":
      return selectLatestReasoning(models);
    case "cheapest":
      return selectCheapest(models, opts.cheapest);
    case "fastest":
      return selectFastest(models);
  }
}
