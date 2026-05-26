/**
 * `context_get` — Phase 1 Group 4.3.
 *
 * Read-only, token-budgeted context bundle assembler. Every branch is
 * deterministic — no LLM call anywhere. Plan §3.8 lays out the seven
 * `type` values; the lessons fallback chain has its own subsection.
 *
 * Truncation strategy per type:
 *   - project_summary       — `tail` of recent activity (most recent matters)
 *   - implementation_context — `middle` (preserve head + tail of long bodies)
 *   - verification_context  — `middle` (same rationale)
 *   - lessons / decisions / findings / similar_tasks — list truncation via
 *     `truncateList` (drop oldest first by keeping the head of an already
 *     newest-first list).
 */

import { db } from "../../models/db.js";
import { getProjectById } from "../../models/projectModel.js";
import { searchTasksWithCommand } from "../../models/taskModel.js";
import { NotFoundError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import { estimateTokens, truncateList, truncateText } from "../../utils/tokenBudget.js";
import type { Task } from "../../types/index.js";
import type { ContextGetInput } from "./schemas.js";

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

async function loadTaskOrThrow(taskId: string): Promise<Task> {
  const task = await db.getTask(taskId);
  if (!task) {
    throw new NotFoundError(`Task not found: ${taskId}`, {
      hint: "Call task_view(action='get', taskId) to confirm the id.",
    });
  }
  return task;
}

function isoOrNull(d: Date | string | undefined): string | null {
  if (!d) return null;
  return d instanceof Date ? d.toISOString() : d;
}

// ────────────────────────────────────────────────────────────────────────
// project_summary
// ────────────────────────────────────────────────────────────────────────

async function buildProjectSummary(projectId: string, maxTokens: number) {
  const project = await getProjectById(projectId);
  if (!project) {
    throw new NotFoundError(`Project not found: ${projectId}`, {
      hint: "Call project_view(action='list') to see available projects.",
    });
  }
  const tasks = await db.getAllTasks(projectId);
  const byStatus: Record<string, number> = {};
  for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;

  // Most recently updated first.
  const recent = [...tasks]
    .sort((a, b) => {
      const av =
        a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
      const bv =
        b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
      return bv - av;
    })
    .map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      updatedAt: isoOrNull(t.updatedAt),
    }));

  const halfBudget = Math.floor(maxTokens / 2);
  const recentTrunc = truncateList(recent, { maxTokens: halfBudget });

  const description = project.description ?? "";
  const truncatedDescription = truncateText(description, {
    maxTokens: maxTokens - halfBudget,
    strategy: "tail",
  });

  return {
    type: "project_summary",
    projectId,
    project: {
      id: project.id,
      name: project.name,
      description: truncatedDescription,
      techStack: project.techStack ?? [],
    },
    taskCounts: { total: tasks.length, byStatus },
    recentTasks: recentTrunc.items,
    truncated: recentTrunc.truncated > 0 ? { recentTasks: recentTrunc.truncated } : undefined,
  };
}

// ────────────────────────────────────────────────────────────────────────
// implementation_context  /  verification_context
// ────────────────────────────────────────────────────────────────────────

async function buildTaskContext(
  taskId: string,
  maxTokens: number,
  kind: "implementation_context" | "verification_context"
) {
  const task = await loadTaskOrThrow(taskId);

  // Strategy: split budget across the long-form fields; `middle`
  // truncation so the agent sees both the lead-in and the conclusion.
  const fieldNames =
    kind === "implementation_context"
      ? ([
          "problemStatement",
          "technicalPlan",
          "implementationGuide",
          "description",
          "notes",
        ] as const)
      : ([
          "verificationCriteria",
          "technicalPlan",
          "implementationGuide",
          "description",
          "summary",
        ] as const);

  const perField = Math.max(150, Math.floor(maxTokens / fieldNames.length));
  const fields: Record<string, string | null> = {};
  let truncatedCount = 0;
  for (const name of fieldNames) {
    const value = (task as unknown as Record<string, string | undefined>)[name];
    if (!value) {
      fields[name] = null;
      continue;
    }
    const truncated = truncateText(value, { maxTokens: perField, strategy: "middle" });
    if (truncated !== value) truncatedCount++;
    fields[name] = truncated;
  }

  return {
    type: kind,
    task: {
      id: task.id,
      name: task.name,
      status: task.status,
      version: (task as Task & { version?: number }).version,
      dependencies: task.dependencies.map((d) => d.taskId),
    },
    fields,
    truncatedFieldCount: truncatedCount,
  };
}

