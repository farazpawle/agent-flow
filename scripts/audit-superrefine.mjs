#!/usr/bin/env node
/**
 * Audit: forbid `.superRefine()` in tool schemas.
 *
 * Phase 1 Group 2.4.
 *
 * Why: superRefine produces opaque JSON Schemas (the refinement runs at
 * parse time, invisible to consumers reading `inputSchema`). The v2
 * surface uses discriminated unions instead so the wire-level contract
 * tells the agent exactly which fields are required per action/kind.
 *
 * Behaviour:
 *   - Scans `src/tools/**\/*.ts` for `.superRefine(`.
 *   - Each occurrence must have `// @superrefine-allowed:` on the same
 *     line or on the line immediately above (legacy tools slated for
 *     removal can carry this marker until they're deleted).
 *   - Exits non-zero on any unmarked occurrence.
 *
 * Usage:
 *   node scripts/audit-superrefine.mjs
 *   node scripts/audit-superrefine.mjs --path tests/fixtures/bad.ts   # ad-hoc target
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ROOTS = [path.join(REPO_ROOT, "src", "tools")];

const ALLOWED_MARKER = "@superrefine-allowed";

async function collectTsFiles(root) {
  const out = [];
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    if (root.endsWith(".ts") || root.endsWith(".tsx")) out.push(root);
    return out;
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "__tests__")
        continue;
      out.push(...(await collectTsFiles(full)));
    } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      out.push(full);
    }
  }
  return out;
}

function parsePathArg(argv) {
  const idx = argv.indexOf("--path");
  if (idx < 0 || idx === argv.length - 1) return null;
  return path.resolve(REPO_ROOT, argv[idx + 1]);
}

async function audit(rootPaths) {
  const violations = [];
  const allowedHits = [];

  for (const root of rootPaths) {
    const files = await collectTsFiles(root);
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.includes(".superRefine(")) continue;
        const prev = i > 0 ? lines[i - 1] : "";
        const allowedOnSameLine = line.includes(ALLOWED_MARKER);
        const allowedOnPrevLine = prev.includes(ALLOWED_MARKER);
        const allowed = allowedOnSameLine || allowedOnPrevLine;
        const record = {
          file: path.relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
          line: i + 1,
          snippet: line.trim(),
        };
        if (allowed) allowedHits.push(record);
        else violations.push(record);
      }
    }
  }

  return { violations, allowedHits };
}

async function main() {
  const adHoc = parsePathArg(process.argv);
  const roots = adHoc ? [adHoc] : DEFAULT_ROOTS;

  const { violations, allowedHits } = await audit(roots);

  if (allowedHits.length) {
    console.log(
      `ℹ ${allowedHits.length} allowed superRefine call${allowedHits.length === 1 ? "" : "s"} (marker present):`
    );
    for (const h of allowedHits) console.log(`    ${h.file}:${h.line}`);
  }

  if (violations.length) {
    console.error(
      `✖ ${violations.length} unmarked superRefine call${violations.length === 1 ? "" : "s"} found:`
    );
    for (const v of violations) {
      console.error(`    ${v.file}:${v.line}`);
      console.error(`        ${v.snippet}`);
    }
    console.error(
      "\nUse a discriminated union instead. If this is a legacy schema slated for removal,"
    );
    console.error(`add \`// ${ALLOWED_MARKER}: <reason>\` on the call or the line above.`);
    process.exit(1);
  }

  console.log(
    `✓ No unmarked superRefine calls under ${roots.map((r) => path.relative(REPO_ROOT, r) || ".").join(", ")}.`
  );
}

main().catch((err) => {
  console.error("✖ audit-superrefine failed:", err);
  process.exit(1);
});
