/**
 * Write-back to `.env` for fields the GUI Runtime Configuration card
 * exposes as editable.
 *
 * Why not the DB: a number of these vars (LOG_LEVEL, WEB_UI_PORT,
 * THOUGHT_CHAIN_ENABLED, MCP_REDUCED_TOOL_SURFACE) are read once at
 * boot via `process.env` — they can't be backed by a DB row. The
 * canonical place for them is `.env`, and the GUI write needs to land
 * there so the next restart sees the change.
 *
 * **Safety rails:**
 *
 *   - Allow-list. The `EDITABLE_ENV_FIELDS` set below is the SINGLE
 *     source of truth for which keys may be written. API keys,
 *     service-role keys, and DATABASE_PROVIDER are NOT on the list —
 *     those carry security or restart-coordination implications a GUI
 *     write would silently break.
 *   - `LLM_CONFIG_LOCK=true` blocks ALL writes (same posture as
 *     POST /api/llm/settings — ops-locked deployments stay locked).
 *   - Atomic write: read → patch in-memory → rename a tempfile over
 *     the live `.env`. Avoids leaving the file half-written if the
 *     process is killed mid-write.
 *   - The runtime's `process.env` is ALSO updated for vars that are
 *     safe to apply live (LLM_*, WORKFLOW_MODE, etc) so the next
 *     `workflow_run(mode=agent)` picks them up without restart. Vars
 *     marked `restartRequired` only update `.env` — `process.env`
 *     isn't touched because the consumer code wouldn't re-read it
 *     anyway.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { ForbiddenError, ValidationError } from "../utils/errors.js";
import { applyEnvironmentAliases } from "../utils/envConfig.js";

/**
 * Editable env vars. Each entry says whether the live process.env
 * should be updated alongside the .env write (true) or only the .env
 * file (false, restart-required).
 *
 * Add a new var here ONLY if it's safe for the GUI to mutate:
 *   - no secret value
 *   - no schema/connection implications (DATABASE_PROVIDER, DATA_DIRECTORY)
 *   - no security implication (LLM_CONFIG_LOCK is read-only here on
 *     purpose — once you've locked the config you shouldn't be able to
 *     un-lock it from the same GUI a bad actor could be using)
 */
const EDITABLE_ENV_FIELDS: Record<string, { liveApply: boolean }> = {
  // LLM provider — safe to apply live; createLlmProvider re-resolves
  // on every call (Group 13.4).
  LLM_PROVIDER: { liveApply: true },
  LLM_MODEL: { liveApply: true },
  LLM_SELECTION_STRATEGY: { liveApply: true },
  WORKFLOW_MODE: { liveApply: true },
  LLM_MODEL_REFRESH_TTL_HOURS: { liveApply: true },

  // Findings retention — the cleanup job re-reads on each tick.
  FINDINGS_RETENTION_DAYS: { liveApply: true },

  // Application — these are read at boot, so .env-only.
  AUTO_OPEN_WEB_UI: { liveApply: false },
  DETAILED_MODE_ENABLED: { liveApply: false },
  THOUGHT_CHAIN_ENABLED: { liveApply: false },
  PROMPT_TEMPLATE_SET: { liveApply: false },
  WEB_UI_PORT: { liveApply: false },

  // MCP transport — read at boot (changes the tools/list response).
  MCP_REDUCED_TOOL_SURFACE: { liveApply: false },

  // Logging — pino is configured at boot.
  LOG_LEVEL: { liveApply: false },
  AGENTFLOW_LOG_JSON: { liveApply: false },
};

export const EDITABLE_FIELD_NAMES = Object.freeze(Object.keys(EDITABLE_ENV_FIELDS));

export function isEditable(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(EDITABLE_ENV_FIELDS, name);
}

function readBoolean(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.toLowerCase() === "true";
}

export interface UpdateEnvOptions {
  /** Variable name to write. MUST be in EDITABLE_ENV_FIELDS. */
  name: string;
  /**
   * New value (already trimmed/validated by the caller).
   * `null` means "clear the var" — the line is rewritten as a
   * commented-out template so the user can see it was intentional.
   */
  value: string | null;
  /** Test seam — defaults to project-root /.env. */
  envFilePath?: string;
  /** Test seam — defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

export interface UpdateEnvResult {
  name: string;
  /** The value written to .env (or null when cleared). */
  written: string | null;
  /** True when `process.env` was also updated for the running process. */
  liveApplied: boolean;
}

