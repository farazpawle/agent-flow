/**
 * Optimistic concurrency helpers for the v2 tool surface.
 *
 * Phase 1 Group 3 — must land before any edit tool (Groups 4-7).
 *
 * Design: bump-first CAS. Single-task ops increment `tasks.version` via
 * `db.incrementTaskVersion(taskId, expectedVersion)` (an atomic per-row
 * UPDATE) BEFORE running the actual mutation. If the bump CAS fails,
 * `fn` never runs and the caller gets a CONFLICT carrying the current
 * task body so they can merge.
 *
 * For multi-task batches (`reorder`, `merge`) we pre-check every
 * expected version in one pass, abort with a MULTI conflict if any are
 * stale, then bump all and run `fn` inside `db.runInTransaction(...)`.
 * SQLite gets a real BEGIN IMMEDIATE / COMMIT pair; Supabase falls back
 * to best-effort row-level CAS (RPC upgrade path documented on the
 * adapter).
 *
 * The conflict body shapes match plan §6.4 exactly so the GUI and MCP
 * clients can parse them without surprises.
 */

import type { DatabaseAdapter } from "./interfaces.js";
import type { Task } from "../types/index.js";
import { TaskStatus } from "../types/index.js";
import { db as defaultDb } from "./db.js";
import { ConflictError } from "../utils/errors.js";

// ────────────────────────────────────────────────────────────────────────
// Conflict body types (plan §6.4)
// ────────────────────────────────────────────────────────────────────────

export interface SingleConflictBody {
  code: "CONFLICT";
  taskId: string;
  expectedVersion: number;
  /** `null` when the task was deleted between read and CAS. */
  currentVersion: number | null;
  /** Full body so the caller can merge; `null` when the task was deleted. */
  currentTask: Task | null;
}

export interface MultiConflictEntry {
  taskId: string;
  expectedVersion: number;
  currentVersion: number | null;
}

export interface MultiConflictBody {
  code: "CONFLICT";
  /** Only the entries whose expectedVersion did not match currentVersion. */
  conflicts: MultiConflictEntry[];
  /** Every taskId checked → its current body (null when deleted). */
  currentTasks: Record<string, Task | null>;
}

export type ConflictBody = SingleConflictBody | MultiConflictBody;

// ────────────────────────────────────────────────────────────────────────
// Builders (kept pure so they can be snapshot-tested in isolation)
// ────────────────────────────────────────────────────────────────────────

export function buildSingleConflict(
  taskId: string,
  expectedVersion: number,
  currentVersion: number | null,
  currentTask: Task | null
): SingleConflictBody {
  return {
    code: "CONFLICT",
    taskId,
    expectedVersion,
    currentVersion,
    currentTask,
  };
}

