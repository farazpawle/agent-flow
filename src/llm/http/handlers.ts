/**
 * Pure handlers for the `/api/llm/*` routes (Phase 2 Group 16).
 *
 * Each handler takes the inputs it needs (env, db) and returns the body
 * to ship. Side-effect-free apart from DB calls. The Express glue in
 * `src/index.ts` wires them up; tests exercise the handlers directly
 * without spinning a server.
 *
 * **Security invariants (plan §16.2):**
 *   - API keys are NEVER persisted (the DB column doesn't exist).
 *   - API keys are NEVER echoed in responses. `getProvidersStatus`
 *     returns a boolean `keyConfigured` flag per provider — not the key
 *     itself.
 *   - `LLM_CONFIG_LOCK=true` makes settings effectively read-only;
 *     `assertConfigUnlocked` raises `ForbiddenError` (plan §16.5).
 */

import { applyEnvironmentAliases } from "../../utils/envConfig.js";
import { DatabaseError, ForbiddenError, ValidationError } from "../../utils/errors.js";
import type { DatabaseAdapter, LlmSettings } from "../../models/interfaces.js";
import { resolveLlmConfig, type ResolvedLlmConfig } from "../factory.js";
import { getProviderModels, refreshProviderModels } from "../models/registry.js";
import { SUPPORTED_PROVIDERS, type SupportedProvider } from "../provider.js";
import type { ModelList } from "../models/types.js";
import type { LlmSettingsBody } from "./schemas.js";

/** Env var name a given provider reads its API key from. */
const PROVIDER_KEY_ENV: Record<Exclude<SupportedProvider, "none">, string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  // @hardcoded-model-allowed: env var name, not a model id
  deepseek: "DEEPSEEK_API_KEY",
};

export interface ProviderStatus {
  provider: SupportedProvider;
  keyConfigured: boolean;
  /** The env var name the key would be read from, for GUI hints. */
  keyEnv: string | null;
}

export interface ProvidersStatusResponse {
  providers: ProviderStatus[];
  /** Set when LLM_CONFIG_LOCK=true — GUI uses this to disable the save button. */
  configLocked: boolean;
}

export interface LlmSettingsResponse {
  provider?: SupportedProvider;
  model?: string;
  selectionStrategy?: string;
  workflowMode?: string;
  providerSource: ResolvedLlmConfig["providerSource"];
  modelSource: ResolvedLlmConfig["modelSource"];
  configLocked: boolean;
  /** When the DB row was last updated; absent when no DB row exists yet. */
  updatedAt?: string;
}

export interface ProviderModelsResponse {
  provider: SupportedProvider;
  fetchedAt: string;
  /** Age of the snapshot in ms; >0 means served from cache. */
  ageMs: number;
  servedStale: boolean;
  models: ModelList["models"];
}

function readEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  applyEnvironmentAliases(env);
  return env;
}

function readBoolean(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.toLowerCase() === "true";
}

/**
 * Throws `ForbiddenError` when `LLM_CONFIG_LOCK=true`. Plan §16.5.
 * Exposed so both `POST /api/llm/settings` and the future GUI Settings
 * panel pre-check can use the same guard.
 */
export function assertConfigUnlocked(env: NodeJS.ProcessEnv = process.env): void {
  const e = readEnv(env);
  if (readBoolean(e, "LLM_CONFIG_LOCK")) {
    throw new ForbiddenError("LLM settings are administratively locked (LLM_CONFIG_LOCK=true).", {
      hint: "Unset LLM_CONFIG_LOCK or set it to false to persist new settings via the GUI.",
      details: { code: "LLM_CONFIG_LOCKED" },
    });
  }
}

/**
 * `GET /api/llm/providers` — which providers have an API key configured.
 * Returns booleans, never raw keys.
 */
