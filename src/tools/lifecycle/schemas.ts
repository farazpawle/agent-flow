/**
 * task_lifecycle schemas (Phase 1 Group 7).
 *
 * Two layered discriminated unions:
 *   - Outer (action): claim, start, block, unblock, request_review,
 *     finalize, reopen, archive. Only `finalize` requires
 *     `expectedVersion` — all other actions are atomic per-task
 *     transitions that still bump `tasks.version` server-side.
 *   - Inner (finalizeResult.verdict): pass, fail, partial, needs_review.
 *     Each verdict has its own required fields so the JSON Schema's
 *     nested `oneOf` blocks tell an agent exactly what to send.
 *
 * Plan refs: §3.4, §6.4, §10 Phase-1 acceptance bullet for task_lifecycle.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────
// 7.1 — nested finalizeResult discriminated union (verdict)
// ────────────────────────────────────────────────────────────────────────

const PASS_LESSONS = z
  .string()
  .min(10, {
    message:
      "lessonsLearned must be at least 10 characters — capture an actionable takeaway, not a one-word note.",
  })
  .optional();

export const finalizeResultSchema = z.discriminatedUnion("verdict", [
  z.object({
    verdict: z.literal("pass"),
    summary: z.string().min(10, {
      message: "summary must be at least 10 characters — describe what was accomplished.",
    }),
    lessonsLearned: PASS_LESSONS,
  }),
  z.object({
    verdict: z.literal("fail"),
    summary: z.string().min(10, {
      message: "summary must be at least 10 characters — describe what was attempted.",
    }),
    failureReason: z.string().min(10, {
      message: "failureReason must be at least 10 characters — explain the root cause.",
    }),
    nextStrategy: z.string().min(10, {
      message: "nextStrategy must be at least 10 characters — describe the next approach to try.",
    }),
    lessonsLearned: PASS_LESSONS,
  }),
  z.object({
    verdict: z.literal("partial"),
    summary: z.string().min(10),
    failureReason: z.string().min(10, {
      message:
        "failureReason must be at least 10 characters — partial completion still requires a reason for what remained undone.",
    }),
    nextStrategy: z.string().min(10, {
      message:
        "nextStrategy must be at least 10 characters — describe how the remainder will be addressed.",
    }),
    lessonsLearned: PASS_LESSONS,
  }),
  z.object({
    verdict: z.literal("needs_review"),
    summary: z.string().min(10),
    reviewQuestion: z.string().min(10, {
      message:
        "reviewQuestion must be at least 10 characters — pose the specific question reviewers need to answer.",
    }),
    lessonsLearned: PASS_LESSONS,
  }),
]);

export type FinalizeResult = z.infer<typeof finalizeResultSchema>;

// ────────────────────────────────────────────────────────────────────────
// 7.2 — outer action discriminated union
// ────────────────────────────────────────────────────────────────────────

const TASK_ID = z.string().min(1);

// Wave 1 §10.C — clientId identifies the agent for multi-agent lock
// ownership. Optional at the schema level so legacy callers don't break;
// the handler treats absence as a synthetic "(anonymous)" identity. HTTP
// callers can pass it in the body; MCP callers can pass it in tool args.
const CLIENT_ID = z.string().min(1).optional();

// Lifecycle actions other than `finalize` are best-effort state
// transitions: the handler enforces the state machine and bumps the
// version atomically, but the caller doesn't need to pre-fetch the
// version. `finalize` is the only one that materially changes the
// outcome (lessons, artifacts), so plan §3.4 puts CAS only there.
export const taskLifecycleSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("claim"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
    agent: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal("start"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
  }),
  z.object({
    action: z.literal("block"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
    reason: z.string().min(10, {
      message: "reason must be at least 10 characters — explain what is blocking this task.",
    }),
  }),
  z.object({
    action: z.literal("unblock"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
    note: z.string().optional(),
  }),
  z.object({
    action: z.literal("request_review"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
    reviewQuestion: z.string().min(10).optional(),
  }),
  z.object({
    action: z.literal("finalize"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
    expectedVersion: z.number().int().positive(),
    result: finalizeResultSchema,
  }),
  z.object({
    action: z.literal("reopen"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
    reason: z.string().min(10, {
      message: "reason must be at least 10 characters — describe why this task is being reopened.",
    }),
  }),
  z.object({
    action: z.literal("archive"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
  }),
  // Wave 1 §10.C — heartbeat extends `claim_expires_at` for the live
  // claim held by `clientId`. Returns TASK_LOCKED if the caller is not
  // the holder (or the claim has already expired).
  z.object({
    action: z.literal("heartbeat"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
  }),
  // Wave 1 §10.C — release drops the claim and flips status to PENDING
  // (the abandonment path that Wave 2 §10.F upgrades with LLM narration).
  z.object({
    action: z.literal("release"),
    taskId: TASK_ID,
    clientId: CLIENT_ID,
    note: z.string().optional(),
  }),
]);

export type TaskLifecycleInput = z.infer<typeof taskLifecycleSchema>;
