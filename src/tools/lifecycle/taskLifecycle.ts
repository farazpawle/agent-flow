/**
 * `task_lifecycle` — Phase 1 Group 7 + Wave 1 §10.C multi-agent lock.
 *
 * Ten state transitions (claim, start, block, unblock, request_review,
 * finalize, reopen, archive, **heartbeat**, **release**) governed by an
 * explicit state machine. The only action that materially writes outcome
 * data (lessons, evidence) is `finalize`; it is the only branch that
 * demands `expectedVersion` and routes through `withVersionCheck` for
 * optimistic concurrency.
 *
 * Wave 1 lock semantics:
 *   - `claim`  atomically takes/renews the lock via `db.claimTask`.
 *   - `start` implicitly claims if unclaimed; if held by another live
 *     client it rejects with TASK_LOCKED.
 *   - `heartbeat` extends `claim_expires_at` via `db.extendTaskClaim`.
 *   - `release` drops the claim and flips status → PENDING. Wave 2 §10.F
 *     adds LLM-narrated reason; for now we append a `[released …]` note.
 *   - `finalize` (pass), `block`, `archive` clear the claim columns as
 *     terminal/blocking transitions. Other verdicts leave the claim in
 *     place for Wave 2 §10.F to revisit.
 *
 * All actions:
 *   - reject illegal transitions with a typed `ConflictError`
 *   - bump `tasks.version` (CAS for finalize, atomic UPDATE for claim/
 *     heartbeat, in-tx update for everything else)
 *   - run inside `withToolTelemetry` so timing/outcome lands in logs
 *
 * Plan refs: §3.4 (state machine), §6.4 (CONFLICT body), Wave 1 §10.C.
 */

import { db } from "../../models/db.js";
import {
  ConflictError,
  NotFoundError,
  TaskLockedError,
  ValidationError,
} from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import { recoverExpiredClaim, withVersionCheck } from "../../models/concurrency.js";
import type { Task } from "../../types/index.js";
import { TaskStatus } from "../../types/index.js";
import type { FinalizeResult, TaskLifecycleInput } from "./schemas.js";

type TaskWithVersion = Task & { version?: number };

const ANONYMOUS_CLIENT = "(anonymous)";

/**
 * Lock TTL in milliseconds. Default 30 minutes per Wave 1 locked
 * decision §4. Tests can override via `LOCK_TTL_MS=…` env to exercise
 * expiry behaviour without sleeping.
 */
function lockTtlMs(): number {
  const raw = process.env.LOCK_TTL_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 30 * 60 * 1000;
}

function resolveClientId(input: { clientId?: string }): string {
  return input.clientId && input.clientId.trim() ? input.clientId.trim() : ANONYMOUS_CLIENT;
}

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
  // Wave 2 §10.F — recover expired claims at read time so the subsequent
  // state-machine check sees the recovered PENDING state. Without this, a
  // re-claim after expiry would be rejected by `ensureTransition` because
  // the on-disk status is still IN_PROGRESS.
  const recovered = await recoverExpiredClaim(task as TaskWithVersion);
  return recovered as TaskWithVersion;
}

/**
 * Throw `TaskLockedError` if the task is currently claimed by a live
 * client other than `clientId`. Expired claims and unclaimed tasks pass
 * through silently — they're not blocking.
 *
 * Wire body: `{ code: 'TASK_LOCKED', details: { heldBy, since, expiresAt } }`
 * (plan §6.4).
 */
