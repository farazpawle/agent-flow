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
import {
  findAvailableTasks,
  searchTasksWithCommand,
  canExecuteTask,
} from "../../models/taskModel.js";
import { computeDisplayNumbers } from "../../models/numbering.js";
import { TaskGraph } from "../../utils/taskGraph.js";
import { NotFoundError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import { recoverExpiredClaim } from "../../models/concurrency.js";
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
      const raw = await db.getTask(input.taskId);
      if (!raw) {
        throw new NotFoundError(`Task not found: ${input.taskId}`, {
          hint: "Call task_view(action='list') or task_view(action='search') to find an existing taskId.",
        });
      }
      // Wave 2 §10.F — atomically flip IN_PROGRESS+expired tasks back to
      // PENDING via CAS before returning. Idempotent and race-safe; see
      // `recoverExpiredClaim`.
      const task = await recoverExpiredClaim(raw as Task & { version?: number });
      const withVersion = ensureVersionPresent(task);
      // Wave 1 §10.C — surface lock state as a top-level `lock` field so
      // agents can branch on "claimed/expired/free" without having to
      // recompute from individual columns. `null` when unclaimed (no
      // `claimedBy`) or when the existing claim is already past expiry.
      const now = Date.now();
      const expiresMs = task.claimExpiresAt ? task.claimExpiresAt.getTime() : 0;
      const lock =
        task.claimedBy && expiresMs > now
          ? {
              heldBy: task.claimedBy,
              since: task.claimedAt ? task.claimedAt.toISOString() : null,
              expiresAt: task.claimExpiresAt ? task.claimExpiresAt.toISOString() : null,
            }
          : null;
      // feature-hierarchy Workstream C — derived auto-BLOCKED. A PENDING task
      // whose deps aren't all COMPLETED is shown as "Blocked" without mutating
      // the row, so it clears automatically once a dependency finalizes.
      const gate =
        task.status === TaskStatus.PENDING
          ? await canExecuteTask(task.id)
          : { canExecute: true, blockedBy: undefined as string[] | undefined };
      const blocked = task.status === TaskStatus.PENDING && !gate.canExecute;
      const enriched = {
        ...withVersion,
        blocked,
        blockedBy: blocked ? (gate.blockedBy ?? []) : [],
        effectiveStatus: blocked ? "Blocked" : String(task.status),
      };
      return asToolText({ action: "get", task: enriched, lock });
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

    // Wave 1 §10.D — parent/child task tree, optionally narrowed to a
    // group. Resolves children with a single in-memory pass after one
    // adapter read; the heavy work (status counts, full DAG, etc.) lives
    // in dedicated views. Skinny payload by design so the UI can lazy
    // hydrate individual tasks via `task_view(action='get')`.
    case "tree": {
      const all = await db.getAllTasks(input.projectId);
      // feature-hierarchy: derive per-feature `<g>.<t>` numbers from the full
      // project (groups + tasks) so the displayed number is stable even when
      // the tree is narrowed to one group.
      const groups = input.projectId ? await db.listGroups(input.projectId) : [];
      const { taskNumbers } = computeDisplayNumbers(groups, all);
      const inGroup = input.groupId ? all.filter((t) => t.groupId === input.groupId) : all;
      type TreeNode = {
        id: string;
        name: string;
        status: string;
        groupId: string | null;
        parentTaskId: string | null;
        displayNumber: string | null;
        children: TreeNode[];
      };
      const nodes = new Map<string, TreeNode>();
      for (const t of inGroup) {
        nodes.set(t.id, {
          id: t.id,
          name: t.name,
          status: String(t.status),
          groupId: t.groupId ?? null,
          parentTaskId: t.parentTaskId ?? null,
          displayNumber: taskNumbers.get(t.id) ?? null,
          children: [],
        });
      }
      const roots: TreeNode[] = [];
      for (const node of nodes.values()) {
        if (node.parentTaskId && nodes.has(node.parentTaskId)) {
          nodes.get(node.parentTaskId)!.children.push(node);
        } else {
          // Either a top-level task or a subtask whose parent lives in
          // another group (shouldn't happen per the §10.D constraint,
          // but we surface as a root rather than dropping it).
          roots.push(node);
        }
      }
      return asToolText({
        action: "tree",
        projectId: input.projectId,
        groupId: input.groupId ?? null,
        roots,
      });
    }

    // Wave 2 §10.G — skinny ranked feed: PENDING tasks (deps met) plus
    // IN_PROGRESS+expired-claim tasks. The model helper enforces ordering
    // and excludes live-claimed-by-another rows.
    case "available": {
      const result = await findAvailableTasks({
        projectId: input.projectId,
        groupId: input.groupId,
        limit: input.limit,
        clientId: input.clientId,
      });
      // Look up each available task's derived number from the full project.
      const all = await db.getAllTasks(input.projectId);
      const groups = input.projectId ? await db.listGroups(input.projectId) : [];
      const { taskNumbers } = computeDisplayNumbers(groups, all);
      return asToolText({
        action: "available",
        projectId: input.projectId,
        groupId: input.groupId ?? null,
        count: result.tasks.length,
        truncated: result.truncated,
        tasks: result.tasks.map((t) => ({
          ...t,
          displayNumber: taskNumbers.get(t.id) ?? null,
        })),
      });
    }
  }
}
