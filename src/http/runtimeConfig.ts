/**
 * Runtime configuration snapshot for the GUI Settings page.
 *
 * Returns every relevant env var grouped by section, with secret values
 * redacted to a "set"/"unset" indicator. The GUI renders this in the
 * Runtime Configuration card so the operator can see — at a glance —
 * exactly what the server is using without having to crack open the
 * `.env` file.
 *
 * Security: API keys + service-role keys are NEVER echoed verbatim.
 * They surface as `{ kind: "secret", set: boolean, hint?: string }`
 * entries instead. The decision mirrors plan §16.2.
 */

import { applyEnvironmentAliases } from "../utils/envConfig.js";
import { isEditable } from "./envWriter.js";

export interface RuntimeConfigField {
  /** Env var name (canonical, preferred-key form). */
  name: string;
  /** One-line description rendered as the row's secondary text. */
  description: string;
  /** "set" only when the env var has a non-empty trimmed value. */
  set: boolean;
  /**
   * For non-secret fields, the actual value (string-coerced). For
   * secret fields this is OMITTED — the GUI shows a redacted "set" badge.
   */
  value?: string;
  /** Default applied by the runtime when the env var is absent. */
  default?: string;
  /** True for API keys / service-role keys — the GUI redacts them. */
  secret?: boolean;
  /**
   * True when changing this value requires a server restart to take
   * effect (e.g. `DATABASE_PROVIDER` or `DATA_DIRECTORY`). The runtime
   * never re-reads these mid-process.
   */
  restartRequired?: boolean;
  /**
   * True when this var may be written via PATCH /api/settings/runtime
   * from the GUI. Mirrors `EDITABLE_ENV_FIELDS` in `envWriter.ts` —
   * keeps the GUI in lock-step with the server-side allow-list.
   */
  editable?: boolean;
}

export interface RuntimeConfigSection {
  title: string;
  description: string;
  fields: RuntimeConfigField[];
}

export interface RuntimeConfigResponse {
  /** Wall-clock when the snapshot was generated. */
  fetchedAt: string;
  sections: RuntimeConfigSection[];
}

function readSecret(env: NodeJS.ProcessEnv, name: string): boolean {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0;
}

function readValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const v = env[name];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

function field(
  env: NodeJS.ProcessEnv,
  name: string,
  description: string,
  opts: { default?: string; secret?: boolean; restartRequired?: boolean } = {}
): RuntimeConfigField {
  const set = readSecret(env, name);
  const out: RuntimeConfigField = { name, description, set };
  if (set && !opts.secret) {
    out.value = readValue(env, name);
  }
  if (opts.default !== undefined) out.default = opts.default;
  if (opts.secret) out.secret = true;
  if (opts.restartRequired) out.restartRequired = true;
  // `editable` is derived from the writer's allow-list (envWriter.ts)
  // — secrets and DB-defining vars are intentionally NOT editable from
  // the GUI no matter what flags the row carries.
  if (!opts.secret && isEditable(name)) out.editable = true;
  return out;
}

/**
 * Build the snapshot. Pure function over `env` so tests can inject
 * fixtures without touching `process.env`.
 */
