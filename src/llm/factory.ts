/**
 * LLM provider factory (Group 13.4).
 *
 * Resolution rules (mirrors plan §4.6):
 *   1. Read env values via `applyEnvironmentAliases` so legacy and
 *      preferred names round-trip the same way as elsewhere.
 *   2. If `LLM_CONFIG_LOCK=true`, env wins and `llm_settings` rows are
 *      ignored. This is the "ops-locked" deployment posture.
 *   3. Otherwise, `llm_settings` rows (set via the GUI Settings panel
 *      in Group 17) override env on a per-field basis. Missing fields
 *      fall back to env. API keys are NEVER read from the DB — they
 *      are env-only by design (plan §16.2).
 *   4. Provider key `none` (or unset) returns the no-op provider.
 *   5. Unknown provider keys throw `ValidationError` so callers see
 *      the typo explicitly rather than silently falling through.
 *
 * Caching: the factory is intentionally NOT memoised here. The GUI
 * Settings panel (Group 17) needs the next `workflow_run` call to pick
 * up new settings without a restart, so we re-resolve every time.
 * Provider clients themselves are cheap to construct (they wrap a
 * fetch closure); the actual network cost is per-call.
 */

import { applyEnvironmentAliases } from "../utils/envConfig.js";
import { ValidationError } from "../utils/errors.js";
import type { DatabaseAdapter } from "../models/interfaces.js";
import {
  SUPPORTED_PROVIDERS,
  isSupportedProvider,
  type LlmProvider,
  type SupportedProvider,
} from "./provider.js";
import { createOpenAiProvider } from "./providers/openai.js";
import { createAnthropicProvider } from "./providers/anthropic.js";
import { createOpenRouterProvider } from "./providers/openrouter.js";
import { createDeepSeekProvider } from "./providers/deepseek.js";
import { createNoneProvider } from "./providers/none.js";

export interface ResolvedLlmConfig {
  provider: SupportedProvider;
  model?: string;
  /** "env" if env supplied the provider, "db" if `llm_settings` overrode. */
  providerSource: "env" | "db" | "default";
  /** Same semantics for `model`. */
  modelSource: "env" | "db" | "default";
  /** True when env values are locked and DB overrides were skipped. */
  configLocked: boolean;
}

export interface ResolveLlmConfigOptions {
  /**
   * Database adapter to read `llm_settings` from. Optional — callers
   * that only want env-based resolution (CLI tools, audits) may omit
   * it. Production paths pass `dbFactory.getDatabase()`.
   */
  db?: DatabaseAdapter;
  /** Env source override (tests). Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
}

export type CreateLlmProviderOptions = ResolveLlmConfigOptions;

function readBoolean(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.toLowerCase() === "true";
}

/**
 * Resolve the effective LLM provider + model from env and (optionally)
 * the DB-backed `llm_settings` row. Exposed separately from
 * `createLlmProvider` so the GUI's `GET /api/llm/settings` (Group 16)
 * can show the effective config + its source without instantiating a
 * client.
 */
export async function resolveLlmConfig(
  opts: ResolveLlmConfigOptions = {}
): Promise<ResolvedLlmConfig> {
  const env = opts.env ?? process.env;
  applyEnvironmentAliases(env);

  const configLocked = readBoolean(env, "LLM_CONFIG_LOCK");

  const envProviderRaw = env.LLM_PROVIDER?.trim();
  const envProvider =
    envProviderRaw && isSupportedProvider(envProviderRaw)
      ? (envProviderRaw as SupportedProvider)
      : envProviderRaw
        ? null // explicitly bad value — flag below
        : undefined;

  if (envProviderRaw && envProvider === null) {
    throw new ValidationError(`Unknown LLM_PROVIDER value '${envProviderRaw}'`, {
      hint: `Allowed values: ${SUPPORTED_PROVIDERS.join(", ")}`,
    });
  }

  const envModel = env.LLM_MODEL?.trim() || undefined;

  let dbProvider: SupportedProvider | undefined;
  let dbModel: string | undefined;

  if (!configLocked && opts.db) {
    // Tolerate DB failures (uninitialised adapter, transient errors)
    // by falling through to env. The runner now defaults `db` to the
    // singleton (Group 18 fix), so a stray import during boot won't
    // explode if `db.init()` hasn't run yet — env-only resolution
    // still works in that case.
    let settings: Awaited<ReturnType<DatabaseAdapter["getLlmSettings"]>> = null;
    try {
      settings = await opts.db.getLlmSettings();
    } catch {
      settings = null;
    }
    if (settings?.provider) {
      if (!isSupportedProvider(settings.provider)) {
        throw new ValidationError(
          `Persisted llm_settings.provider '${settings.provider}' is not a supported provider`,
          { hint: `Allowed values: ${SUPPORTED_PROVIDERS.join(", ")}` }
        );
      }
      dbProvider = settings.provider as SupportedProvider;
    }
    if (settings?.model) {
      dbModel = settings.model;
    }
  }

  const provider: SupportedProvider = dbProvider ?? envProvider ?? "none";
  const providerSource: ResolvedLlmConfig["providerSource"] = dbProvider
    ? "db"
    : envProvider
      ? "env"
      : "default";

  const model = dbModel ?? envModel;
  const modelSource: ResolvedLlmConfig["modelSource"] = dbModel
    ? "db"
    : envModel
      ? "env"
      : "default";

  return { provider, model, providerSource, modelSource, configLocked };
}

function instantiate(
  provider: SupportedProvider,
  model: string | undefined,
  env: NodeJS.ProcessEnv
): LlmProvider {
  switch (provider) {
    case "openai":
      return createOpenAiProvider({
        apiKey: env.OPENAI_API_KEY,
        defaultModel: model,
      });
    case "anthropic":
      return createAnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        defaultModel: model,
      });
    case "openrouter":
      return createOpenRouterProvider({
        apiKey: env.OPENROUTER_API_KEY,
        defaultModel: model,
      });
    case "deepseek":
      return createDeepSeekProvider({
        apiKey: env.DEEPSEEK_API_KEY,
        defaultModel: model,
      });
    case "none":
      return createNoneProvider();
  }
}

/**
 * Build and return the active `LlmProvider`. `LLM_PROVIDER=none` (the
 * default) returns the no-op provider that errors with
 * `PROVIDER_NOT_CONFIGURED` on first call.
 */
export async function createLlmProvider(opts: CreateLlmProviderOptions = {}): Promise<LlmProvider> {
  const env = opts.env ?? process.env;
  const config = await resolveLlmConfig(opts);
  return instantiate(config.provider, config.model, env);
}
