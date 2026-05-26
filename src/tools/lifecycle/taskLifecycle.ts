/**
 * `task_lifecycle` — Phase 1 Group 7.
 *
 * Eight state transitions (claim, start, block, unblock, request_review,
 * finalize, reopen, archive) governed by an explicit state machine. The
 * only action that materially writes outcome data (lessons, evidence) is
 * `finalize`; it is the only branch that demands `expectedVersion` and
 * routes through `withVersionCheck` for optimistic concurrency.
 *
 * All actions:
 *   - reject illegal transitions with a typed `ConflictError`
 *   - bump `tasks.version` by exactly 1 (CAS for finalize, in-tx update
 *     for everything else)
 *   - run inside `withToolTelemetry` so timing/outcome lands in logs
 *
 * Lessons-learned handling on `finalize`:
 *   - When `result.lessonsLearned` is provided, the handler writes a
 *     `task_findings` row with `kind='finding'`, `type='lessons'` (or
 *     `type='success'` when the verdict is pass) — same denormalisation
 *     path used by `artifact_record` in Group 9 (the `createFinding`
 *     adapter auto-resolves project_id from task_id).
 *
 * Plan refs: §3.4 (state machine), §6.4 (CONFLICT body).
 */

import { db } from "../../models/db.js";
import { ConflictError, NotFoundError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import { withVersionCheck } from "../../models/concurrency.js";
import type { Task } from "../../types/index.js";
import { TaskStatus } from "../../types/index.js";
import type { FinalizeResult, TaskLifecycleInput } from "./schemas.js";

type TaskWithVersion = Task & { version?: number };

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function loadOrThrow(taskId: string): Promise<TaskWithVersion> {
  const task = await db.getTask(taskId);
  if (!task) {
    throw new NotFoundError(`Task not found: ${taskId}`, {
      hint: "Call task_view(action='get', taskId) to confirm the id.",
    });
  }
  return task as TaskWithVersion;
}

// ────────────────────────────────────────────────────────────────────────
// State machine (plan §3.4 — illegal transitions throw CONFLICT)
// ────────────────────────────────────────────────────────────────────────

type LifecycleAction = TaskLifecycleInput["action"];

const TRANSITIONS: Record<LifecycleAction, readonly TaskStatus[]> = {
  claim: [TaskStatus.PENDING],
  start: [TaskStatus.PENDING, TaskStatus.BLOCKED],
  block: [TaskStatus.PENDING, TaskStatus.IN_PROGRESS],
  unblock: [TaskStatus.BLOCKED],
  request_review: [TaskStatus.IN_PROGRESS],
  finalize: [TaskStatus.IN_PROGRESS],
  reopen: [TaskStatus.COMPLETED],
  archive: [TaskStatus.COMPLETED],
};

function ensureTransition(action: LifecycleAction, task: TaskWithVersion): void {
  const allowed = TRANSITIONS[action];
  if (!allowed.includes(task.status)) {
    throw new ConflictError(`task_lifecycle(${action}) is not legal from status="${task.status}"`, {
      hint: `Allowed source statuses: ${allowed.join(", ")}. Call task_view(action='get') to see the current state.`,
      details: {
        code: "ILLEGAL_TRANSITION",
        taskId: task.id,
        action,
        currentStatus: task.status,
        allowedFromStatuses: [...allowed],
      },
    });
  }
}

/**
 * Bump `tasks.version` and persist `next`. Used by every non-finalize
 * action. Reads the current row's version, increments, writes back via
 * `saveTask`. Finalize uses `withVersionCheck` instead because the caller
 * supplied `expectedVersion`.
 */
async function persistBumped(next: TaskWithVersion): Promise<TaskWithVersion> {
  const currentVersion = next.version ?? 1;
  next.version = currentVersion + 1;
  next.updatedAt = new Date();
  await db.saveTask(next);
  return next;
}

// ────────────────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────────────────

export async function taskLifecycle(input: TaskLifecycleInput) {
  return withToolTelemetry({ tool: "task_lifecycle" }, () => dispatch(input));
}

async function dispatch(input: TaskLifecycleInput) {
  switch (input.action) {
    case "claim":
      return claim(input);
    case "start":
      return start(input);
    case "block":
      return block(input);
    case "unblock":
      return unblock(input);
    case "request_review":
      return requestReview(input);
    case "finalize":
      return finalize(input);
    case "reopen":
      return reopen(input);
    case "archive":
      return archive(input);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Individual actions
// ────────────────────────────────────────────────────────────────────────

async function claim(input: Extract<TaskLifecycleInput, { action: "claim" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("claim", task);
  // Claim doesn't change status — it records ownership in `notes`-like
  // metadata. Status stays PENDING; the agent calls `start` next.
  if (input.agent) {
    const tag = `[claimed by ${input.agent} at ${new Date().toISOString()}]`;
    task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  }
  const saved = await persistBumped(task);
  return asToolText({ action: "claim", task: saved, newVersion: saved.version });
}

async function start(input: Extract<TaskLifecycleInput, { action: "start" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("start", task);
  task.status = TaskStatus.IN_PROGRESS;
  // Starting fresh wipes stale verification state so the
  // request_review → finalize cycle runs cleanly.
  (task as TaskWithVersion & { verificationStatus?: string }).verificationStatus = undefined;
  task.completedAt = undefined;
  const saved = await persistBumped(task);
  return asToolText({ action: "start", task: saved, newVersion: saved.version });
}

async function block(input: Extract<TaskLifecycleInput, { action: "block" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("block", task);
  task.status = TaskStatus.BLOCKED;
  const tag = `[blocked: ${input.reason}]`;
  task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  const saved = await persistBumped(task);
  return asToolText({
    action: "block",
    task: saved,
    newVersion: saved.version,
    reason: input.reason,
  });
}

async function unblock(input: Extract<TaskLifecycleInput, { action: "unblock" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("unblock", task);
  task.status = TaskStatus.PENDING;
  if (input.note) {
    const tag = `[unblocked: ${input.note}]`;
    task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  }
  const saved = await persistBumped(task);
  return asToolText({ action: "unblock", task: saved, newVersion: saved.version });
}

async function requestReview(input: Extract<TaskLifecycleInput, { action: "request_review" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("request_review", task);
  // Status stays IN_PROGRESS — request_review is metadata signalling the
  // agent wants a second pass before finalize. We record it on
  // verificationStatus so `task_view` can surface it.
  (task as TaskWithVersion & { verificationStatus?: string }).verificationStatus = "requested";
  if (input.reviewQuestion) {
    const tag = `[review requested: ${input.reviewQuestion}]`;
    task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  }
  const saved = await persistBumped(task);
  return asToolText({
    action: "request_review",
    task: saved,
    newVersion: saved.version,
  });
}

async function reopen(input: Extract<TaskLifecycleInput, { action: "reopen" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("reopen", task);
  task.status = TaskStatus.PENDING;
  task.completedAt = undefined;
  (task as TaskWithVersion & { verificationStatus?: string }).verificationStatus = undefined;
  const tag = `[reopened: ${input.reason}]`;
  task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  const saved = await persistBumped(task);
  return asToolText({ action: "reopen", task: saved, newVersion: saved.version });
}

async function archive(input: Extract<TaskLifecycleInput, { action: "archive" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("archive", task);
  // Archive is a soft-state — we tag the task in notes. There's no
  // ARCHIVED enum entry yet; the GUI surfaces archived rows by reading
  // the tag. A dedicated status can land later without breaking callers.
  const tag = `[archived at ${new Date().toISOString()}]`;
  task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  const saved = await persistBumped(task);
  return asToolText({ action: "archive", task: saved, newVersion: saved.version });
}

// ────────────────────────────────────────────────────────────────────────
// finalize — the only branch that requires `expectedVersion`
// ────────────────────────────────────────────────────────────────────────

async function finalize(input: Extract<TaskLifecycleInput, { action: "finalize" }>) {
  const existing = await loadOrThrow(input.taskId);
  ensureTransition("finalize", existing);

  const { value, newVersion } = await withVersionCheck(
    input.taskId,
    input.expectedVersion,
    async () => applyFinalize(existing, input.result, input.expectedVersion)
  );

  // 7.6 — record a lessons finding when supplied. We do this outside
  // the version-check transaction because findings are append-only and
  // a failure here should not roll back the lifecycle transition.
  let findingId: string | undefined;
  if (input.result.lessonsLearned) {
    const finding = await db.createFinding({
      taskId: input.taskId,
      kind: "finding",
      type: input.result.verdict === "pass" ? "success" : "lessons",
      content: {
        verdict: input.result.verdict,
        summary: input.result.summary,
        lessonsLearned: input.result.lessonsLearned,
        ...("failureReason" in input.result ? { failureReason: input.result.failureReason } : {}),
        ...("nextStrategy" in input.result ? { nextStrategy: input.result.nextStrategy } : {}),
        ...("reviewQuestion" in input.result
          ? { reviewQuestion: input.result.reviewQuestion }
          : {}),
      },
    });
    findingId = finding.id;
  }

  return asToolText({
    action: "finalize",
    task: value,
    newVersion,
    verdict: input.result.verdict,
    ...(findingId ? { findingId } : {}),
  });
}

function applyFinalize(
  existing: TaskWithVersion,
  result: FinalizeResult,
  expectedVersion: number
): Promise<TaskWithVersion> {
  const next: TaskWithVersion = { ...existing };
  next.version = expectedVersion + 1;
  next.updatedAt = new Date();

  switch (result.verdict) {
    case "pass":
      next.status = TaskStatus.COMPLETED;
      next.completedAt = new Date();
      next.summary = result.summary;
      next.finalOutcome = result.summary;
      if (result.lessonsLearned) next.lessonsLearned = result.lessonsLearned;
      (next as TaskWithVersion & { verificationStatus?: string }).verificationStatus = "passed";
      break;
    case "fail":
      // Failure does NOT collapse the task to COMPLETED. We leave
      // status at IN_PROGRESS so the agent can attempt the
      // nextStrategy, but stash the failure context.
      next.summary = result.summary;
      next.finalOutcome = `FAIL: ${result.failureReason}\nNext: ${result.nextStrategy}`;
      if (result.lessonsLearned) next.lessonsLearned = result.lessonsLearned;
      (next as TaskWithVersion & { verificationStatus?: string }).verificationStatus = "failed";
      break;
    case "partial":
      next.summary = result.summary;
      next.finalOutcome = `PARTIAL: ${result.failureReason}\nNext: ${result.nextStrategy}`;
      if (result.lessonsLearned) next.lessonsLearned = result.lessonsLearned;
      (next as TaskWithVersion & { verificationStatus?: string }).verificationStatus = "partial";
      break;
    case "needs_review":
      next.summary = result.summary;
      next.finalOutcome = `NEEDS REVIEW: ${result.reviewQuestion}`;
      if (result.lessonsLearned) next.lessonsLearned = result.lessonsLearned;
      (next as TaskWithVersion & { verificationStatus?: string }).verificationStatus =
        "needs_review";
      break;
  }

  return db.saveTask(next).then(() => next);
}