function assertLockHeldBy(task: TaskWithVersion, clientId: string): void {
  if (!task.claimedBy) return; // unclaimed — no contention
  const expires = task.claimExpiresAt ? task.claimExpiresAt.getTime() : 0;
  if (expires < Date.now()) return; // expired — treat as free
  if (task.claimedBy === clientId) return; // same holder
  throw new TaskLockedError(`Task ${task.id} is currently claimed by ${task.claimedBy}`, {
    hint: "Wait for the claim to expire or call task_lifecycle(action='heartbeat'|'release') from the holder.",
    details: {
      code: "TASK_LOCKED",
      taskId: task.id,
      heldBy: task.claimedBy,
      since: task.claimedAt ? task.claimedAt.toISOString() : null,
      expiresAt: task.claimExpiresAt ? task.claimExpiresAt.toISOString() : null,
    },
  });
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
  // Wave 1 §10.C additions:
  heartbeat: [TaskStatus.IN_PROGRESS],
  release: [TaskStatus.IN_PROGRESS],
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
 * Bump `tasks.version` and persist `next`. Used by every non-finalize,
 * non-lock action. Reads the current row's version, increments, writes
 * back via `saveTask`. Finalize uses `withVersionCheck` instead because
 * the caller supplied `expectedVersion`. Lock-touching actions (`claim`,
 * `heartbeat`) bump version inside the atomic UPDATE so this helper is
 * not used for them.
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
    case "heartbeat":
      return heartbeat(input);
    case "release":
      return release(input);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Individual actions
// ────────────────────────────────────────────────────────────────────────

async function claim(input: Extract<TaskLifecycleInput, { action: "claim" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("claim", task);
  const clientId = resolveClientId(input);
  const result = await db.claimTask(input.taskId, clientId, lockTtlMs());
  if (!result.ok) {
    throw new TaskLockedError(`Task ${input.taskId} is currently claimed by ${result.heldBy}`, {
      hint: "Wait for the claim to expire or call task_lifecycle(action='heartbeat'|'release') from the holder.",
      details: {
        code: "TASK_LOCKED",
        taskId: input.taskId,
        heldBy: result.heldBy,
        since: result.claimedAt.toISOString(),
        expiresAt: result.claimExpiresAt.toISOString(),
      },
    });
  }
  // Back-compat: when caller passes `agent`, still tag notes so legacy
  // human-readable trails keep working. Skipped for the synthetic
  // anonymous holder.
  if (input.agent) {
    const reloaded = await loadOrThrow(input.taskId);
    const tag = `[claimed by ${input.agent} at ${new Date().toISOString()}]`;
    reloaded.notes = reloaded.notes ? `${reloaded.notes}\n${tag}` : tag;
    reloaded.updatedAt = new Date();
    await db.saveTask(reloaded);
  }
  const final = await loadOrThrow(input.taskId);
  return asToolText({
    action: "claim",
    task: final,
    newVersion: result.newVersion,
    lock: {
      heldBy: clientId,
      since: result.claimedAt.toISOString(),
      expiresAt: result.claimExpiresAt.toISOString(),
    },
  });
}

async function start(input: Extract<TaskLifecycleInput, { action: "start" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("start", task);
  const clientId = resolveClientId(input);
  // Implicit-claim semantics: try to take the lock first. If someone else
  // holds a live claim we reject TASK_LOCKED. Re-claim by the same client
  // is idempotent renewal. The atomic claimTask already bumps version, so
  // we update the status row via plain saveTask (no second bump) to keep
  // the version monotone-by-one per lifecycle call.
  const claimResult = await db.claimTask(input.taskId, clientId, lockTtlMs());
  if (!claimResult.ok) {
    throw new TaskLockedError(
      `Task ${input.taskId} is currently claimed by ${claimResult.heldBy}`,
      {
        hint: "Wait for the claim to expire or call task_lifecycle(action='release') from the holder before starting.",
        details: {
          code: "TASK_LOCKED",
          taskId: input.taskId,
          heldBy: claimResult.heldBy,
          since: claimResult.claimedAt.toISOString(),
          expiresAt: claimResult.claimExpiresAt.toISOString(),
        },
      }
    );
  }
  const reloaded = await loadOrThrow(input.taskId);
  reloaded.status = TaskStatus.IN_PROGRESS;
  (reloaded as TaskWithVersion & { verificationStatus?: string }).verificationStatus = undefined;
  reloaded.completedAt = undefined;
  reloaded.updatedAt = new Date();
  await db.saveTask(reloaded);
  return asToolText({
    action: "start",
    task: reloaded,
    newVersion: claimResult.newVersion,
    lock: {
      heldBy: clientId,
      since: claimResult.claimedAt.toISOString(),
      expiresAt: claimResult.claimExpiresAt.toISOString(),
    },
  });
}

async function block(input: Extract<TaskLifecycleInput, { action: "block" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("block", task);
  assertLockHeldBy(task, resolveClientId(input));
  task.status = TaskStatus.BLOCKED;
  // Wave 1 §10.C — clearing on blocking transition. We null the in-memory
  // copy too so the saveTask UPSERT writes NULLs to the lock columns.
  task.claimedBy = undefined;
  task.claimedAt = undefined;
  task.claimExpiresAt = undefined;
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
  assertLockHeldBy(task, resolveClientId(input));
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
  // Defensive: ensure no stale claim from prior pass-finalize lingers.
  task.claimedBy = undefined;
  task.claimedAt = undefined;
  task.claimExpiresAt = undefined;
  const tag = `[reopened: ${input.reason}]`;
  task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  const saved = await persistBumped(task);
  return asToolText({ action: "reopen", task: saved, newVersion: saved.version });
}

async function archive(input: Extract<TaskLifecycleInput, { action: "archive" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("archive", task);
  // Completed tasks shouldn't carry a live claim, but clear defensively.
  task.claimedBy = undefined;
  task.claimedAt = undefined;
  task.claimExpiresAt = undefined;
  // Archive is a soft-state — we tag the task in notes. There's no
  // ARCHIVED enum entry yet; the GUI surfaces archived rows by reading
  // the tag. A dedicated status can land later without breaking callers.
  const tag = `[archived at ${new Date().toISOString()}]`;
  task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  const saved = await persistBumped(task);
  return asToolText({ action: "archive", task: saved, newVersion: saved.version });
}

// ────────────────────────────────────────────────────────────────────────
// Wave 1 §10.C — heartbeat + release
// ────────────────────────────────────────────────────────────────────────

async function heartbeat(input: Extract<TaskLifecycleInput, { action: "heartbeat" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("heartbeat", task);
  const clientId = resolveClientId(input);
  const result = await db.extendTaskClaim(input.taskId, clientId, lockTtlMs());
  if (!result.ok) {
    // Either the caller is not the holder or the claim already expired.
    // Surface the current holder so the caller can react (re-claim or back off).
    const current = await loadOrThrow(input.taskId);
    throw new TaskLockedError(
      `Task ${input.taskId} cannot be heartbeated by ${clientId} — claim not held or expired`,
      {
        hint: "Re-claim the task via task_lifecycle(action='claim') before heartbeating.",
        details: {
          code: "TASK_LOCKED",
          taskId: input.taskId,
          heldBy: current.claimedBy ?? null,
          since: current.claimedAt ? current.claimedAt.toISOString() : null,
          expiresAt: current.claimExpiresAt ? current.claimExpiresAt.toISOString() : null,
        },
      }
    );
  }
  return asToolText({
    action: "heartbeat",
    taskId: input.taskId,
    newVersion: result.newVersion,
    lock: {
      heldBy: clientId,
      expiresAt: result.claimExpiresAt.toISOString(),
    },
  });
}

async function release(input: Extract<TaskLifecycleInput, { action: "release" }>) {
  const task = await loadOrThrow(input.taskId);
  ensureTransition("release", task);
  const clientId = resolveClientId(input);
  assertLockHeldBy(task, clientId);
  // Wave 2 §10.F will swap the templated tag below for an LLM-narrated
  // abandonment summary. Provider=`none` keeps the templated form.
  const nowIso = new Date().toISOString();
  const tag = input.note
    ? `[released ${nowIso} by ${clientId}: ${input.note}]`
    : `[released ${nowIso} by ${clientId}]`;
  task.status = TaskStatus.PENDING;
  task.claimedBy = undefined;
  task.claimedAt = undefined;
  task.claimExpiresAt = undefined;
  task.notes = task.notes ? `${task.notes}\n${tag}` : tag;
  (task as TaskWithVersion & { verificationStatus?: string }).verificationStatus = undefined;
  const saved = await persistBumped(task);
  return asToolText({ action: "release", task: saved, newVersion: saved.version });
}

// ────────────────────────────────────────────────────────────────────────
// finalize — the only branch that requires `expectedVersion`
// ────────────────────────────────────────────────────────────────────────

async function finalize(input: Extract<TaskLifecycleInput, { action: "finalize" }>) {
  const existing = await loadOrThrow(input.taskId);
  ensureTransition("finalize", existing);
  assertLockHeldBy(existing, resolveClientId(input));

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
      // Wave 1 §10.C — clear claim on terminal transition (pass).
      next.claimedBy = undefined;
      next.claimedAt = undefined;
      next.claimExpiresAt = undefined;
      break;
    case "fail":
      // Wave 2 §10.F — fail flips IN_PROGRESS → PENDING and clears the
      // claim so another agent (or the same one after a context refresh)
      // can re-claim and execute `nextStrategy`. The failure context is
      // persisted in `finalOutcome` and tagged on `notes` for audit.
      next.status = TaskStatus.PENDING;
      next.summary = result.summary;
      next.finalOutcome = `FAIL: ${result.failureReason}\nNext: ${result.nextStrategy}`;
      if (result.lessonsLearned) next.lessonsLearned = result.lessonsLearned;
      (next as TaskWithVersion & { verificationStatus?: string }).verificationStatus = "failed";
      next.claimedBy = undefined;
      next.claimedAt = undefined;
      next.claimExpiresAt = undefined;
      {
        const tag = `[finalized fail ${new Date().toISOString()}: ${result.failureReason}]`;
        next.notes = next.notes ? `${next.notes}\n${tag}` : tag;
      }
      break;
    case "partial":
      // Wave 2 §10.F — partial completion is also a revert: the work
      // surfaced something that needs another pass, so the task returns
      // to PENDING. The remaining-work pointer lives in `nextStrategy`
      // and is appended as a partial-progress note for the audit trail.
      next.status = TaskStatus.PENDING;
      next.summary = result.summary;
      next.finalOutcome = `PARTIAL: ${result.failureReason}\nNext: ${result.nextStrategy}`;
      if (result.lessonsLearned) next.lessonsLearned = result.lessonsLearned;
      (next as TaskWithVersion & { verificationStatus?: string }).verificationStatus = "partial";
      next.claimedBy = undefined;
      next.claimedAt = undefined;
      next.claimExpiresAt = undefined;
      {
        const tag = `[finalized partial ${new Date().toISOString()}: ${result.nextStrategy}]`;
        next.notes = next.notes ? `${next.notes}\n${tag}` : tag;
      }
      break;
    case "needs_review":
      // needs_review keeps the task IN_PROGRESS and retains the claim so
      // the same agent can address the review feedback without losing
      // the slot. Plan §10.F explicitly treats this as a continuation,
      // not an abandonment.
      next.summary = result.summary;
      next.finalOutcome = `NEEDS REVIEW: ${result.reviewQuestion}`;
      if (result.lessonsLearned) next.lessonsLearned = result.lessonsLearned;
      (next as TaskWithVersion & { verificationStatus?: string }).verificationStatus =
        "needs_review";
      break;
  }

  return db.saveTask(next).then(() => next);
}

// `ValidationError` is intentionally re-exported in the imports above
// for downstream HTTP wrappers that want to map this tool's errors to
// 4xx bodies. The lifecycle handler itself doesn't throw VALIDATION.
void ValidationError;