// ────────────────────────────────────────────────────────────────────────
// lessons — fallback chain per §3.8
// ────────────────────────────────────────────────────────────────────────

interface LessonItem {
  source: "summary" | "task" | "finding";
  topic?: string;
  summary: string;
  taskId?: string;
  createdAt: string | null;
}

async function buildLessons(input: {
  topic?: string;
  projectId?: string;
  limit: number;
  maxTokens: number;
}) {
  // Stage 1: lesson_summaries rows
  if (input.projectId) {
    const summaries = await db.listLessonSummaries({
      projectId: input.projectId,
      topic: input.topic,
      limit: input.limit,
    });
    if (summaries.length > 0) {
      const items: LessonItem[] = summaries.map((s) => ({
        source: "summary",
        topic: s.topic,
        summary: s.summary,
        createdAt: isoOrNull(s.createdAt),
      }));
      const truncated = truncateList(items, { maxTokens: input.maxTokens });
      return {
        type: "lessons",
        projectId: input.projectId,
        topic: input.topic ?? null,
        stage: "summaries",
        lessons: truncated.items,
        truncated: truncated.truncated,
      };
    }
  }

  // Stage 2: recent tasks.lessonsLearned + task_findings(kind=finding,type IN ...)
  if (input.projectId) {
    const tasks = await db.getAllTasks(input.projectId);
    const fromTasks: LessonItem[] = tasks
      .filter((t) => Boolean(t.lessonsLearned))
      .sort((a, b) => {
        const av =
          a.updatedAt instanceof Date ? a.updatedAt.getTime() : new Date(a.updatedAt).getTime();
        const bv =
          b.updatedAt instanceof Date ? b.updatedAt.getTime() : new Date(b.updatedAt).getTime();
        return bv - av;
      })
      .map((t) => ({
        source: "task" as const,
        summary: t.lessonsLearned ?? "",
        taskId: t.id,
        createdAt: isoOrNull(t.updatedAt),
      }));

    const findings = await db.listFindings({
      projectId: input.projectId,
      kind: "finding",
      limit: input.limit * 2,
    });
    const fromFindings: LessonItem[] = findings
      .filter((f) => ["failure", "partial", "success", "decision"].includes(String(f.type)))
      .map((f) => ({
        source: "finding" as const,
        topic: f.type,
        summary: typeof f.content === "string" ? f.content : JSON.stringify(f.content),
        taskId: f.taskId,
        createdAt: isoOrNull(f.createdAt),
      }));

    const combined = [...fromTasks, ...fromFindings]
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
      .slice(0, input.limit);

    if (combined.length > 0) {
      const truncated = truncateList(combined, { maxTokens: input.maxTokens });
      return {
        type: "lessons",
        projectId: input.projectId,
        topic: input.topic ?? null,
        stage: "fallback",
        lessons: truncated.items,
        truncated: truncated.truncated,
      };
    }
  }

  // Stage 3: nothing found. Never throw, never call LLM.
  return {
    type: "lessons",
    projectId: input.projectId ?? null,
    topic: input.topic ?? null,
    stage: "empty",
    lessons: [],
    note: "no lessons recorded yet",
  };
}

// ────────────────────────────────────────────────────────────────────────
// similar_tasks — keyword search against the source task's text
// ────────────────────────────────────────────────────────────────────────

