/**
 * `task_delete` — Phase 1 Group 6.2.
 *
 * Three actions × two modes = six branches, each with its own required-
 * field set asserted at the schema layer:
 *
 *   - delete_one             (taskId)
 *   - delete_many            (taskIds[])
 *   - clear_all_for_project  (projectId; reason ≥ 20 for execute)
 *
 * The only path through which AgentFlow can mass-delete tasks for a
 * whole project is `clear_all_for_project.execute` — Group 6.6 already
 * removed `split_tasks(clearAllTasks)` and the legacy `delete_task`
 * handler from the MCP surface.
 */

import { db } from "../../models/db.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import { writeDestructiveAudit } from "../../utils/auditLog.js";
import { isInvokedFrom } from "../../utils/callerContext.js";
import type { Task } from "../../types/index.js";
import type { TaskDeleteInput } from "./schemas.js";

const SAMPLE_LIMIT = 5;

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function rejectWorkflowInitiated() {
  if (isInvokedFrom("workflow_run")) {
    throw new ForbiddenError("task_delete cannot be invoked from inside workflow_run", {
      hint: "Destructive operations require an explicit human/agent call outside the workflow runner.",
    });
  }
}

function pickProjectIdFor(tasks: Task[]): string | undefined {
  // Use the first task's projectId. Caller-supplied projectId on
  // clear_all branches takes precedence inside the dispatcher.
  for (const t of tasks) if (t.projectId) return t.projectId;
  return undefined;
}

export async function taskDelete(input: TaskDeleteInput) {
  return withToolTelemetry({ tool: "task_delete" }, async () => {
    rejectWorkflowInitiated();

    switch (input.op) {
      case "delete_one.dry_run":
      case "delete_one.execute":
        return handleDeleteOne(input);
      case "delete_many.dry_run":
      case "delete_many.execute":
        return handleDeleteMany(input);
      case "clear_all_for_project.dry_run":
      case "clear_all_for_project.execute":
        return handleClearAll(input);
    }
  });
}

async function handleDeleteOne(input: Extract<TaskDeleteInput, { action: "delete_one" }>) {
  const task = await db.getTask(input.taskId);
  if (!task) {
    throw new NotFoundError(`Task not found: ${input.taskId}`, {
      hint: "Call task_view(action='get') to confirm the id.",
    });
  }
  if (input.mode === "dry_run") {
    return asToolText({
      action: "delete_one",
      mode: "dry_run",
      affectedTaskCount: 1,
      affectedTaskSample: [{ id: task.id, name: task.name, status: task.status }],
      note: "No writes. Re-call with mode='execute', reason, confirm=true to proceed.",
    });
  }

  await writeDestructiveAudit({
    tool: "task_delete",
    projectId: task.projectId ?? "(orphan)",
    reason: input.reason,
    affectedIds: [task.id],
    metadata: { action: "delete_one" },
  });
  await db.deleteTask(task.id);
  return asToolText({
    action: "delete_one",
    mode: "execute",
    deleted: true,
    taskId: task.id,
    reason: input.reason,
  });
}

async function handleDeleteMany(input: Extract<TaskDeleteInput, { action: "delete_many" }>) {
  const tasks: Task[] = [];
  for (const id of input.taskIds) {
    const t = await db.getTask(id);
    if (t) tasks.push(t);
  }
  if (tasks.length === 0) {
    throw new NotFoundError(`task_delete(delete_many): none of the supplied taskIds exist`, {
      hint: "Verify each id with task_view(action='get').",
    });
  }
  if (input.mode === "dry_run") {
    return asToolText({
      action: "delete_many",
      mode: "dry_run",
      requestedCount: input.taskIds.length,
      affectedTaskCount: tasks.length,
      missingIds: input.taskIds.filter((id) => !tasks.find((t) => t.id === id)),
      affectedTaskSample: tasks.slice(0, SAMPLE_LIMIT).map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
      })),
      note: "No writes. Re-call with mode='execute', reason, confirm=true to proceed.",
    });
  }

  const projectId = pickProjectIdFor(tasks) ?? "(orphan)";
  await writeDestructiveAudit({
    tool: "task_delete",
    projectId,
    reason: input.reason,
    affectedIds: tasks.map((t) => t.id),
    metadata: { action: "delete_many", requestedCount: input.taskIds.length },
  });

  let deleted = 0;
  for (const t of tasks) {
    await db.deleteTask(t.id);
    deleted++;
  }
  return asToolText({
    action: "delete_many",
    mode: "execute",
    deletedTaskCount: deleted,
    reason: input.reason,
  });
}

async function handleClearAll(
  input: Extract<TaskDeleteInput, { action: "clear_all_for_project" }>
) {
  const project = await db.getProject(input.projectId);
  if (!project) {
    throw new NotFoundError(`Project not found: ${input.projectId}`, {
      hint: "Call project_view(action='list') to see available projects.",
    });
  }
  const tasks = await db.getAllTasks(input.projectId);
  if (input.mode === "dry_run") {
    return asToolText({
      action: "clear_all_for_project",
      mode: "dry_run",
      projectId: project.id,
      affectedTaskCount: tasks.length,
      affectedTaskSample: tasks.slice(0, SAMPLE_LIMIT).map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
      })),
      note: "No writes. Re-call with mode='execute', reason (≥20 chars), confirm=true to proceed.",
    });
  }

  // Defence in depth — schema already enforces, but a runtime check
  // here means any future refactor that bypasses the schema still
  // hits the floor.
  if (input.reason.length < 20) {
    throw new ValidationError("clear_all_for_project execute requires reason ≥ 20 characters.");
  }

  await writeDestructiveAudit({
    tool: "task_delete",
    projectId: project.id,
    reason: input.reason,
    affectedIds: tasks.map((t) => t.id),
    metadata: {
      action: "clear_all_for_project",
      projectName: project.name,
    },
  });

  for (const t of tasks) await db.deleteTask(t.id);

  return asToolText({
    action: "clear_all_for_project",
    mode: "execute",
    projectId: project.id,
    deletedTaskCount: tasks.length,
    reason: input.reason,
  });
}

// Exported for the audit-script (Group 6.7).
export const TASK_DELETE_ENTRY_POINT = taskDelete;