/**
 * Atomically update a single env var in `.env`. Idempotent if the file
 * doesn't yet contain the var (a new line is appended at the end). If
 * a comment-only `# NAME=...` line exists, it's replaced with the
 * uncommented value.
 */
export async function updateEnvVar(opts: UpdateEnvOptions): Promise<UpdateEnvResult> {
  const env = opts.env ?? process.env;
  applyEnvironmentAliases(env);

  // 1. Lock check.
  if (readBoolean(env, "LLM_CONFIG_LOCK")) {
    throw new ForbiddenError("Settings are administratively locked (LLM_CONFIG_LOCK=true).", {
      hint: "Unset LLM_CONFIG_LOCK in .env and restart to enable GUI writes.",
      details: { code: "RUNTIME_CONFIG_LOCKED" },
    });
  }

  // 2. Allow-list check.
  if (!isEditable(opts.name)) {
    throw new ValidationError(`Env var '${opts.name}' is not editable from the GUI.`, {
      hint: `Editable vars: ${EDITABLE_FIELD_NAMES.join(", ")}. Secrets and connection-defining vars are intentionally excluded.`,
      details: { code: "ENV_NOT_EDITABLE", name: opts.name },
    });
  }

  // 3. Value validation — basic safety on the string itself.
  if (opts.value !== null) {
    if (typeof opts.value !== "string") {
      throw new ValidationError(`Value for '${opts.name}' must be a string or null.`);
    }
    if (opts.value.includes("\n") || opts.value.includes("\r")) {
      throw new ValidationError(`Value for '${opts.name}' cannot contain newline characters.`);
    }
    if (opts.value.length > 2_000) {
      throw new ValidationError(
        `Value for '${opts.name}' is too long (${opts.value.length} chars; max 2000).`
      );
    }
  }

  const envFilePath = opts.envFilePath ?? path.resolve(process.cwd(), ".env");

  // 4. Read → patch → atomic rename.
  let existing = "";
  try {
    existing = await fs.readFile(envFilePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    // Missing .env file — start fresh with a header.
    existing = "# .env created by Runtime Configuration GUI write.\n";
  }

  const patched = patchEnvText(existing, opts.name, opts.value);
  const tmpPath = envFilePath + ".tmp";
  await fs.writeFile(tmpPath, patched, { encoding: "utf-8", mode: 0o600 });
  await fs.rename(tmpPath, envFilePath);

  // 5. Optionally apply to the live process.env.
  const meta = EDITABLE_ENV_FIELDS[opts.name];
  if (meta.liveApply) {
    if (opts.value === null) {
      delete env[opts.name];
    } else {
      env[opts.name] = opts.value;
    }
    // Re-run alias sync so legacy names mirror the new value too.
    applyEnvironmentAliases(env);
  }

  return {
    name: opts.name,
    written: opts.value,
    liveApplied: meta.liveApply,
  };
}

/**
 * Pure-function .env text patcher. Exposed for testing.
 *
 * - If a line `NAME=...` exists (uncommented), replace its value.
 * - Else if a line `# NAME=...` (commented template) exists, uncomment
 *   it and set the new value in place.
 * - Else append `NAME=<value>` at the end.
 *
 * `value === null` rewrites the line as a commented template
 * (`# NAME=`) so the user can see the var was intentionally cleared.
 */
export function patchEnvText(source: string, name: string, value: string | null): string {
  const lines = source.split(/\r?\n/);
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const uncommentedRe = new RegExp(`^\\s*${escapedName}\\s*=.*$`);
  const commentedRe = new RegExp(`^\\s*#\\s*${escapedName}\\s*=.*$`);

  const newLine = value === null ? `# ${name}=` : `${name}=${value}`;

  let replaced = false;
  const out = lines.map((line) => {
    if (replaced) return line;
    if (uncommentedRe.test(line)) {
      replaced = true;
      return newLine;
    }
    if (commentedRe.test(line)) {
      replaced = true;
      return newLine;
    }
    return line;
  });

  if (!replaced) {
    // Append with a leading newline if the file doesn't end with one
    // and isn't empty.
    if (out.length > 0 && out[out.length - 1] !== "") {
      out.push("");
    }
    out.push(`# Appended by Runtime Configuration GUI write`);
    out.push(newLine);
  }

  return out.join("\n");
}
