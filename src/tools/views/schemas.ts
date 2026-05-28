/**
 * Read-only view tool schemas (Phase 1 Group 4).
 *
 * Three discriminated unions, one per tool — `project_view`, `task_view`,
 * `context_get`. The shapes follow plan §3.1, §3.4, and §3.8 verbatim.
 * Discriminator key names are intentional: `action` for view/edit tools,
 * `type` for context_get, `kind` for artifact_record (Group 9), `mode`
 * for destructive tools (Group 6).
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────
// 4.1 — project_view
// ────────────────────────────────────────────────────────────────────────

export const projectViewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
  }),
  z.object({
    action: z.literal("get"),
    projectId: z.string().min(1),
  }),
  z.object({
    action: z.literal("summary"),
    projectId: z.string().min(1),
  }),
  z.object({
    action: z.literal("active"),
    // Plan §3.1: `active` resolves through `client_active_project`
    // for the calling agent. The client id is provided by the
    // transport layer (MCP `meta.clientId` or env `CLIENT_ID`);
    // exposing the field on the schema lets callers override.
    clientId: z.string().optional(),
  }),
  // Wave 1 §10.D — list groups with per-group status counts.
  z.object({
    action: z.literal("groups_list"),
    projectId: z.string().min(1),
  }),
]);

export type ProjectViewInput = z.infer<typeof projectViewSchema>;

// ────────────────────────────────────────────────────────────────────────
// 4.2 — task_view
// ────────────────────────────────────────────────────────────────────────

const TASK_STATUS_ENUM = z.enum([
  "all",
  "pending",
  "in_progress",
  "blocked",
  "review",
  "completed",
]);

const TASK_STATUS_STRICT_ENUM = z.enum([
  "pending",
  "in_progress",
  "blocked",
  "review",
  "completed",
]);

export const taskViewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    projectId: z.string().optional(),
    status: TASK_STATUS_ENUM.default("all"),
  }),
  z.object({
    action: z.literal("get"),
    taskId: z.string().min(1),
  }),
  z.object({
    action: z.literal("search"),
    query: z.string().min(1),
    projectId: z.string().optional(),
    limit: z.number().int().positive().max(50).default(10),
  }),
  z.object({
    action: z.literal("next_ready"),
    projectId: z.string().optional(),
  }),
  z.object({
    action: z.literal("by_status"),
    status: TASK_STATUS_STRICT_ENUM,
    projectId: z.string().optional(),
  }),
  // Wave 1 §10.D — flat tree of parent/child tasks scoped to a project,
  // optionally narrowed to a group. Returns skinny `{ id, name, status,
  // parentTaskId, children: [...] }` nodes.
  z.object({
    action: z.literal("tree"),
    projectId: z.string().min(1),
    groupId: z.string().min(1).optional(),
  }),
  // Wave 2 §10.G — ranked "what can I work on right now?" feed. Returns
  // PENDING tasks (deps met) plus IN_PROGRESS+expired-claim tasks. Skinny
  // shape by design — agents fetch full bodies via `task_view(get)`.
  z.object({
    action: z.literal("available"),
    projectId: z.string().min(1),
    groupId: z.string().min(1).optional(),
    limit: z.number().int().positive().max(100).default(20),
    clientId: z.string().min(1).optional(),
  }),
]);

export type TaskViewInput = z.infer<typeof taskViewSchema>;

// ────────────────────────────────────────────────────────────────────────
// 4.3 — context_get
// ────────────────────────────────────────────────────────────────────────

/**
 * Finding kinds accepted by `context_get(type=findings)`. Superset of the
 * artifact kinds in Group 9 (`artifact_record`).
 */
export const findingKindEnum = z.enum([
  "attempt",
  "blocker",
  "failure",
  "partial",
  "success",
  "decision",
  "reference",
  "test_log",
  "build_log",
  "commit",
  "pull_request",
  "evidence",
  "finding",
]);

export const contextGetSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("project_summary"),
    projectId: z.string().min(1),
    maxTokens: z.number().int().positive().default(2000),
  }),
  z.object({
    type: z.literal("implementation_context"),
    taskId: z.string().min(1),
    maxTokens: z.number().int().positive().default(3000),
  }),
  z.object({
    type: z.literal("verification_context"),
    taskId: z.string().min(1),
    maxTokens: z.number().int().positive().default(2000),
  }),
  z.object({
    type: z.literal("lessons"),
    topic: z.string().optional(),
    projectId: z.string().optional(),
    limit: z.number().int().positive().max(50).default(10),
    maxTokens: z.number().int().positive().default(2000),
  }),
  z.object({
    type: z.literal("similar_tasks"),
    taskId: z.string().min(1),
    limit: z.number().int().positive().max(20).default(5),
    maxTokens: z.number().int().positive().default(2000),
  }),
  z.object({
    type: z.literal("decisions"),
    projectId: z.string().min(1),
    since: z.string().datetime().optional(),
    maxTokens: z.number().int().positive().default(2000),
  }),
  z.object({
    type: z.literal("findings"),
    taskId: z.string().min(1),
    kinds: z.array(findingKindEnum).optional(),
    limit: z.number().int().positive().max(100).default(20),
    maxTokens: z.number().int().positive().default(3000),
  }),
  // Wave 3 §10.E — Project Skill index. Returns frontmatter + body +
  // an array of reference pointers (one per oversized topic). The body
  // already inlines the small topics; references are fetched lazily
  // via `type=skill_section`.
  z.object({
    type: z.literal("skill_index"),
    projectId: z.string().min(1),
    maxTokens: z.number().int().positive().default(4000),
  }),
  // Wave 3 §10.E — single reference section. Used by the GUI when a
  // user expands an overflowed topic.
  z.object({
    type: z.literal("skill_section"),
    projectId: z.string().min(1),
    topic: z.string().min(1),
    maxTokens: z.number().int().positive().default(3000),
  }),
]);

export type ContextGetInput = z.infer<typeof contextGetSchema>;
