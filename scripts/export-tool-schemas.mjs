#!/usr/bin/env node
/**
 * Golden-fixture exporter for every MCP tool schema.
 *
 * Phase 1 Group 2.2.
 *
 * Walks `src/tools/toolRegistry.ts` (the single source of truth) and
 * writes each tool's JSON-Schema representation to
 *   tests/fixtures/schemas/<tool_name>.json
 *
 * In CI (Group 12.5) the assertion is: re-running the exporter must
 * produce a clean diff against the committed fixtures. Any schema
 * change has to ship together with the fixture update.
 *
 * Usage:
 *   node scripts/export-tool-schemas.mjs            # write fixtures
 *   node scripts/export-tool-schemas.mjs --check    # exit non-zero if any
 *                                                   # committed fixture is
 *                                                   # missing or stale
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURES_DIR = path.join(REPO_ROOT, "tests", "fixtures", "schemas");

const CHECK_MODE = process.argv.includes("--check");

async function loadRegistry() {
  // Prefer the compiled build (faster, identical to runtime); fall back
  // to the source via tsx when running pre-build.
  const distEntry = pathToFileURL(path.join(REPO_ROOT, "dist/tools/toolRegistry.js")).href;
  const srcEntry = pathToFileURL(path.join(REPO_ROOT, "src/tools/toolRegistry.ts")).href;

  try {
    return await import(distEntry);
  } catch {
    // tsx ESM loader for the .ts path.
    const tsx = await import("tsx/esm/api").catch(() => null);
    if (tsx?.register) tsx.register();
    return await import(srcEntry);
  }
}

/**
 * zod-to-json-schema emits `anyOf` for every union (including discriminated
 * unions). The v2 plan's tool contracts use discriminated unions to mean
 * "exactly one branch matches" — that's `oneOf` in JSON-Schema vocabulary.
 * Normalising here keeps the wire-level semantics honest.
 */
function normaliseUnionKeys(node) {
  if (Array.isArray(node)) {
    for (const item of node) normaliseUnionKeys(item);
    return;
  }
  if (node && typeof node === "object") {
    if (Array.isArray(node.anyOf) && !node.oneOf) {
      node.oneOf = node.anyOf;
      delete node.anyOf;
    }
    for (const key of Object.keys(node)) normaliseUnionKeys(node[key]);
  }
}

function stableStringify(value) {
  // 2-space indent + trailing newline matches Prettier's JSON default,
  // which means committed fixtures stay diff-clean under `prettier --write`.
  return JSON.stringify(value, null, 2) + "\n";
}

async function ensureFixturesDir() {
  await fs.mkdir(FIXTURES_DIR, { recursive: true });
}

async function main() {
  await ensureFixturesDir();

  const { TOOL_SCHEMAS } = await loadRegistry();
  const names = Object.keys(TOOL_SCHEMAS).sort();

  if (names.length === 0) {
    console.error("✖ toolRegistry exposes no schemas — nothing to export.");
    process.exit(1);
  }

  const written = [];
  const drift = [];

  for (const name of names) {
    const schema = TOOL_SCHEMAS[name];
    // `name` doubles as the JSON-Schema `$id` so diff readers can
    // tell at a glance which tool a fixture belongs to.
    const jsonSchema = zodToJsonSchema(schema, { name, $refStrategy: "none" });
    normaliseUnionKeys(jsonSchema);
    const payload = stableStringify(jsonSchema);

    const filePath = path.join(FIXTURES_DIR, `${name}.json`);
    let existing = null;
    try {
      existing = await fs.readFile(filePath, "utf-8");
    } catch {
      /* missing */
    }

    if (CHECK_MODE) {
      if (existing == null) {
        drift.push({ name, kind: "missing" });
      } else if (existing !== payload) {
        drift.push({ name, kind: "stale" });
      }
    } else {
      if (existing !== payload) {
        await fs.writeFile(filePath, payload, "utf-8");
        written.push(name);
      }
    }
  }

  if (CHECK_MODE) {
    if (drift.length === 0) {
      console.log(`✓ Schema fixtures up to date (${names.length} tools).`);
      return;
    }
    console.error("✖ Schema fixture drift detected:");
    for (const d of drift) console.error(`    ${d.kind.padEnd(8)} ${d.name}`);
    console.error("\nRun `node scripts/export-tool-schemas.mjs` and commit the diff.");
    process.exit(1);
  }

  if (written.length === 0) {
    console.log(`✓ Schema fixtures unchanged (${names.length} tools).`);
  } else {
    console.log(`✓ Wrote ${written.length}/${names.length} schema fixtures:`);
    for (const name of written) console.log(`    ${name}`);
  }
}

main().catch((err) => {
  console.error("✖ export-tool-schemas failed:", err);
  process.exit(1);
});
