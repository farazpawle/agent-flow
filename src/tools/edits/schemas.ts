/**
 * Edit-tool schemas (Phase 1 Group 5).
 *
 * Two discriminated unions. Each action's required fields surface
 * directly in the JSON Schema (visible in `tests/fixtures/schemas/*.json`)
 * so an agent reading the contract sees per-action requirements without
 * having to call the tool first.
 *
 * Plan refs: §3.2 (project_edit), §3.5 (task_edit), §6 (OCC contract).
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────
// 5.1 — project_edit
// ────────────────────────────────────────────────────────────────────────

export const projectEditSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    name: z.string().min(1),
    description: z.string().min(1),
    path: z.string().optional(),
    gitRemoteUrl: z.string().optional(),
    techStack: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("update"),
    projectId: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    path: z.string().optional(),
    gitRemoteUrl: z.string().optional(),
    techStack: z.array(z.string()).optional(),
  }),
  z.object({
    action: z.literal("set_active"),
    projectId: z.string().min(1),
    // Plan §3.2 — set_active is client-scoped. The clientId is mandatory
    // so two agents sharing the same server can never overwrite each
    // other's context. No global state is touched.
    clientId: z.string().min(1),
  }),
  // Wave 1 §10.D — task groups (feature/epic clusters within a project).
  z.object({
    action: z.literal("create_group"),
    projectId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal("update_group"),
    groupId: z.string().min(1),
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(["active", "completed", "archived"]).optional(),
  }),
]);

export type ProjectEditInput = z.infer<typeof projectEditSchema>;

// ────────────────────────────────────────────────────────────────────────
// 5.2 — task_edit
// ────────────────────────────────────────────────────────────────────────

const PRIORITY_ENUM = z.enum(["critical", "high", "medium", "low"]);

const TASK_FIELDS = {
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  notes: z.string().optional(),
  problemStatement: z.string().optional(),
  technicalPlan: z.string().optional(),
  implementationGuide: z.string().optional(),
  verificationCriteria: z.string().optional(),
  priority: PRIORITY_ENUM.optional(),
} as const;

const NEW_TASK_SHAPE = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  notes: z.string().optional(),
  problemStatement: z.string().optional(),
  technicalPlan: z.string().optional(),
  implementationGuide: z.string().optional(),
  verificationCriteria: z.string().optional(),
  priority: PRIORITY_ENUM.optional(),
  /**
   * Optional reference to OTHER tasks in the same payload. The handler
   * resolves these by 1-based index ("after item 0") or by the new
   * task's `name`. Cross-batch deps (to tasks that already exist) are
   * supplied via `existingDependencies` to keep the two namespaces
   * unambiguous.
   */
  dependsOnNewIndex: z.array(z.number().int().nonnegative()).optional(),
  existingDependencies: z.array(z.string().min(1)).optional(),
});

export const taskEditSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    projectId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    notes: z.string().optional(),
    problemStatement: z.string().optional(),
    technicalPlan: z.string().optional(),
    implementationGuide: z.string().optional(),
    verificationCriteria: z.string().optional(),
    priority: PRIORITY_ENUM.optional(),
    dependencies: z.array(z.string()).optional(),
    // Wave 1 §10.D — optional group membership + parent/child hierarchy.
    // A subtask must share its parent's groupId; no grandchildren allowed
    // (the parent itself must not be a subtask). Validation in handler.
    groupId: z.string().min(1).optional(),
    parentTaskId: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal("update"),
    taskId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    ...TASK_FIELDS,
  }),
  z.object({
    action: z.literal("reorder"),
    projectId: z.string().min(1),
    taskIds: z.array(z.string()).min(2),
    expectedVersions: z.record(z.string(), z.number().int().positive()),
  }),
  z.object({
    action: z.literal("set_priority"),
    taskId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    priority: PRIORITY_ENUM,
  }),
  z.object({
    action: z.literal("set_dependency"),
    taskId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    dependsOn: z.string().min(1),
  }),
  z.object({
    action: z.literal("clear_dependency"),
    taskId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    dependsOn: z.string().min(1),
  }),
  z.object({
    action: z.literal("split"),
    taskId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    newTasks: z.array(NEW_TASK_SHAPE).min(2),
  }),
  z.object({
    action: z.literal("merge"),
    taskIds: z.array(z.string()).min(2),
    expectedVersions: z.record(z.string(), z.number().int().positive()),
    into: z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      notes: z.string().optional(),
      problemStatement: z.string().optional(),
      technicalPlan: z.string().optional(),
      implementationGuide: z.string().optional(),
      verificationCriteria: z.string().optional(),
      priority: PRIORITY_ENUM.optional(),
    }),
  }),
  // Wave 2 §10.H — append-only notes audit. The server prepends an ISO-
  // timestamped block to `task.notes` so the most-recent entry surfaces
  // first. Appends never overwrite. NOTE: the dashboard now exposes a
  // permanent per-note hard delete via the `delete_note` branch below
  // (task-detail-ux-improvements §A), so the trail is no longer strictly
  // append-only from the GUI — programmatic callers should still prefer
  // appending a correction over deleting.
  z.object({
    action: z.literal("append_note"),
    taskId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    text: z.string().min(1, {
      message: "text must be at least 1 character — note body cannot be empty.",
    }),
  }),
  // task-detail-ux-improvements §A — permanent per-note hard delete.
  // Identifies the target note by its exact (trimmed) block text and is
  // guarded by optimistic concurrency, so it is safe under concurrent
  // edits. `noteText` must match a block produced by the same split the
  // frontend `parseNotes()` uses (`/\n(?=\[)/`, trimmed).
  z.object({
    action: z.literal("delete_note"),
    taskId: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    noteText: z.string().min(1, {
      message: "noteText must be the exact trimmed block text of the note to remove.",
    }),
  }),
]);

export type TaskEditInput = z.infer<typeof taskEditSchema>;
