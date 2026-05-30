/**
 * Destructive-tool schemas (Phase 1 Group 6).
 *
 * Two discriminated unions — `project_delete` (on `mode`) and
 * `task_delete` (on `action`, then on `mode` inside each branch).
 *
 * Safety contract per plan §3.3 / §3.6:
 *   - `mode = "dry_run"` is frictionless — no `confirm`, no `reason`.
 *     Returns affected count + sample so callers can sanity-check.
 *   - `mode = "execute"` requires only a literal `confirm: true`. A
 *     schema-level literal makes "pasted defaults" impossible to slip
 *     through. The audit `reason` is no longer typed by the user —
 *     `task_delete` fills it server-side (feature-hierarchy Workstream A:
 *     single-confirm delete). `project_delete` still requires a typed reason.
 *
 * The schemas are co-located so the audit-script (Group 6.7) can scan a
 * single file when verifying no other code path can reach mass-delete.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────
// 6.1 — project_delete
// ────────────────────────────────────────────────────────────────────────

export const projectDeleteSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("dry_run"),
    projectId: z.string().min(1),
  }),
  z.object({
    mode: z.literal("execute"),
    projectId: z.string().min(1),
    reason: z.string().min(10, {
      message: "reason must be at least 10 characters — explain why this project is being deleted.",
    }),
    confirm: z.literal(true, {
      errorMap: () => ({ message: "confirm must equal literal `true` for destructive execute." }),
    }),
  }),
]);

export type ProjectDeleteInput = z.infer<typeof projectDeleteSchema>;

// ────────────────────────────────────────────────────────────────────────
// 6.2 — task_delete (action × mode)
// ────────────────────────────────────────────────────────────────────────

// Discriminating on a single key keeps the JSON Schema small and the
// branches easy to inspect. We synthesize a compound discriminator by
// concatenating action + mode into one string. The handler splits it
// back on dispatch.
//
// Why compound: zod's `discriminatedUnion` only takes one discriminator.
// Nesting two unions adds verbosity for no semantic gain, and a flat
// list of six literal strings is cleanest for agents to read.
const ACTION_MODE_LITERAL = z.enum([
  "delete_one.dry_run",
  "delete_one.execute",
  "delete_many.dry_run",
  "delete_many.execute",
  "clear_all_for_project.dry_run",
  "clear_all_for_project.execute",
]);
export type TaskDeleteActionMode = z.infer<typeof ACTION_MODE_LITERAL>;

// We expose the union via a structurally familiar shape — `action` +
// `mode` separately on the wire — by accepting both forms and
// normalising via a Zod transform. Schema validation is cleanest when
// the user writes `{action: "delete_one", mode: "execute", ...}`.
export const taskDeleteSchema = z.discriminatedUnion("op", [
  // ── delete_one ────────────────────────────────────────────────────
  z.object({
    op: z.literal("delete_one.dry_run"),
    action: z.literal("delete_one"),
    mode: z.literal("dry_run"),
    taskId: z.string().min(1),
  }),
  z.object({
    op: z.literal("delete_one.execute"),
    action: z.literal("delete_one"),
    mode: z.literal("execute"),
    taskId: z.string().min(1),
    confirm: z.literal(true),
  }),

  // ── delete_many ───────────────────────────────────────────────────
  z.object({
    op: z.literal("delete_many.dry_run"),
    action: z.literal("delete_many"),
    mode: z.literal("dry_run"),
    taskIds: z.array(z.string().min(1)).min(1),
  }),
  z.object({
    op: z.literal("delete_many.execute"),
    action: z.literal("delete_many"),
    mode: z.literal("execute"),
    taskIds: z.array(z.string().min(1)).min(1),
    confirm: z.literal(true),
  }),

  // ── clear_all_for_project ─────────────────────────────────────────
  z.object({
    op: z.literal("clear_all_for_project.dry_run"),
    action: z.literal("clear_all_for_project"),
    mode: z.literal("dry_run"),
    projectId: z.string().min(1),
  }),
  z.object({
    op: z.literal("clear_all_for_project.execute"),
    action: z.literal("clear_all_for_project"),
    mode: z.literal("execute"),
    projectId: z.string().min(1),
    confirm: z.literal(true),
  }),
]);

export type TaskDeleteInput = z.infer<typeof taskDeleteSchema>;

/**
 * Helper for callers that supply `{action, mode}` without the compound
 * `op` discriminator — derives it for `safeParseTool`. Public so the
 * MCP dispatch and Express routes can both call it consistently.
 */
export function withDeriveOp(input: unknown): unknown {
  if (input && typeof input === "object" && !("op" in input)) {
    const i = input as Record<string, unknown>;
    if (typeof i.action === "string" && typeof i.mode === "string") {
      return { ...i, op: `${i.action}.${i.mode}` };
    }
  }
  return input;
}
