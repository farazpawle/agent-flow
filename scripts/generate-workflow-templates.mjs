#!/usr/bin/env node
/**
 * One-shot generator for `src/prompts/templates_en/workflows/*.md`.
 *
 * Phase 1 Group 10.4 asks for one markdown template per workflow,
 * using the existing prompt loader pattern. The TS definitions in
 * `src/tools/workflows/definitions.ts` already encode the same content
 * (it's what the manual-mode response returns at runtime); these
 * markdown files are the source-of-truth handoff for the Phase 2
 * Group 15 LLM system prompts and serve as living documentation.
 *
 * Re-run after editing `definitions.ts` to keep them in sync.
 *
 * Usage:
 *   node scripts/generate-workflow-templates.mjs
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(REPO_ROOT, "src/prompts/templates_en/workflows");

async function loadDefinitions() {
  const srcEntry = pathToFileURL(path.join(REPO_ROOT, "src/tools/workflows/definitions.ts")).href;
  try {
    return await import(srcEntry);
  } catch {
    const tsx = await import("tsx/esm/api").catch(() => null);
    if (tsx?.register) tsx.register();
    return await import(srcEntry);
  }
}

function bullet(items) {
  return items.map((line) => `- ${line}`).join("\n");
}

function renderMarkdown(name, def) {
  return [
    `# Workflow: \`${name}\``,
    "",
    "## Purpose",
    "",
    def.purpose,
    "",
    "## Input Required",
    "",
    bullet(def.inputRequired),
    "",
    "## Steps",
    "",
    def.steps.map((s) => s).join("\n"),
    "",
    "## Output Schema",
    "",
    "The agent's output must conform to this JSON Schema:",
    "",
    "```json",
    JSON.stringify(def.outputSchema, null, 2),
    "```",
    "",
    "## Quality Checklist",
    "",
    bullet(def.qualityChecklist),
    "",
    "## Next Recommended Calls",
    "",
    bullet(def.nextRecommendedCalls),
    "",
  ].join("\n");
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const mod = await loadDefinitions();
  const { WORKFLOW_NAMES, WORKFLOW_DEFINITIONS } = mod;

  for (const name of WORKFLOW_NAMES) {
    const def = WORKFLOW_DEFINITIONS[name];
    const md = renderMarkdown(name, def);
    await fs.writeFile(path.join(OUT_DIR, `${name}.md`), md, "utf-8");
  }

  console.log(`✓ Wrote ${WORKFLOW_NAMES.length} workflow templates to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error("✖ generate-workflow-templates failed:", err);
  process.exit(1);
});
