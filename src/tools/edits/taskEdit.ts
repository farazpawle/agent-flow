/**
 * `task_edit` — Phase 1 Group 5.2.
 *
 * Eight discriminated actions. Single-task ops route through
 * `withVersionCheck` (Group 3.1); multi-task ops (`reorder`, `merge`)
 * route through `withMultiVersionCheck` (Group 3.2) so the entire batch
 * is atomic — any stale version aborts every write.
 *
 * Conventions:
 *   - Every successful mutation bumps `tasks.version` by exactly 1
 *     (the version helpers handle it via `incrementTaskVersion`).
 *   - `split` and `merge` may also adjust dependencies on OTHER tasks
 *     (rewiring the DAG). Those adjustments bypass version-check because
 *     the caller has no way to know those other tasks' versions; the
 *     change is documented as an implicit cascade.
 *   - Telemetry: every handler is wrapped in `withToolTelemetry`.
 */

import { v4 as uuidv4 } from "uuid";
import { db } from "../../models/db.js";
import { ConflictError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import { withMultiVersionCheck, withVersionCheck } from "../../models/concurrency.js";
import type { Task, TaskDependency } from "../../types/index.js";
import { TaskStatus } from "../../types/index.js";
import type { TaskEditInput } from "./schemas.js";

type TaskWithVersion = Task & { version?: number; priority?: string };

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

/**
 * Save a task with merged fields. The version stored in the row is the
 * value already bumped by `withVersionCheck`'s CAS — we just have to
 * propagate it through so `saveTask`'s JSON content stays in sync.
 */
async function persistTask(updates: TaskWithVersion, newVersion: number): Promise<TaskWithVersion> {
  const next: TaskWithVersion = {
    ...updates,
    version: newVersion,
    updatedAt: new Date(),
  };
  await db.saveTask(next);
  return next;
}

// ────────────────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────────────────

export async function taskEdit(input: TaskEditInput) {
  return withToolTelemetry({ tool: "task_edit" }, () => dispatch(input));
}

async function dispatch(input: TaskEditInput) {
  switch (input.action) {
    case "create":
      return create(input);
    case "update":
      return update(input);
    case "reorder":
      return reorder(input);
    case "set_priority":
      return setPriority(input);
    case "set_dependency":
      return setDependency(input);
    case "clear_dependency":
      return clearDependency(input);
    case "split":
      return split(input);
    case "merge":
      return merge(input);
    case "append_note":
      return appendNote(input);
    case "delete_note":
      return deleteNote(input);
  }
}

// ────────────────────────────────────────────────────────────────────────
// create — no version check; new row starts at v=1 via column DEFAULT
// ────────────────────────────────────────────────────────────────────────

async function create(input: Extract<TaskEditInput, { action: "create" }>) {
  // Wave 1 §10.D — validate subtask invariants BEFORE any DB writes.
  // Two-level hierarchy only: subtask's groupId must match its parent's,
  // and the parent must not itself be a subtask (no grandchildren).
  if (input.parentTaskId) {
    const parent = await db.getTask(input.parentTaskId);
    if (!parent) {
      throw new ValidationError(
        `parentTaskId '${input.parentTaskId}' does not refer to an existing task.`,
        {
          hint: "Call task_view(action='get', taskId) to confirm the parent exists.",
        }
      );
    }
    if (parent.parentTaskId) {
      throw new ValidationError(
        `parent ${parent.id} is already a subtask — subtasks can only be one level deep.`,
        {
          hint: "Pick a top-level task as the parent, or omit parentTaskId to create a sibling.",
          details: {
            code: "VALIDATION",
            parentTaskId: parent.id,
            grandparent: parent.parentTaskId,
          },
        }
      );
    }
    const subtaskGroup = input.groupId ?? null;
    const parentGroup = parent.groupId ?? null;
    if (subtaskGroup !== parentGroup) {
      throw new ValidationError(
        `Subtask groupId (${subtaskGroup ?? "null"}) must match parent's groupId (${parentGroup ?? "null"}).`,
        {
          hint: "Either omit groupId so it inherits, or set it to the parent's groupId.",
          details: {
            code: "VALIDATION",
            parentTaskId: parent.id,
            parentGroupId: parentGroup,
            subtaskGroupId: subtaskGroup,
          },
        }
      );
    }
  }
  const now = new Date();
  const deps: TaskDependency[] = (input.dependencies ?? []).map((id) => ({ taskId: id }));
  const task: Task = {
    id: uuidv4(),
    name: input.name,
    description: input.description,
    notes: input.notes,
    status: TaskStatus.PENDING,
    dependencies: deps,
    problemStatement: input.problemStatement,
    technicalPlan: input.technicalPlan,
    implementationGuide: input.implementationGuide,
    verificationCriteria: input.verificationCriteria,
    createdAt: now,
    updatedAt: now,
    projectId: input.projectId,
    // Wave 1 §10.D — group membership + subtask wiring persisted to columns.
    groupId: input.groupId,
    parentTaskId: input.parentTaskId,
  };
  // Inline priority into the JSON content (Task doesn't expose it as a
  // first-class field today; Group 5 introduces it as an optional one).
  (task as TaskWithVersion).priority = input.priority;
  await db.saveTask(task);
  // `version` column defaults to 1 on insert (Group 1.3). Read back to
  // confirm and return the canonical row.
  const saved = await db.getTask(task.id);
  return asToolText({ action: "create", task: saved });
}

// ────────────────────────────────────────────────────────────────────────
// update — single-task CAS
// ────────────────────────────────────────────────────────────────────────

async function update(input: Extract<TaskEditInput, { action: "update" }>) {
  const existing = await loadOrThrow(input.taskId);
  const { value: saved, newVersion } = await withVersionCheck(
    input.taskId,
    input.expectedVersion,
    async () => {
      const merged: TaskWithVersion = { ...existing };
      if (input.name !== undefined) merged.name = input.name;
      if (input.description !== undefined) merged.description = input.description;
      if (input.notes !== undefined) merged.notes = input.notes;
      if (input.problemStatement !== undefined) merged.problemStatement = input.problemStatement;
      if (input.technicalPlan !== undefined) merged.technicalPlan = input.technicalPlan;
      if (input.implementationGuide !== undefined)
        merged.implementationGuide = input.implementationGuide;
      if (input.verificationCriteria !== undefined)
        merged.verificationCriteria = input.verificationCriteria;
      if (input.priority !== undefined) merged.priority = input.priority;
      return persistTask(merged, input.expectedVersion + 1);
    }
  );
  return asToolText({ action: "update", task: saved, newVersion });
}

// ────────────────────────────────────────────────────────────────────────
// set_priority / set_dependency / clear_dependency — single-task CAS
// ────────────────────────────────────────────────────────────────────────

async function setPriority(input: Extract<TaskEditInput, { action: "set_priority" }>) {
  const existing = await loadOrThrow(input.taskId);
  const { value: saved, newVersion } = await withVersionCheck(
    input.taskId,
    input.expectedVersion,
    async () => persistTask({ ...existing, priority: input.priority }, input.expectedVersion + 1)
  );
  return asToolText({ action: "set_priority", task: saved, newVersion });
}

async function setDependency(input: Extract<TaskEditInput, { action: "set_dependency" }>) {
  if (input.dependsOn === input.taskId) {
    throw new ValidationError("A task cannot depend on itself.", {
      hint: "Pick a different dependsOn taskId.",
    });
  }
  const existing = await loadOrThrow(input.taskId);
  // Soft-check that the target exists. We don't enforce strictly to
  // allow forward-referencing during batch construction; consumers can
  // call task_view(action=get) first if they want hard validation.
  if (!existing.dependencies.some((d) => d.taskId === input.dependsOn)) {
    existing.dependencies = [...existing.dependencies, { taskId: input.dependsOn }];
  }
  const { value: saved, newVersion } = await withVersionCheck(
    input.taskId,
    input.expectedVersion,
    async () => persistTask(existing, input.expectedVersion + 1)
  );
  return asToolText({ action: "set_dependency", task: saved, newVersion });
}

async function clearDependency(input: Extract<TaskEditInput, { action: "clear_dependency" }>) {
  const existing = await loadOrThrow(input.taskId);
  existing.dependencies = existing.dependencies.filter((d) => d.taskId !== input.dependsOn);
  const { value: saved, newVersion } = await withVersionCheck(
    input.taskId,
    input.expectedVersion,
    async () => persistTask(existing, input.expectedVersion + 1)
  );
  return asToolText({ action: "clear_dependency", task: saved, newVersion });
}

// ────────────────────────────────────────────────────────────────────────
// Wave 2 §10.H — append_note (append-only notes audit trail)
// ────────────────────────────────────────────────────────────────────────

async function appendNote(input: Extract<TaskEditInput, { action: "append_note" }>) {
  const trimmed = input.text.trim();
  if (!trimmed) {
    throw new ValidationError("append_note: text must contain non-whitespace characters", {
      hint: "Provide a meaningful audit note — empty or whitespace-only entries are rejected.",
    });
  }
  const existing = await loadOrThrow(input.taskId);
  const isoStamp = new Date().toISOString();
  const block = `[${isoStamp}] ${trimmed}`;
  // Prepend so the newest entry surfaces first when humans scan the trail.
  // We separate blocks with a blank line so the audit log stays scannable
  // even when individual entries span multiple lines.
  const nextNotes =
    existing.notes && existing.notes.length > 0 ? `${block}\n\n${existing.notes}` : block;
  const { value: saved, newVersion } = await withVersionCheck(
    input.taskId,
    input.expectedVersion,
    async () => persistTask({ ...existing, notes: nextNotes }, input.expectedVersion + 1)
  );
  return asToolText({ action: "append_note", task: saved, newVersion, appendedAt: isoStamp });
}

// ────────────────────────────────────────────────────────────────────────
// task-detail-ux-improvements §A — delete_note (permanent per-note delete)
//
// The notes blob is heterogeneous: `[<iso>] text` (append_note) interleaved
// with lifecycle tags (`[blocked: …]`, `[unblocked: …]`, `[released …]`).
// We identify the target note by its exact (trimmed) block text. Guarded by
// optimistic concurrency so a stale GUI tab can't delete the wrong note.
// ────────────────────────────────────────────────────────────────────────

async function deleteNote(input: Extract<TaskEditInput, { action: "delete_note" }>) {
  const target = input.noteText.trim();
  const existing = await loadOrThrow(input.taskId);

  // COUPLING: this split MUST stay in sync with the frontend `parseNotes()`
  // in src/public/pages/taskDetail.js (`/\n(?=\[)/`, trim, drop empties).
  // The delete button maps a clicked entry → its exact trimmed block text,
  // so any divergence here would make notes undeletable from the GUI.
  const blocks = (existing.notes ?? "")
    .split(/\n(?=\[)/)
    .map((c) => c.trim())
    .filter(Boolean);

  const idx = blocks.findIndex((b) => b === target);
  if (idx === -1) {
    throw new ValidationError("delete_note: note not found — reload the task and retry.", {
      hint: "The exact (trimmed) block text didn't match any note; the view is likely stale.",
      details: { code: "VALIDATION", taskId: input.taskId },
    });
  }

  // Remove the matched block; rejoin the remainder with a blank line so the
  // trail stays scannable (parseNotes re-splits on any leading `[`).
  blocks.splice(idx, 1);
  const next = blocks.join("\n\n");

  const { value: saved, newVersion } = await withVersionCheck(
    input.taskId,
    input.expectedVersion,
    async () => persistTask({ ...existing, notes: next }, input.expectedVersion + 1)
  );
  return asToolText({ action: "delete_note", task: saved, newVersion });
}

// ────────────────────────────────────────────────────────────────────────
// reorder — multi-task atomic CAS
// ────────────────────────────────────────────────────────────────────────

async function reorder(input: Extract<TaskEditInput, { action: "reorder" }>) {
  // Every taskId in `taskIds` must appear in `expectedVersions`. The
  // schema can't express this constraint directly so we enforce it
  // before the multi-CAS opens the transaction.
  for (const id of input.taskIds) {
    if (input.expectedVersions[id] === undefined) {
      throw new ValidationError(`reorder: expectedVersions is missing entry for taskId="${id}"`, {
        hint: "Provide a current version for every task in `taskIds`.",
      });
    }
  }

  const { value: tasks, newVersions } = await withMultiVersionCheck(
    input.expectedVersions,
    async () => {
      const updated: TaskWithVersion[] = [];
      for (let i = 0; i < input.taskIds.length; i++) {
        const id = input.taskIds[i];
        const t = await loadOrThrow(id);
        t.executionOrder = i;
        t.updatedAt = new Date();
        await db.saveTask(t);
        updated.push(t);
      }
      return updated;
    }
  );

  return asToolText({
    action: "reorder",
    projectId: input.projectId,
    tasks: tasks.map((t) => ({ id: t.id, executionOrder: t.executionOrder })),
    newVersions,
  });
}

// ────────────────────────────────────────────────────────────────────────
// split — replace one task with N tasks
// ────────────────────────────────────────────────────────────────────────

async function split(input: Extract<TaskEditInput, { action: "split" }>) {
  const source = await loadOrThrow(input.taskId);
  const projectId = source.projectId;
  if (!projectId) {
    throw new ValidationError(`split: source task has no projectId`, {
      hint: "Assign the source task to a project before splitting it.",
    });
  }

  const { value: result, newVersion: sourceNewVersion } = await withVersionCheck(
    input.taskId,
    input.expectedVersion,
    async () => {
      // Create the new tasks. The first one inherits source's incoming deps.
      const created: Task[] = [];
      const now = new Date();

      // Pre-allocate IDs so dependsOnNewIndex can resolve.
      const newIds = input.newTasks.map(() => uuidv4());

      for (let i = 0; i < input.newTasks.length; i++) {
        const spec = input.newTasks[i];
        const deps: TaskDependency[] = [];
        // Source's incoming deps go to the FIRST new task.
        if (i === 0) {
          for (const sd of source.dependencies) deps.push({ taskId: sd.taskId });
        }
        // Default linear chain: each new task depends on the previous.
        if (i > 0) deps.push({ taskId: newIds[i - 1] });
        // Explicit cross-batch deps.
        for (const idx of spec.dependsOnNewIndex ?? []) {
          if (idx >= 0 && idx < newIds.length && idx !== i) {
            deps.push({ taskId: newIds[idx] });
          }
        }
        for (const existingId of spec.existingDependencies ?? []) {
          if (existingId !== source.id) deps.push({ taskId: existingId });
        }

        const task: TaskWithVersion = {
          id: newIds[i],
          name: spec.name,
          description: spec.description,
          notes: spec.notes,
          status: TaskStatus.PENDING,
          dependencies: deps,
          problemStatement: spec.problemStatement,
          technicalPlan: spec.technicalPlan,
          implementationGuide: spec.implementationGuide,
          verificationCriteria: spec.verificationCriteria,
          createdAt: now,
          updatedAt: now,
          projectId,
        };
        task.priority = spec.priority;
        await db.saveTask(task);
        created.push(task);
      }

      // Rewire OTHER tasks that depended on source → point at the LAST new task.
      // This bypasses CAS by design (caller doesn't know those tasks' versions).
      const all = await db.getAllTasks(projectId);
      const lastNewId = newIds[newIds.length - 1];
      const rewired: string[] = [];
      for (const t of all) {
        if (t.id === source.id) continue;
        if (created.some((c) => c.id === t.id)) continue;
        if (t.dependencies.some((d) => d.taskId === source.id)) {
          t.dependencies = t.dependencies
            .filter((d) => d.taskId !== source.id)
            .concat([{ taskId: lastNewId }]);
          t.updatedAt = new Date();
          await db.saveTask(t);
          rewired.push(t.id);
        }
      }

      // Delete the source.
      await db.deleteTask(source.id);

      return { created, rewired };
    }
  );

  return asToolText({
    action: "split",
    sourceTaskId: input.taskId,
    sourceVersionAtSplit: sourceNewVersion,
    newTasks: result.created,
    rewiredDependents: result.rewired,
    note:
      result.rewired.length > 0
        ? "Dependent tasks were re-pointed at the final new task; their versions were NOT verified (implicit cascade)."
        : undefined,
  });
}

// ────────────────────────────────────────────────────────────────────────
// merge — combine N tasks into 1
// ────────────────────────────────────────────────────────────────────────

async function merge(input: Extract<TaskEditInput, { action: "merge" }>) {
  // Plan §6.2 — every merged task id must appear in expectedVersions.
  for (const id of input.taskIds) {
    if (input.expectedVersions[id] === undefined) {
      throw new ConflictError(`merge: expectedVersions is missing entry for taskId="${id}"`, {
        hint: "Provide a current version for every task in `taskIds`.",
      });
    }
  }

  const { value: result, newVersions } = await withMultiVersionCheck(
    input.expectedVersions,
    async () => {
      // Load all merged tasks, union their dependencies (minus refs
      // to other merged ids), and create the merged task.
      const mergedTasks: TaskWithVersion[] = [];
      for (const id of input.taskIds) mergedTasks.push(await loadOrThrow(id));

      const mergedSet = new Set(input.taskIds);
      const depIds = new Set<string>();
      let projectId: string | undefined;
      for (const t of mergedTasks) {
        if (!projectId) projectId = t.projectId;
        for (const d of t.dependencies) {
          if (!mergedSet.has(d.taskId)) depIds.add(d.taskId);
        }
      }
      if (!projectId) {
        throw new ValidationError(`merge: merged tasks have no projectId`, {
          hint: "Assign all merged tasks to a project before merging.",
        });
      }

      const now = new Date();
      const newId = uuidv4();
      const newTask: TaskWithVersion = {
        id: newId,
        name: input.into.name,
        description: input.into.description,
        notes: input.into.notes,
        status: TaskStatus.PENDING,
        dependencies: Array.from(depIds).map((id) => ({ taskId: id })),
        problemStatement: input.into.problemStatement,
        technicalPlan: input.into.technicalPlan,
        implementationGuide: input.into.implementationGuide,
        verificationCriteria: input.into.verificationCriteria,
        createdAt: now,
        updatedAt: now,
        projectId,
      };
      newTask.priority = input.into.priority;
      await db.saveTask(newTask);

      // Rewire OTHER tasks that depended on any merged task → point at newId.
      // Bypasses CAS for the same reason as split.
      const all = await db.getAllTasks(projectId);
      const rewired: string[] = [];
      for (const t of all) {
        if (mergedSet.has(t.id) || t.id === newId) continue;
        const hadMergedDep = t.dependencies.some((d) => mergedSet.has(d.taskId));
        if (!hadMergedDep) continue;
        const kept = t.dependencies.filter((d) => !mergedSet.has(d.taskId));
        if (!kept.some((d) => d.taskId === newId)) kept.push({ taskId: newId });
        t.dependencies = kept;
        t.updatedAt = new Date();
        await db.saveTask(t);
        rewired.push(t.id);
      }

      // Delete all merged tasks.
      for (const id of input.taskIds) await db.deleteTask(id);

      return { newTask, rewired };
    }
  );

  return asToolText({
    action: "merge",
    mergedTaskIds: input.taskIds,
    newTask: result.newTask,
    rewiredDependents: result.rewired,
    // newVersions came from the version bump on the merged tasks; the
    // bumped versions are unobservable (rows are now deleted) but we
    // include them for audit-log traceability.
    bumpedVersions: newVersions,
  });
}
