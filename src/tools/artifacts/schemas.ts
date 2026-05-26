/**
 * `artifact_record` schema (Phase 1 Group 9).
 *
 * Append-only artifact ingestion for a task. Discriminated on `kind`
 * with seven branches, each enforcing its own required fields at the
 * JSON Schema layer so an agent reading the contract sees the per-kind
 * requirements without trial-and-error:
 *
 *   - finding       — generic structured note (type + content required)
 *   - test_log      — test output capture (outcome + content required)
 *   - build_log     — build output capture (outcome + content required)
 *   - reference     — pointer to external doc/spec (url required)
 *   - commit        — git commit (sha + message required)
 *   - pull_request  — PR with lifecycle status (url + status required)
 *   - evidence      — flexible evidence payload (content required)
 *
 * `project_id` is resolved server-side from `task_id` (Group 1.8 helper
 * in the DB adapter), so the schema deliberately does not surface it.
 *
 * Plan refs: §3.7, §6.4 (no separate UPDATE/DELETE — append-only).
 */

import { z } from "zod";

const TASK_ID = z.string().min(1);

const OUTCOME = z.enum(["pass", "fail", "skip", "unknown"]);

const PR_STATUS = z.enum(["open", "merged", "closed", "draft"]);

// Optional fields that apply to multiple branches without changing the
// per-kind required set.
const COMMON_OPTIONAL = {
  metadata: z.record(z.unknown()).optional(),
  createdBy: z.string().min(1).optional(),
} as const;

export const artifactRecordSchema = z.discriminatedUnion("kind", [
  // ── finding ──────────────────────────────────────────────────────
  z.object({
    kind: z.literal("finding"),
    taskId: TASK_ID,
    type: z
      .string()
      .min(1)
      .describe(
        "Sub-classification within the finding kind (e.g. 'decision', 'lessons', 'success')."
      ),
    content: z.unknown().refine((v) => v !== undefined, {
      message: "content is required for finding artifacts.",
    }),
    ...COMMON_OPTIONAL,
  }),

  // ── test_log ─────────────────────────────────────────────────────
  z.object({
    kind: z.literal("test_log"),
    taskId: TASK_ID,
    outcome: OUTCOME,
    content: z.unknown().refine((v) => v !== undefined, {
      message: "content is required for test_log artifacts.",
    }),
    suite: z.string().min(1).optional(),
    durationMs: z.number().nonnegative().optional(),
    ...COMMON_OPTIONAL,
  }),

  // ── build_log ────────────────────────────────────────────────────
  z.object({
    kind: z.literal("build_log"),
    taskId: TASK_ID,
    outcome: OUTCOME,
    content: z.unknown().refine((v) => v !== undefined, {
      message: "content is required for build_log artifacts.",
    }),
    toolchain: z.string().min(1).optional(),
    durationMs: z.number().nonnegative().optional(),
    ...COMMON_OPTIONAL,
  }),

  // ── reference ────────────────────────────────────────────────────
  z.object({
    kind: z.literal("reference"),
    taskId: TASK_ID,
    url: z.string().min(1, {
      message: "url is required for reference artifacts.",
    }),
    title: z.string().min(1).optional(),
    note: z.string().optional(),
    ...COMMON_OPTIONAL,
  }),

  // ── commit ───────────────────────────────────────────────────────
  z.object({
    kind: z.literal("commit"),
    taskId: TASK_ID,
    sha: z.string().min(7, {
      message: "sha must be at least 7 chars — short SHAs are fine, but provide something.",
    }),
    message: z.string().min(1, {
      message: "message is required for commit artifacts.",
    }),
    url: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
    ...COMMON_OPTIONAL,
  }),

  // ── pull_request ─────────────────────────────────────────────────
  z.object({
    kind: z.literal("pull_request"),
    taskId: TASK_ID,
    url: z.string().min(1, {
      message: "url is required for pull_request artifacts.",
    }),
    status: PR_STATUS,
    title: z.string().min(1).optional(),
    author: z.string().min(1).optional(),
    ...COMMON_OPTIONAL,
  }),

  // ── evidence ─────────────────────────────────────────────────────
  z.object({
    kind: z.literal("evidence"),
    taskId: TASK_ID,
    content: z.unknown().refine((v) => v !== undefined, {
      message: "content is required for evidence artifacts.",
    }),
    type: z.string().min(1).optional(),
    ...COMMON_OPTIONAL,
  }),
]);

export type ArtifactRecordInput = z.infer<typeof artifactRecordSchema>;
