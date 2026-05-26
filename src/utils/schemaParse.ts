/**
 * Schema-parse wrapper with discriminator-aware error messages.
 *
 * Phase 1 Group 2.3.
 *
 * Why: when an agent calls a discriminated-union tool (e.g.
 * `task_view(action="get", ...)`), an invalid or missing `action`
 * produces a raw `invalid_union_discriminator` Zod issue — useless to a
 * human reader, useless to an LLM trying to self-correct. This wrapper
 * normalises the response: every error becomes a typed `ValidationError`
 * carrying a hint that lists the valid discriminator values.
 *
 * Behaviour summary:
 *   - On success: returns `{ ok: true, data }`.
 *   - On failure: returns `{ ok: false, error }` where `error` is a
 *     `ValidationError` whose `details.issues` is the raw Zod issue list
 *     and `hint` (when applicable) is the discriminator advice.
 *   - Never throws.
 *
 * Pair with `toToolErrorResponse(toolName, result.error)` to emit the
 * MCP `isError` payload.
 */

import { ZodIssueCode, type ZodIssue, type ZodType, type ZodTypeAny } from "zod";
import { ValidationError } from "./errors.js";

export interface SafeParseSuccess<T> {
  ok: true;
  data: T;
}

export interface SafeParseFailure {
  ok: false;
  error: ValidationError;
}

export type SafeParseResult<T> = SafeParseSuccess<T> | SafeParseFailure;

/**
 * Parse `input` against `schema` and return a structured result. The
 * returned error is enriched with a discriminator hint when possible.
 *
 * @param toolName  used only for the error message prefix (e.g.
 *                  "task_view: invalid input — ...").
 * @param schema    any Zod schema (discriminated unions included).
 * @param input     arbitrary tool arguments.
 */
export function safeParseTool<T extends ZodTypeAny>(
  toolName: string,
  schema: T,
  input: unknown
): SafeParseResult<ReturnType<T["parse"]>> {
  const parsed = (schema as ZodType<unknown>).safeParse(input);
  if (parsed.success) {
    return { ok: true, data: parsed.data as ReturnType<T["parse"]> };
  }

  const issues = parsed.error.issues;
  const hint = buildDiscriminatorHint(issues);

  const summary = summariseIssues(issues);
  const message = `${toolName}: invalid input — ${summary}`;

  return {
    ok: false,
    error: new ValidationError(message, {
      hint,
      details: { issues },
    }),
  };
}

/**
 * If any issue points at a discriminator that's missing or unknown,
 * surface the allowed values. Returns `undefined` when no hint applies
 * so the caller can fall back to a generic error.
 */
export function buildDiscriminatorHint(issues: readonly ZodIssue[]): string | undefined {
  for (const issue of issues) {
    // Top-level invalid_union_discriminator (Zod 3.21+): caller used a
    // value the union doesn't know about, e.g. action="bogus".
    if (issue.code === ZodIssueCode.invalid_union_discriminator) {
      const options = (issue as { options?: readonly unknown[] }).options ?? [];
      const field = formatPath(issue.path);
      return `valid \`${field}\` values: ${formatValues(options)}`;
    }

    // invalid_literal — common when the discriminator is a literal in a
    // single branch (e.g. mode: z.literal("execute")).
    if (issue.code === ZodIssueCode.invalid_literal) {
      const expected = (issue as { expected?: unknown }).expected;
      const field = formatPath(issue.path);
      if (expected !== undefined) {
        return `\`${field}\` must equal ${formatValue(expected)}`;
      }
    }

    // invalid_enum_value — fired when a non-discriminated enum receives
    // an unknown value. Still useful for hint generation.
    if (issue.code === ZodIssueCode.invalid_enum_value) {
      const options = (issue as { options?: readonly unknown[] }).options ?? [];
      const field = formatPath(issue.path);
      return `valid \`${field}\` values: ${formatValues(options)}`;
    }

    // Missing discriminator key shows up as invalid_type on the path
    // of the discriminator field (received "undefined").
    if (
      issue.code === ZodIssueCode.invalid_type &&
      (issue as { received?: string }).received === "undefined" &&
      issue.path.length > 0
    ) {
      const field = formatPath(issue.path);
      return `\`${field}\` is required`;
    }
  }

  return undefined;
}

function summariseIssues(issues: readonly ZodIssue[]): string {
  if (issues.length === 0) return "schema validation failed";
  const first = issues[0];
  const path = formatPath(first.path);
  if (path) return `${path}: ${first.message}`;
  return first.message;
}

function formatPath(path: ReadonlyArray<string | number>): string {
  return path.map((segment) => (typeof segment === "number" ? `[${segment}]` : segment)).join(".");
}

function formatValues(values: readonly unknown[]): string {
  return values.map((v) => formatValue(v)).join(", ");
}

function formatValue(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  return String(value);
}
