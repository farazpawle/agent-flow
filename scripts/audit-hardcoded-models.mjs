#!/usr/bin/env node
/**
 * Audit: forbid concrete LLM model-id literals under `src/llm/**`.
 *
 * Phase 2 Group 14.6.
 *
 * Why: Plan §4.6 — concrete model IDs change weekly (OpenRouter
 * especially). Bake one in and the codebase drifts the day it lands.
 * The model layer must resolve everything through `resolveModelForCall`
 * which pulls live data via the per-provider fetchers; nothing under
 * `src/llm/` should carry a literal like `"gpt-4o"` or
 * `"claude-3-5-sonnet-latest"`.
 *
 * Detection: a string literal is flagged when it matches a known
 * model-family pattern AND looks like a *full* ID (family prefix
 * followed by a hyphen / slash / dot AND further characters). Bare
 * filter keywords like `"gpt"`, `"chatgpt"`, `"reasoner"`,
 * `"thinking"`, the single-letter `"o"`, or substrings inside string
 * comparison helpers DON'T trip the check — those are family
 * fragments, not concrete model ids.
 *
 * Allowance: lines or the line immediately above that contain
 * `// @hardcoded-model-allowed: <reason>` are tolerated. Use this
 * sparingly (e.g. in a normaliser that needs to match a vendor's own
 * legacy id when constructing a fallback).
 *
 * Behaviour:
 *   - Scans `src/llm/**\/*.ts` for matching string literals.
 *   - Each match without the allowance marker is an error.
 *   - Exits non-zero on any violation.
 *
 * Usage:
 *   node scripts/audit-hardcoded-models.mjs
 *   node scripts/audit-hardcoded-models.mjs --path tests/fixtures/bad.ts   # ad-hoc target
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_ROOTS = [path.join(REPO_ROOT, "src", "llm")];

const ALLOWED_MARKER = "@hardcoded-model-allowed";

/**
 * Model family prefixes. Matching only succeeds when the prefix is
 * followed by a separator (`-`, `/`, `.`, `_`) AND at least one
 * additional alphanumeric character — that distinguishes a concrete
 * id like `"gpt-4o"` from a filter keyword like `"gpt"`.
 *
 * Add new families here as providers ship them.
 */
const MODEL_FAMILY_PREFIXES = [
  "gpt",
  "chatgpt",
  "claude",
  "deepseek",
  "llama",
  "gemini",
  "mistral",
  "qwen",
  "phi",
  "grok",
  "command",
  "nemotron",
  "reka",
  "jamba",
  "moonshot",
  "kimi",
  "yi",
  "text-davinci",
  "text-curie",
  "text-babbage",
  "text-ada",
  "davinci",
  "curie",
  "babbage",
  "ada",
];

/**
 * Standalone patterns for families whose ids don't follow the
 * "prefix + separator + body" shape (e.g. OpenAI o-series like `o1`,
 * `o3-mini`). The pattern must be anchored to a non-letter boundary
 * to avoid matching identifiers like `co1` or `mojo3`.
 */
const STANDALONE_PATTERNS = [
  // OpenAI o-series — single letter `o` followed by a digit, then
  // optionally `-<suffix>`. `o1`, `o3-mini`, `o4-pro` all match.
  /\bo[1-9](?:-[a-z0-9-]+)?\b/i,
];

const PREFIX_REGEX = new RegExp(
  `\\b(?:${MODEL_FAMILY_PREFIXES.join("|")})[-/._][a-z0-9][a-z0-9._/-]*`,
  "i"
);

/**
 * Match all string literals in a source file. Catches `"..."`, `'...'`,
 * and template literals without `${}` interpolation (interpolation
 * usually means the id is being assembled at runtime, which is fine).
 *
 * Regex is greedy-safe because the closing quote is explicit.
 */
const STRING_LITERAL_REGEX = /(?:"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`)/g;

function literalLooksLikeModelId(s) {
  if (!s) return false;
  // Reject very long strings (sentences, URLs) — model IDs are < 80 chars.
  if (s.length > 80) return false;
  // Reject obvious non-IDs (URLs, full sentences with spaces).
  if (s.includes(" ") || s.startsWith("http") || s.includes("://")) return false;
  if (PREFIX_REGEX.test(s)) return true;
  return STANDALONE_PATTERNS.some((r) => r.test(s));
}

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

/**
 * Lines we never audit:
 *   - module import/export paths — `import { x } from "./foo.js"` could
 *     contain `deepseek.js` which trips the prefix regex but is a file
 *     name, not a model id.
 *   - single-line `//` comments.
 *   - JSDoc / block comment lines (`*` continuation, or `/* … *\/` opener) —
 *     example IDs in docs don't execute.
 */
function lineShouldBeSkipped(line, insideBlockComment) {
  const trimmed = line.trim();
  if (insideBlockComment) return true;
  if (trimmed.startsWith("//")) return true;
  if (trimmed.startsWith("*") || trimmed.startsWith("/*")) return true;
  if (/^\s*import\b/.test(line)) return true;
  if (/^\s*export\b.*\bfrom\b/.test(line)) return true;
  return false;
}

async function audit(rootPaths) {
  const violations = [];
  const allowedHits = [];

  for (const root of rootPaths) {
    const files = await collectTsFiles(root);
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split(/\r?\n/);
      // Track whether the current line sits inside a `/* ... */` block —
      // toggling on `/*` openers that don't close on the same line.
      let insideBlockComment = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const opensBlock = /\/\*/.test(line) && !/\*\/[^/*]*$/.test(line);
        const closesBlock = /\*\//.test(line);
        const startedInside = insideBlockComment;

        if (lineShouldBeSkipped(line, startedInside)) {
          if (opensBlock && !closesBlock) insideBlockComment = true;
          if (closesBlock) insideBlockComment = false;
          continue;
        }

        STRING_LITERAL_REGEX.lastIndex = 0;
        let match;
        while ((match = STRING_LITERAL_REGEX.exec(line)) !== null) {
          const literal = match[1] ?? match[2] ?? match[3];
          if (!literalLooksLikeModelId(literal)) continue;
          const prev = i > 0 ? lines[i - 1] : "";
          const allowed = line.includes(ALLOWED_MARKER) || prev.includes(ALLOWED_MARKER);
          const record = {
            file: path.relative(REPO_ROOT, filePath).replace(/\\/g, "/"),
            line: i + 1,
            literal,
            snippet: line.trim(),
          };
          if (allowed) allowedHits.push(record);
          else violations.push(record);
        }

        if (opensBlock && !closesBlock) insideBlockComment = true;
        if (closesBlock) insideBlockComment = false;
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
      `ℹ ${allowedHits.length} allowed hardcoded model literal${allowedHits.length === 1 ? "" : "s"} (marker present):`
    );
    for (const h of allowedHits) console.log(`    ${h.file}:${h.line}  (${h.literal})`);
  }

  if (violations.length) {
    console.error(
      `✖ ${violations.length} hardcoded model literal${violations.length === 1 ? "" : "s"} found under src/llm/:`
    );
    for (const v of violations) {
      console.error(`    ${v.file}:${v.line}  (${v.literal})`);
      console.error(`        ${v.snippet}`);
    }
    console.error(`\nResolve model IDs at call time via \`resolveModelForCall\` instead.`);
    console.error(
      `If unavoidable, add \`// ${ALLOWED_MARKER}: <reason>\` on the same line or the line above.`
    );
    process.exit(1);
  }

  console.log("✔ No hardcoded model literals found.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