async function buildSimilarTasks(taskId: string, limit: number, maxTokens: number) {
  const task = await loadTaskOrThrow(taskId);
  // Build a compact query from the task's most discriminative fields.
  const queryParts = [task.name, task.description, task.problemStatement ?? ""]
    .filter(Boolean)
    .join(" ")
    .slice(0, 400); // keep MiniSearch input bounded

  const { tasks } = await searchTasksWithCommand(
    queryParts,
    /* isId */ false,
    /* page */ 1,
    /* pageSize */ limit + 1, // pull one extra so we can drop self
    task.projectId
  );

  const similar = tasks
    .filter((t) => t.id !== taskId)
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      version: (t as Task & { version?: number }).version,
      summary: t.summary ?? null,
    }));

  const truncated = truncateList(similar, { maxTokens });
  return {
    type: "similar_tasks",
    taskId,
    count: truncated.items.length,
    tasks: truncated.items,
    truncated: truncated.truncated,
  };
}

// ────────────────────────────────────────────────────────────────────────
// decisions — findings with kind=finding, type=decision
// ────────────────────────────────────────────────────────────────────────

async function buildDecisions(projectId: string, since: string | undefined, maxTokens: number) {
  const sinceMs = since ? new Date(since).getTime() : undefined;
  const decisions = await db.listFindings({
    projectId,
    kind: "finding",
    type: "decision",
    sinceMs,
    limit: 100,
  });
  const items = decisions.map((f) => ({
    id: f.id,
    taskId: f.taskId,
    content: f.content,
    metadata: f.metadata ?? null,
    createdAt: isoOrNull(f.createdAt),
    createdBy: f.createdBy ?? null,
  }));
  const truncated = truncateList(items, { maxTokens });
  return {
    type: "decisions",
    projectId,
    since: since ?? null,
    count: truncated.items.length,
    decisions: truncated.items,
    truncated: truncated.truncated,
  };
}

// ────────────────────────────────────────────────────────────────────────
// findings — full artifact stream for a task
// ────────────────────────────────────────────────────────────────────────

async function buildFindings(
  taskId: string,
  kinds: string[] | undefined,
  limit: number,
  maxTokens: number
) {
  // Defensive load: ensures the taskId exists; surfaces NotFoundError.
  await loadTaskOrThrow(taskId);
  const findings = await db.listFindings({ taskId, limit });
  const filtered =
    kinds && kinds.length > 0
      ? findings.filter(
          (f) => kinds.includes(String(f.kind)) || (f.type && kinds.includes(String(f.type)))
        )
      : findings;
  const items = filtered.map((f) => ({
    id: f.id,
    kind: f.kind,
    type: f.type ?? null,
    content: f.content,
    metadata: f.metadata ?? null,
    createdAt: isoOrNull(f.createdAt),
    createdBy: f.createdBy ?? null,
  }));
  const truncated = truncateList(items, { maxTokens });
  return {
    type: "findings",
    taskId,
    kinds: kinds ?? null,
    count: truncated.items.length,
    findings: truncated.items,
    truncated: truncated.truncated,
  };
}

// ────────────────────────────────────────────────────────────────────────
// Dispatcher
// ────────────────────────────────────────────────────────────────────────

export async function contextGet(input: ContextGetInput) {
  return withToolTelemetry({ tool: "context_get" }, () => dispatch(input));
}

async function dispatch(input: ContextGetInput) {
  switch (input.type) {
    case "project_summary":
      return asToolText(await buildProjectSummary(input.projectId, input.maxTokens));
    case "implementation_context":
      return asToolText(
        await buildTaskContext(input.taskId, input.maxTokens, "implementation_context")
      );
    case "verification_context":
      return asToolText(
        await buildTaskContext(input.taskId, input.maxTokens, "verification_context")
      );
    case "lessons":
      return asToolText(
        await buildLessons({
          topic: input.topic,
          projectId: input.projectId,
          limit: input.limit,
          maxTokens: input.maxTokens,
        })
      );
    case "similar_tasks":
      return asToolText(await buildSimilarTasks(input.taskId, input.limit, input.maxTokens));
    case "decisions":
      return asToolText(await buildDecisions(input.projectId, input.since, input.maxTokens));
    case "findings":
      return asToolText(
        await buildFindings(input.taskId, input.kinds, input.limit, input.maxTokens)
      );
  }
}

// Re-export for tests that want to inspect token estimation directly.
export { estimateTokens };
