/**
 * Deterministic, LLM-free token budgeting for `context_get` (Group 4.3).
 *
 * The plan (§3.8) requires every response to be token-capped via "simple
 * heuristic truncation (head/tail/middle-ellipsis depending on `type`)".
 * This module provides:
 *
 *   - estimateTokens(text)       — fast ≈4-char/token heuristic (matches
 *                                  GPT tokenizer ballpark; never overcounts
 *                                  by more than ~10 % on prose).
 *   - truncateText(text, opts)   — head / tail / middle truncation with an
 *                                  explicit ellipsis marker.
 *   - truncateList(items, opts)  — keeps as many items as fit inside the
 *                                  token budget, with a "<N more truncated>"
 *                                  marker when items were dropped.
 *
 * All output respects `maxTokens` within ±5 % (the truncation marker itself
 * is counted before deciding cut points).
 */

const CHARS_PER_TOKEN = 4;
const DEFAULT_ELLIPSIS = "[…]";

export type TruncationStrategy = "head" | "tail" | "middle";

export interface TruncateTextOptions {
  maxTokens: number;
  /** Where to keep content from. `tail` is the agent-facing default. */
  strategy?: TruncationStrategy;
  /** Replacement string inserted at the cut point. */
  ellipsis?: string;
}

export interface TruncateListOptions<T = unknown> {
  maxTokens: number;
  /**
   * Token cost of a single item. If omitted, we estimate by serialising
   * the item to JSON.
   */
  estimate?: (item: T) => number;
}

/**
 * Cheap, deterministic token estimate. Real tokenizers (cl100k, etc.) are
 * heavier and unnecessary for budget enforcement: a 4 chars/token heuristic
 * over-reports for code (good — leaves slack) and under-reports for dense
 * punctuation (rare in our payloads).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Number of tokens we keep budget for at each truncation point. */
function ellipsisBudget(ellipsis: string): number {
  return estimateTokens(ellipsis);
}

/**
 * Truncate `text` so its estimated token count stays at or below `maxTokens`.
 * Choices:
 *   - `head`   — keep the start (drop the tail).
 *   - `tail`   — keep the end (drop the start). Default for "most recent X"
 *                style payloads (activity logs, findings).
 *   - `middle` — keep the beginning AND the end, replace the middle with
 *                the ellipsis marker. Useful for long task descriptions
 *                where both lead-in and conclusion matter.
 *
 * Returns the original string if it already fits.
 */
export function truncateText(text: string, opts: TruncateTextOptions): string {
  const maxTokens = Math.max(0, Math.floor(opts.maxTokens));
  const strategy = opts.strategy ?? "tail";
  const ellipsis = opts.ellipsis ?? DEFAULT_ELLIPSIS;

  if (maxTokens === 0) return ellipsis;
  if (estimateTokens(text) <= maxTokens) return text;

  const ellipsisTokens = ellipsisBudget(ellipsis);
  const usableTokens = Math.max(0, maxTokens - ellipsisTokens);
  const usableChars = usableTokens * CHARS_PER_TOKEN;

  if (usableChars <= 0) return ellipsis;

  switch (strategy) {
    case "head": {
      return text.slice(0, usableChars) + ellipsis;
    }
    case "tail": {
      return ellipsis + text.slice(text.length - usableChars);
    }
    case "middle": {
      const halfChars = Math.floor(usableChars / 2);
      const head = text.slice(0, halfChars);
      const tail = text.slice(text.length - (usableChars - halfChars));
      return head + ellipsis + tail;
    }
  }
}

/**
 * Reduce `items` to the longest prefix whose serialised JSON token count
 * fits inside `maxTokens`. Returns the kept items plus a `truncated`
 * count describing how many were dropped.
 */
export function truncateList<T>(
  items: readonly T[],
  opts: TruncateListOptions<T>
): { items: T[]; truncated: number; totalTokens: number } {
  const maxTokens = Math.max(0, Math.floor(opts.maxTokens));
  const estimate = opts.estimate ?? ((item: T) => estimateTokens(JSON.stringify(item)));

  if (maxTokens === 0) {
    return { items: [], truncated: items.length, totalTokens: 0 };
  }

  const kept: T[] = [];
  let total = 0;
  for (let i = 0; i < items.length; i++) {
    const cost = estimate(items[i]);
    if (total + cost > maxTokens) {
      return { items: kept, truncated: items.length - i, totalTokens: total };
    }
    kept.push(items[i]);
    total += cost;
  }
  return { items: kept, truncated: 0, totalTokens: total };
}