export function buildRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfigResponse {
  applyEnvironmentAliases(env);

  const sections: RuntimeConfigSection[] = [
    {
      title: "Application",
      description:
        "Core paths + GUI flags. Most of these are read once at boot — change them in .env and restart.",
      fields: [
        field(env, "DATA_DIRECTORY", "Absolute path for SQLite DB + WebGUI.md link file.", {
          restartRequired: true,
        }),
        field(env, "PROMPT_TEMPLATE_SET", "Template set under src/prompts/templates_*.", {
          default: "en",
          restartRequired: true,
        }),
        field(env, "WEB_UI_ENABLED", "Start the dashboard server alongside MCP.", {
          default: "false",
          restartRequired: true,
        }),
        field(env, "DETAILED_MODE_ENABLED", "Record per-task conversation history.", {
          default: "false",
          restartRequired: true,
        }),
        field(env, "AUTO_OPEN_WEB_UI", "Open the GUI URL in the default browser on first start.", {
          default: "true",
          restartRequired: true,
        }),
        field(env, "WEB_UI_PORT", "Dashboard server port.", {
          default: "54544",
          restartRequired: true,
        }),
        field(env, "THOUGHT_CHAIN_ENABLED", "Enable staged thought chain in workflow_run.", {
          default: "false",
          restartRequired: true,
        }),
      ],
    },
    {
      title: "Database",
      description:
        "Adapter + Supabase credentials. Switching DATABASE_PROVIDER requires a restart.",
      fields: [
        field(env, "DATABASE_PROVIDER", "sqlite (default) or supabase.", {
          default: "sqlite",
          restartRequired: true,
        }),
        field(env, "SUPABASE_PROJECT_URL", "Required when DATABASE_PROVIDER=supabase.", {
          restartRequired: true,
        }),
        field(env, "SUPABASE_SERVICE_ROLE_KEY", "Service-role key (secret) — bypasses RLS.", {
          secret: true,
          restartRequired: true,
        }),
      ],
    },
    {
      title: "LLM provider",
      description:
        "Manage these from the LLM provider card above — the same values plus the per-field 'env vs db' source labels. Listed here too for completeness.",
      fields: [
        field(
          env,
          "LLM_PROVIDER",
          "Active provider: openai | anthropic | openrouter | deepseek | none.",
          { default: "none" }
        ),
        field(env, "LLM_MODEL", "Concrete model id (otherwise LLM_SELECTION_STRATEGY decides)."),
        field(
          env,
          "LLM_SELECTION_STRATEGY",
          "manual | latest_code | latest_reasoning | cheapest | fastest.",
          { default: "latest_code" }
        ),
        field(env, "WORKFLOW_MODE", "workflow_run default mode: manual | agent | disabled.", {
          default: "manual",
        }),
        field(
          env,
          "LLM_CONFIG_LOCK",
          "When true: GUI/DB cannot override env. POST /api/llm/settings → 403.",
          { default: "false" }
        ),
        field(env, "LLM_MODEL_REFRESH_TTL_HOURS", "Cache TTL for per-provider model lists.", {
          default: "24",
        }),
        field(env, "OPENAI_API_KEY", "OpenAI API key (env-only — never persisted).", {
          secret: true,
          restartRequired: true,
        }),
        field(env, "ANTHROPIC_API_KEY", "Anthropic API key (env-only — never persisted).", {
          secret: true,
          restartRequired: true,
        }),
        field(env, "OPENROUTER_API_KEY", "OpenRouter API key (env-only — never persisted).", {
          secret: true,
          restartRequired: true,
        }),
        field(env, "DEEPSEEK_API_KEY", "DeepSeek API key (env-only — never persisted).", {
          secret: true,
          restartRequired: true,
        }),
      ],
    },
    {
      title: "Findings retention",
      description: "Background cleanup of the task_findings table.",
      fields: [
        field(
          env,
          "FINDINGS_RETENTION_DAYS",
          "Max age in days before nightly cleanup deletes a row. Unset = keep forever."
        ),
      ],
    },
    {
      title: "MCP transport",
      description:
        "Tool/Resources/Prompts surface controls. Default since v1.2.0 is the reduced (7-tool) surface.",
      fields: [
        field(
          env,
          "MCP_REDUCED_TOOL_SURFACE",
          "true (default since Phase 3): views move to Resources, plan/analyze/review move to Prompts.",
          { default: "true", restartRequired: true }
        ),
      ],
    },
    {
      title: "Logging & observability",
      description: "Pino log level + JSON-mode toggle. Read once at boot.",
      fields: [
        field(env, "LOG_LEVEL", "trace | debug | info | warn | error | fatal | silent.", {
          default: "info",
          restartRequired: true,
        }),
        field(env, "AGENTFLOW_LOG_JSON", "Force JSON log output even in development.", {
          restartRequired: true,
        }),
      ],
    },
  ];

  return {
    fetchedAt: new Date().toISOString(),
    sections,
  };
}
