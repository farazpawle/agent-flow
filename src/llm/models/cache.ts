/**
 * Per-provider TTL cache for model lists (Group 14.2).
 *
 * Map keyed by provider id. Each entry stores `{models, fetchedAt}`.
 * `getModels(fetcher)` reads from cache and returns immediately when
 * still fresh; otherwise it refetches. On fetch failure we serve the
 * stale entry with `servedStale=true` so the registry (Group 14.4)
 * can decide whether to surface a degraded result or hard-fail.
 *
 * The cache is a module-level singleton so the GUI Settings panel's
 * "refresh" button (Group 16's `POST /api/llm/model/refresh`) hits the
 * same instance the workflow runner reads.
 */

import { logger } from "../../utils/logger.js";
import type { SupportedProvider } from "../provider.js";
import type { ModelFetcher, ModelInfo, ModelList } from "./types.js";

interface CacheEntry {
  models: ModelInfo[];
  fetchedAt: Date;
}

const DEFAULT_TTL_HOURS = 24;

function ttlMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.LLM_MODEL_REFRESH_TTL_HOURS?.trim();
  const hours = raw ? Number(raw) : NaN;
  const resolved = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_TTL_HOURS;
  return resolved * 60 * 60 * 1000;
}

/**
 * Per-process cache. Exposed as a class so tests can spin up isolated
 * instances; the production code uses the `modelCache` singleton.
 */
export class ModelCache {
  private readonly store = new Map<SupportedProvider, CacheEntry>();

  /**
   * Return the cached list for `provider`, refetching via `fetcher`
   * when the entry is missing or expired. On fetch failure: if a
   * stale entry exists, serve it with `servedStale=true`; otherwise
   * propagate the original error.
   */
  async getModels(
    fetcher: ModelFetcher,
    opts: { apiKey?: string; baseURL?: string; env?: NodeJS.ProcessEnv } = {}
  ): Promise<ModelList> {
    const env = opts.env ?? process.env;
    const entry = this.store.get(fetcher.provider);
    const now = Date.now();
    if (entry && now - entry.fetchedAt.getTime() < ttlMs(env)) {
      return {
        provider: fetcher.provider,
        models: entry.models,
        fetchedAt: entry.fetchedAt,
      };
    }

    try {
      const models = await fetcher.fetchModels({ apiKey: opts.apiKey, baseURL: opts.baseURL });
      const fetchedAt = new Date();
      this.store.set(fetcher.provider, { models, fetchedAt });
      return { provider: fetcher.provider, models, fetchedAt };
    } catch (err) {
      if (entry) {
        logger.warn(
          { provider: fetcher.provider, err: (err as Error).message },
          "Model list fetch failed — serving stale cache"
        );
        return {
          provider: fetcher.provider,
          models: entry.models,
          fetchedAt: entry.fetchedAt,
          servedStale: true,
        };
      }
      throw err;
    }
  }

  /**
   * Force a refetch ignoring TTL. Used by `POST /api/llm/model/refresh`
   * (Group 16). On failure the cache entry is left untouched and the
   * error propagates.
   */
  async refresh(
    fetcher: ModelFetcher,
    opts: { apiKey?: string; baseURL?: string } = {}
  ): Promise<ModelList> {
    const models = await fetcher.fetchModels(opts);
    const fetchedAt = new Date();
    this.store.set(fetcher.provider, { models, fetchedAt });
    return { provider: fetcher.provider, models, fetchedAt };
  }

  /** Tests use this between cases to avoid cross-pollution. */
  clear(provider?: SupportedProvider): void {
    if (provider) this.store.delete(provider);
    else this.store.clear();
  }

  /** Exposes the cached entry without triggering a fetch — used by tests. */
  peek(provider: SupportedProvider): CacheEntry | undefined {
    return this.store.get(provider);
  }
}

export const modelCache = new ModelCache();