export function buildMultiConflict(
  expectedVersions: Record<string, number>,
  currentVersions: Record<string, number | null>,
  currentTasks: Record<string, Task | null>
): MultiConflictBody {
  const conflicts: MultiConflictEntry[] = [];
  for (const [taskId, expectedVersion] of Object.entries(expectedVersions)) {
    const currentVersion = currentVersions[taskId] ?? null;
    if (currentVersion !== expectedVersion) {
      conflicts.push({ taskId, expectedVersion, currentVersion });
    }
  }
  return {
    code: "CONFLICT",
    conflicts,
    currentTasks,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

/** A task that *may* carry a `version` (older fixtures might not). */
type TaskWithVersion = Task & { version?: number };

function getTaskVersion(task: Task | null): number | null {
  if (!task) return null;
  const v = (task as TaskWithVersion).version;
  return typeof v === "number" ? v : null;
}

function asConflictError(message: string, body: ConflictBody): ConflictError {
  return new ConflictError(message, {
    details: body as unknown as Record<string, unknown>,
  });
}

// ────────────────────────────────────────────────────────────────────────
// 3.1 — single-task wrapper
// ────────────────────────────────────────────────────────────────────────

export interface SingleResult<T> {
  value: T;
  newVersion: number;
}

/**
 * Bump `tasks.version` atomically, then run `fn`. If the version doesn't
 * match `expectedVersion`, throw `ConflictError` whose `details` is the
 * §6.4 single-task body. `fn` never runs on conflict.
 *
 * @param taskId           the task being mutated
 * @param expectedVersion  the version the caller observed
 * @param fn               the actual mutation (uses the adapter directly)
 * @param db               override the adapter (tests); defaults to the singleton
 */
export async function withVersionCheck<T>(
  taskId: string,
  expectedVersion: number,
  fn: () => Promise<T>,
  db: DatabaseAdapter = defaultDb
): Promise<SingleResult<T>> {
  const bumpResult = await db.incrementTaskVersion(taskId, expectedVersion);
  if (!bumpResult.ok) {
    const currentTask = await db.getTask(taskId);
    const body = buildSingleConflict(
      taskId,
      expectedVersion,
      bumpResult.currentVersion,
      currentTask
    );
    throw asConflictError(`Task ${taskId} version mismatch`, body);
  }

  // Bump succeeded — we own the row. Run the mutation.
  const value = await fn();
  return { value, newVersion: bumpResult.newVersion };
}

// ────────────────────────────────────────────────────────────────────────
// 3.2 — multi-task wrapper
// ────────────────────────────────────────────────────────────────────────

export interface MultiResult<T> {
  value: T;
  newVersions: Record<string, number>;
}

/**
 * Atomic batch CAS over multiple tasks.
 *
 * Order of operations:
 *   1. Open a transaction (real on SQLite; no-op on Supabase).
 *   2. Read every taskId once; build `currentVersions` + `currentTasks`.
 *   3. If any entry's `currentVersion !== expectedVersion` → throw
 *      a MULTI conflict body listing the mismatches and the full current
 *      bodies. No writes happened.
 *   4. CAS-bump every task. A bump failure here is a race (Supabase only,
 *      since SQLite holds the IMMEDIATE lock); we throw the mismatching
 *      entry as a single-element conflict.
 *   5. Run `fn`. The transaction commits on resolve, rolls back on throw.
 */
export async function withMultiVersionCheck<T>(
  expectedVersions: Record<string, number>,
  fn: () => Promise<T>,
  db: DatabaseAdapter = defaultDb
): Promise<MultiResult<T>> {
  const taskIds = Object.keys(expectedVersions);
  if (taskIds.length === 0) {
    // Nothing to lock — just run fn and return.
    const value = await fn();
    return { value, newVersions: {} };
  }

  return db.runInTransaction(async () => {
    // 1. Pre-check.
    const tasks = await Promise.all(taskIds.map((id) => db.getTask(id)));
    const currentTasks: Record<string, Task | null> = {};
    const currentVersions: Record<string, number | null> = {};
    for (let i = 0; i < taskIds.length; i++) {
      const id = taskIds[i];
      const task = tasks[i];
      currentTasks[id] = task;
      currentVersions[id] = getTaskVersion(task);
    }

    const body = buildMultiConflict(expectedVersions, currentVersions, currentTasks);
    if (body.conflicts.length > 0) {
      throw asConflictError(`Multi-task version mismatch (${body.conflicts.length} stale)`, body);
    }

    // 2. Bump every task. With BEGIN IMMEDIATE held (SQLite), no other
    //    writer can sneak in here. On Supabase the CAS itself catches it.
    const newVersions: Record<string, number> = {};
    for (const id of taskIds) {
      const bump = await db.incrementTaskVersion(id, expectedVersions[id]);
      if (!bump.ok) {
        const currentTask = await db.getTask(id);
        const raceBody: MultiConflictBody = {
          code: "CONFLICT",
          conflicts: [
            {
              taskId: id,
              expectedVersion: expectedVersions[id],
              currentVersion: bump.currentVersion,
            },
          ],
          currentTasks: { [id]: currentTask },
        };
        throw asConflictError(`Multi-task version race during bump (taskId=${id})`, raceBody);
      }
      newVersions[id] = bump.newVersion;
    }

    // 3. Run the mutation. Throws → outer ROLLBACK (SQLite).
    const value = await fn();
    return { value, newVersions };
  });
}

// ────────────────────────────────────────────────────────────────────────
// Type guards (for callers/tests that catch ConflictError and want to
// inspect the body without an unsafe cast)
// ────────────────────────────────────────────────────────────────────────

export function isSingleConflictBody(body: unknown): body is SingleConflictBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.code === "CONFLICT" && typeof b.taskId === "string" && "currentTask" in b;
}

export function isMultiConflictBody(body: unknown): body is MultiConflictBody {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return b.code === "CONFLICT" && Array.isArray(b.conflicts) && "currentTasks" in b;
}

// ────────────────────────────────────────────────────────────────────────
// Wave 2 §10.F — read-time recovery of expired claims
// ────────────────────────────────────────────────────────────────────────

/**
 * Atomically flip an IN_PROGRESS task whose claim has expired back to
 * PENDING via CAS, clearing the claim columns and appending a templated
 * abandonment note. Idempotent and concurrency-safe — losing the CAS
 * race re-reads and returns whatever the winner produced.
 *
 * Returns the task unchanged when:
 *   - status is not IN_PROGRESS, or
 *   - the task has no claim, or
 *   - the claim is still live.
 *
 * Wave 3 §10.F upgrades the templated tag to LLM narration; provider=
 * `none` keeps the templated form.
 */
export async function recoverExpiredClaim(
  task: Task & { version?: number },
  adapter: DatabaseAdapter = defaultDb
): Promise<Task & { version?: number }> {
  if (task.status !== TaskStatus.IN_PROGRESS) return task;
  if (!task.claimExpiresAt) return task;
  if (task.claimExpiresAt.getTime() >= Date.now()) return task;
  const expectedVersion = (task as Task & { version?: number }).version ?? 1;
  try {
    const { value } = await withVersionCheck(
      task.id,
      expectedVersion,
      async () => {
        const next: Task & { version?: number } = { ...task };
        next.status = TaskStatus.PENDING;
        next.claimedBy = undefined;
        next.claimedAt = undefined;
        next.claimExpiresAt = undefined;
        next.version = expectedVersion + 1;
        next.updatedAt = new Date();
        const tag = `[abandoned ${new Date().toISOString()}, claim expired]`;
        next.notes = next.notes ? `${next.notes}\n${tag}` : tag;
        await adapter.saveTask(next);
        return next;
      },
      adapter
    );
    return value;
  } catch (err) {
    if (err instanceof ConflictError) {
      // Lost the race — another reader already recovered. Re-read and
      // return whatever they wrote so concurrent readers converge.
      const reread = await adapter.getTask(task.id);
      return (reread ?? task) as Task & { version?: number };
    }
    throw err;
  }
}