export function getProvidersStatus(env: NodeJS.ProcessEnv = process.env): ProvidersStatusResponse {
  const e = readEnv(env);
  const providers: ProviderStatus[] = SUPPORTED_PROVIDERS.map((provider) => {
    if (provider === "none") {
      return { provider, keyConfigured: false, keyEnv: null };
    }
    const keyEnv = PROVIDER_KEY_ENV[provider];
    const value = e[keyEnv];
    const keyConfigured = typeof value === "string" && value.trim().length > 0;
    return { provider, keyConfigured, keyEnv };
  });
  return {
    providers,
    configLocked: readBoolean(e, "LLM_CONFIG_LOCK"),
  };
}

export interface GetLlmSettingsOptions {
  db?: DatabaseAdapter;
  env?: NodeJS.ProcessEnv;
}

/**
 * `GET /api/llm/settings` — effective settings + source labels.
 *
 * Plan §16.2 invariant: the response NEVER contains an API key field.
 * The provider/model/strategy/mode are surfaced with their `*Source`
 * indicators so the GUI can render "env" vs "DB" badges per field.
 */
export async function getLlmSettings(
  opts: GetLlmSettingsOptions = {}
): Promise<LlmSettingsResponse> {
  const env = readEnv(opts.env ?? process.env);
  const config = await resolveLlmConfig({ db: opts.db, env });

  let updatedAt: string | undefined;
  let dbSettings: LlmSettings | null = null;
  if (opts.db) {
    try {
      dbSettings = await opts.db.getLlmSettings();
      if (dbSettings?.updatedAt) {
        updatedAt = dbSettings.updatedAt.toISOString();
      }
    } catch {
      // Best-effort — getLlmSettings failures shouldn't break the
      // GET (the resolved config above is the load-bearing field).
    }
  }

  return {
    provider: config.provider,
    model: config.model,
    selectionStrategy: dbSettings?.selectionStrategy ?? env.LLM_SELECTION_STRATEGY?.trim(),
    workflowMode: dbSettings?.workflowMode ?? env.WORKFLOW_MODE?.trim(),
    providerSource: config.providerSource,
    modelSource: config.modelSource,
    configLocked: config.configLocked,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export interface SetLlmSettingsOptions {
  db: DatabaseAdapter;
  body: LlmSettingsBody;
  env?: NodeJS.ProcessEnv;
}

/**
 * `POST /api/llm/settings` — persist provider/model/strategy/mode.
 *
 * Pre-checks:
 *   - `LLM_CONFIG_LOCK=true` → `ForbiddenError` (16.5).
 *   - Body schema rejects API key fields entirely (16.2 — the schema
 *     uses `.strict()`).
 *
 * Returns the resolved effective settings AFTER the write so the GUI
 * can re-render the panel without a second round trip.
 */
export async function setLlmSettings(opts: SetLlmSettingsOptions): Promise<LlmSettingsResponse> {
  const env = readEnv(opts.env ?? process.env);
  assertConfigUnlocked(env);

  if (Object.keys(opts.body).length === 0) {
    throw new ValidationError("POST /api/llm/settings requires at least one field.", {
      hint: "Supply provider, model, selectionStrategy, or workflowMode (or `null` to clear).",
    });
  }

  // `null` means "clear"; `undefined` means "leave alone".  The
  // adapter currently treats `undefined` and `null` the same (writes
  // SQL NULL).  Preserve the GUI's distinction by reading current
  // settings first and merging.
  //
  // Tolerate a missing/uninitialised llm_settings table — that's a
  // common bootstrap state when the user runs Supabase without
  // applying scripts/supabase-remediation-3.sql yet. We treat the
  // read failure as "no current row" and let the subsequent write
  // attempt surface the real DB error with a hint.
  let current: Awaited<ReturnType<DatabaseAdapter["getLlmSettings"]>> = null;
  try {
    current = await opts.db.getLlmSettings();
  } catch {
    current = null;
  }
  const merged = {
    provider:
      opts.body.provider === undefined ? current?.provider : (opts.body.provider ?? undefined),
    model: opts.body.model === undefined ? current?.model : (opts.body.model ?? undefined),
    selectionStrategy:
      opts.body.selectionStrategy === undefined
        ? current?.selectionStrategy
        : (opts.body.selectionStrategy ?? undefined),
    workflowMode:
      opts.body.workflowMode === undefined
        ? current?.workflowMode
        : (opts.body.workflowMode ?? undefined),
  };

  try {
    await opts.db.setLlmSettings(merged);
  } catch (err) {
    // Most likely cause in practice: Supabase project doesn't have the
    // Phase-1 Group-1 schema applied yet (`llm_settings` table
    // missing). Surface that as a typed DatabaseError with a clear
    // hint pointing at the remediation script, instead of bubbling a
    // raw 500. We also extract useful info from non-Error throwables
    // (Supabase PostgREST throws plain `{message, details, hint, code}`
    // objects, not Error instances — `String(plainObj)` would be
    // `[object Object]` which is useless).
    const message = describeError(err);
    throw new DatabaseError(`Failed to persist LLM settings: ${message}`, {
      cause: err,
      hint: "If using Supabase, apply scripts/supabase-remediation-3.sql in the SQL editor to create the llm_settings table (and the other Phase-1 tables). For SQLite, this row should be created automatically by SQLiteAdapter.init() — restart the server and try again.",
      details: {
        code: "LLM_SETTINGS_WRITE_FAILED",
        provider: opts.body.provider ?? null,
        model: opts.body.model ?? null,
      },
    });
  }
  return getLlmSettings({ db: opts.db, env });
}

/**
 * Best-effort stringify of an unknown error value. Real Error instances
 * give us `.message`; PostgREST / fetch / driver-level errors are often
 * plain objects with a `message` (and sometimes `details` / `hint` /
 * `code`) field. Falling back to `String(obj)` is useless because it
 * produces `[object Object]`, so we walk known shapes first.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const parts: string[] = [];
    if (typeof e.message === "string") parts.push(e.message);
    if (typeof e.code === "string") parts.push(`(code=${e.code})`);
    if (typeof e.details === "string") parts.push(`details=${e.details}`);
    if (typeof e.hint === "string") parts.push(`hint=${e.hint}`);
    if (parts.length > 0) return parts.join(" ");
    try {
      return JSON.stringify(err);
    } catch {
      return "(unrenderable error object)";
    }
  }
  return String(err);
}

export interface GetProviderModelsOptions {
  provider: SupportedProvider;
  env?: NodeJS.ProcessEnv;
}

/**
 * `GET /api/llm/models?provider=…` — cached model list (refetches when
 * TTL expired). `provider=none` returns a 400 since it has no fetcher.
 */
export async function getProviderModelsForApi(
  opts: GetProviderModelsOptions
): Promise<ProviderModelsResponse> {
  if (opts.provider === "none") {
    throw new ValidationError("Cannot list models for the 'none' provider.", {
      hint: `Pass provider in: ${SUPPORTED_PROVIDERS.filter((p) => p !== "none").join(", ")}`,
    });
  }
  const list = await getProviderModels(opts.provider, { env: opts.env });
  return {
    provider: list.provider,
    fetchedAt: list.fetchedAt.toISOString(),
    ageMs: Date.now() - list.fetchedAt.getTime(),
    servedStale: Boolean(list.servedStale),
    models: list.models,
  };
}

/**
 * `POST /api/llm/model/refresh` — force a refetch and return the fresh
 * list. Bypasses TTL. Rate-limited and gated on `assertConfigUnlocked`
 * via the route layer so a runaway script can't drain provider quotas.
 */
export async function refreshProviderModelsForApi(
  opts: GetProviderModelsOptions
): Promise<ProviderModelsResponse> {
  if (opts.provider === "none") {
    throw new ValidationError("Cannot refresh models for the 'none' provider.", {
      hint: `Pass provider in: ${SUPPORTED_PROVIDERS.filter((p) => p !== "none").join(", ")}`,
    });
  }
  const list = await refreshProviderModels(opts.provider, { env: opts.env });
  return {
    provider: list.provider,
    fetchedAt: list.fetchedAt.toISOString(),
    ageMs: Date.now() - list.fetchedAt.getTime(),
    servedStale: Boolean(list.servedStale),
    models: list.models,
  };
}
