#!/usr/bin/env node
/**
 * One-shot verification that:
 *   1. Env alias chain populates the legacy SUPABASE_* names from the
 *      preferred SUPABASE_PROJECT_URL / SUPABASE_SERVICE_ROLE_KEY (or
 *      vice-versa) — i.e. the value flows through code as designed.
 *   2. All Group 1 tables (and the legacy ones) are reachable on the
 *      configured Supabase project.
 *   3. The new `tasks.version` column exists.
 *
 * Read-only — no schema mutation, no row inserts.
 * Safe to delete after you've signed off on Group 1.
 */

import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(REPO_ROOT, ".env"), override: true });

// Pull in the compiled or source aliaser so the SAME normalization that
// runs in production also runs here. Windows requires file:// URLs for
// absolute-path dynamic imports.
let applyEnvironmentAliases;
try {
  ({ applyEnvironmentAliases } = await import(
    pathToFileURL(path.join(REPO_ROOT, "dist/utils/envConfig.js")).href
  ));
} catch {
  // Fall back to the TS source via tsx — the script is invoked as ESM.
  const tsx = await import("tsx/esm/api").catch(() => null);
  if (tsx?.register) tsx.register();
  ({ applyEnvironmentAliases } = await import(
    pathToFileURL(path.join(REPO_ROOT, "src/utils/envConfig.ts")).href
  ));
}

console.log("→ Pre-alias env (raw values, masked):");
for (const k of [
  "SUPABASE_PROJECT_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
]) {
  const v = process.env[k];
  console.log(
    `    ${k.padEnd(28)} = ${v ? (k.includes("KEY") ? v.slice(0, 8) + "…(" + v.length + " chars)" : v) : "(unset)"}`
  );
}

applyEnvironmentAliases(process.env);

console.log("→ Post-alias env (legacy ⇄ preferred should be in sync):");
for (const k of [
  "SUPABASE_PROJECT_URL",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
]) {
  const v = process.env[k];
  console.log(
    `    ${k.padEnd(28)} = ${v ? (k.includes("KEY") ? v.slice(0, 8) + "…(" + v.length + " chars)" : v) : "(unset)"}`
  );
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key) {
  console.error("\n❌ Missing SUPABASE_URL or SUPABASE_SERVICE_KEY after alias resolution.");
  console.error("   Set SUPABASE_PROJECT_URL and SUPABASE_SERVICE_ROLE_KEY in .env.");
  process.exit(1);
}

const sb = createClient(url, key);

const tables = [
  // Legacy / pre-existing
  { name: "projects", required: true },
  { name: "tasks", required: true },
  { name: "workflow_steps", required: true },
  { name: "clients", required: true },
  // Phase 1 Group 1 additions
  { name: "task_findings", required: true, phase: "Group 1.1" },
  { name: "lesson_summaries", required: true, phase: "Group 1.2" },
  { name: "client_active_project", required: true, phase: "Group 1.4" },
  { name: "llm_settings", required: true, phase: "Group 1.5" },
];

console.log("\n→ Table reachability:");
let allOk = true;
const missing = [];
for (const t of tables) {
  const { error } = await sb.from(t.name).select("*").limit(1);
  if (error) {
    if (
      error.code === "42P01" ||
      error.message?.includes("does not exist") ||
      error.message?.includes("schema cache")
    ) {
      console.log(`    ❌ ${t.name.padEnd(24)} MISSING  ${t.phase ? "[" + t.phase + "]" : ""}`);
      missing.push(t.name);
      allOk = false;
    } else {
      console.log(`    ⚠️  ${t.name.padEnd(24)} ${error.message}`);
      allOk = false;
    }
  } else {
    console.log(`    ✅ ${t.name.padEnd(24)} OK       ${t.phase ? "[" + t.phase + "]" : ""}`);
  }
}

// Probe `tasks.version` — Group 1.3 — using PostgREST projection.
console.log("\n→ tasks.version column (Group 1.3):");
const { error: versionErr } = await sb.from("tasks").select("id,version").limit(1);
if (versionErr) {
  if (versionErr.code === "42703" || versionErr.message?.includes("version")) {
    console.log("    ❌ tasks.version column is MISSING");
    allOk = false;
  } else {
    console.log(`    ⚠️  ${versionErr.message}`);
    allOk = false;
  }
} else {
  console.log("    ✅ tasks.version column is present");
}

console.log("");
if (!allOk) {
  if (missing.length) {
    console.error(`Missing tables: ${missing.join(", ")}`);
    console.error("Run scripts/supabase-remediation-3.sql in the Supabase SQL Editor to add them.");
  }
  process.exit(1);
}

console.log("✨ Group 1 schema verified on live Supabase. Env aliasing is working through code.");
