type EnvMap = NodeJS.ProcessEnv;

type AliasSpec = {
  preferredKey: string;
  legacyKeys: string[];
  kind?: "string" | "boolean";
};

const ENV_ALIAS_SPECS: AliasSpec[] = [
  { preferredKey: "DATA_DIRECTORY", legacyKeys: ["DATA_DIR"] },
  { preferredKey: "THOUGHT_CHAIN_ENABLED", legacyKeys: ["ENABLE_THOUGHT_CHAIN"], kind: "boolean" },
  { preferredKey: "PROMPT_TEMPLATE_SET", legacyKeys: ["TEMPLATES_USE"] },
  { preferredKey: "WEB_UI_ENABLED", legacyKeys: ["ENABLE_GUI"], kind: "boolean" },
  { preferredKey: "DETAILED_MODE_ENABLED", legacyKeys: ["ENABLE_DETAILED_MODE"], kind: "boolean" },
  { preferredKey: "WEB_UI_PORT", legacyKeys: ["SERVER_PORT"] },
  { preferredKey: "DATABASE_PROVIDER", legacyKeys: ["DB_TYPE"] },
  { preferredKey: "SUPABASE_PROJECT_URL", legacyKeys: ["SUPABASE_URL"] },
  { preferredKey: "SUPABASE_SERVICE_ROLE_KEY", legacyKeys: ["SUPABASE_SERVICE_KEY"] },
  { preferredKey: "TASK_ARCHIVE_AFTER_DAYS", legacyKeys: ["ARCHIVE_AFTER_DAYS"] },
  // Phase 1 Group 1.9 — findings retention (unset = keep forever).
  { preferredKey: "FINDINGS_RETENTION_DAYS", legacyKeys: [] },
  // Phase 2 LLM provider layer — registered ahead of time so the values
  // round-trip through alias normalization (trim, boolean parsing).
  { preferredKey: "WORKFLOW_MODE", legacyKeys: [] },
  { preferredKey: "LLM_PROVIDER", legacyKeys: [] },
  { preferredKey: "LLM_MODEL", legacyKeys: [] },
  // Preferred key is LLM_SELECTION_STRATEGY; legacy LLM_MODEL_SELECTION
  // from the original plan §4.1 is honoured for backwards compatibility.
  { preferredKey: "LLM_SELECTION_STRATEGY", legacyKeys: ["LLM_MODEL_SELECTION"] },
  { preferredKey: "LLM_CONFIG_LOCK", legacyKeys: [], kind: "boolean" },
  { preferredKey: "LLM_MODEL_REFRESH_TTL_HOURS", legacyKeys: [] },
  { preferredKey: "OPENAI_API_KEY", legacyKeys: [] },
  { preferredKey: "ANTHROPIC_API_KEY", legacyKeys: [] },
  { preferredKey: "OPENROUTER_API_KEY", legacyKeys: [] },
  { preferredKey: "DEEPSEEK_API_KEY", legacyKeys: [] },
  // OPENROUTER_BASE_URL / DEEPSEEK_BASE_URL removed (2026-05-25) —
  // both providers have stable, hardcoded base URLs and no self-hosted
  // gateway story. Hardcoding them in the provider modules removes a
  // pair of env knobs that were noise.
  // Phase 3 Group 19 — when "true" (the default once Phase 3 ships),
  // view tools (project_view / task_view / context_get) move behind
  // MCP Resources and `workflow_run(plan|analyze|review)` moves behind
  // MCP Prompts. Set to "false" if a downstream client hasn't migrated
  // and still needs the old tools list.
  { preferredKey: "MCP_REDUCED_TOOL_SURFACE", legacyKeys: [], kind: "boolean" },
];

function normalizeEnvValue(
  value: string | undefined,
  kind: "string" | "boolean" = "string"
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  if (kind === "boolean") {
    const normalizedBoolean = trimmedValue.toLowerCase();
    if (normalizedBoolean === "true" || normalizedBoolean === "false") {
      return normalizedBoolean;
    }
  }

  return trimmedValue;
}

function resolveAliasValue(env: EnvMap, spec: AliasSpec): string | undefined {
  const lookupOrder = [spec.preferredKey, ...spec.legacyKeys];

  for (const key of lookupOrder) {
    const value = normalizeEnvValue(env[key], spec.kind ?? "string");
    if (value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function synchronizeAliasGroup(env: EnvMap, spec: AliasSpec, resolvedValue: string): void {
  env[spec.preferredKey] = resolvedValue;

  for (const legacyKey of spec.legacyKeys) {
    env[legacyKey] = resolvedValue;
  }
}

function synchronizeAutoOpenAliases(env: EnvMap): void {
  const preferredValue = normalizeEnvValue(env.AUTO_OPEN_WEB_UI, "boolean");
  const legacyEnableValue = normalizeEnvValue(env.ENABLE_AUTO_OPEN, "boolean");
  const legacyDisableValue = normalizeEnvValue(env.DISABLE_AUTO_OPEN, "boolean");

  let resolvedValue = preferredValue ?? legacyEnableValue;

  if (resolvedValue === undefined && legacyDisableValue !== undefined) {
    resolvedValue = legacyDisableValue === "true" ? "false" : "true";
  }

  if (resolvedValue === undefined) {
    return;
  }

  env.AUTO_OPEN_WEB_UI = resolvedValue;
  env.ENABLE_AUTO_OPEN = resolvedValue;

  if (resolvedValue === "true" || resolvedValue === "false") {
    env.DISABLE_AUTO_OPEN = resolvedValue === "true" ? "false" : "true";
  }
}

export function applyEnvironmentAliases(env: EnvMap = process.env): EnvMap {
  for (const spec of ENV_ALIAS_SPECS) {
    const resolvedValue = resolveAliasValue(env, spec);
    if (resolvedValue !== undefined) {
      synchronizeAliasGroup(env, spec, resolvedValue);
    }
  }

  synchronizeAutoOpenAliases(env);

  return env;
}
