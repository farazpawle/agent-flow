/**
 * `task_view` — Phase 1 Group 4.2.
 *
 * Read-only discriminated-union tool replacing `list_tasks` and
 * `find_task`. Plan §3.4 mandates that **every** task object returned
 * by any action carries its `version` field — that's what lets the
 * agent send `expectedVersion` on subsequent edits.
 *
 *   - list        — filtered by projectId + status
 *   - get         — single task by id
 *   - search      — fuzzy keyword search via MiniSearch (existing infra)
 *   - next_ready  — first PENDING task whose deps are all COMPLETED
 *   - by_status   — strict-status listing (no "all")
 */

import { db } from "../../models/db.js";
import { searchTasksWithCommand } from "../../models/taskModel.js";
import { TaskGraph } from "../../utils/taskGraph.js";
import { NotFoundError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import type { Task } from "../../types/index.js";
import { TaskStatus } from "../../types/index.js";
import type { TaskViewInput } from "./schemas.js";

/**
 * Plan §3.4 contract: every returned task must include `version` (the OCC
 * column populated by Group 1.3). Adapters already merge it into the
 * returned object — this guard is defence in depth so the contract holds
 * even if a custom adapter forgets.
 */
function ensureVersionPresent(task: Task): Task & { version: number } {
  const v = (task as Task & { version?: number }).version;
  return { ...task, version: typeof v === "number" ? v : 1 } as Task & { version: number };
}

// Plan uses snake_case for status values on the wire (pending, in_progress,
// review, blocked, completed); the in-memory enum uses display strings
// ("Pending", "In Progress"). Map between the two so the schema stays
// agent-friendly while the model stays human-readable.
const WIRE_TO_ENUM: Record<string, TaskStatus | "review"> = {
  pending: TaskStatus.PENDING,
  in_progress: TaskStatus.IN_PROGRESS,
  blocked: TaskStatus.BLOCKED,
  completed: TaskStatus.COMPLETED,
  // `review` doesn't exist in the legacy enum yet; Group 7 introduces it.
  // For now we treat it as a string filter; in-flight rows can carry the
  // `review` literal in `task.status` once the lifecycle tool ships.
  review: "review",
};

function matchesStatus(task: Task, wireStatus: string): boolean {
  if (wireStatus === "all") return true;
  const expected = WIRE_TO_ENUM[wireStatus];
  if (!expected) return false;
  return String(task.status) === String(expected);
}

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export async function taskView(input: TaskViewInput) {
  return withToolTelemetry({ tool: "task_view" }, () => dispatch(input));
}

async function dispatch(input: TaskViewInput) {
  switch (input.action) {
    case "list": {
      const tasks = await db.getAllTasks(input.projectId);
      const filtered = tasks.filter((t) => matchesStatus(t, input.status));
      return asToolText({
        action: "list",
        projectId: input.projectId ?? null,
        status: input.status,
        count: filtered.length,
        tasks: filtered.map(ensureVersionPresent),
      });
    }

    case "get": {
      const task = await db.getTask(input.taskId);
      if (!task) {
        throw new NotFoundError(`Task not found: ${input.taskId}`, {
          hint: "Call task_view(action='list') or task_view(action='search') to find an existing taskId.",
        });
      }
      return asToolText({ action: "get", task: ensureVersionPresent(task) });
    }

    case "search": {
      const { tasks, pagination } = await searchTasksWithCommand(
        input.query,
        /* isId */ false,
        /* page */ 1,
        /* pageSize */ input.limit,
        input.projectId
      );
      // searchTasksWithCommand returns rows from current + archive.
      // Archived rows go through the JSON content path and may not
      // carry version — ensureVersionPresent defaults them to 1.
      return asToolText({
        action: "search",
        query: input.query,
        projectId: input.projectId ?? null,
        count: tasks.length,
        pagination,
        tasks: tasks.map(ensureVersionPresent),
      });
    }

    case "next_ready": {
      const tasks = await db.getAllTasks(input.projectId);
      if (tasks.length === 0) {
        return asToolText({
          action: "next_ready",
          projectId: input.projectId ?? null,
          task: null,
          note: "No tasks in scope.",
        });
      }
      const graph = new TaskGraph(tasks);
      const ready = graph.nextReady();
      return asToolText({
        action: "next_ready",
        projectId: input.projectId ?? null,
        task: ready ? ensureVersionPresent(ready) : null,
        ...(ready ? {} : { note: "No PENDING task has all dependencies COMPLETED." }),
      });
    }

    case "by_status": {
      const tasks = await db.getAllTasks(input.projectId);
      const filtered = tasks.filter((t) => matchesStatus(t, input.status));
      return asToolText({
        action: "by_status",
        projectId: input.projectId ?? null,
        status: input.status,
        count: filtered.length,
        tasks: filtered.map(ensureVersionPresent),
      });
    }
  }
}
