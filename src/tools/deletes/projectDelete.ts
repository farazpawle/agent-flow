/**
 * `project_delete` — Phase 1 Group 6.1.
 *
 * Two-mode discriminated union:
 *   - `dry_run`  → reports affected counts + sample, performs no writes.
 *   - `execute`  → writes the audit row first, then deletes the project
 *                  (cascades to tasks via legacy delete + new tables via
 *                  the Group 1 CASCADE FKs).
 *
 * Refuses to run when invoked from inside `workflow_run` per §6.4.
 */

import { db } from "../../models/db.js";
import { AuthError, ForbiddenError, NotFoundError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import { writeDestructiveAudit } from "../../utils/auditLog.js";
import { isInvokedFrom } from "../../utils/callerContext.js";
import type { ProjectDeleteInput } from "./schemas.js";

const SAMPLE_LIMIT = 5;

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function rejectWorkflowInitiated(tool: string): void {
  if (isInvokedFrom("workflow_run")) {
    throw new ForbiddenError(`${tool} cannot be invoked from inside workflow_run`, {
      hint: "Destructive operations require an explicit human/agent call outside the workflow runner.",
    });
  }
}

export async function projectDelete(input: ProjectDeleteInput) {
  return withToolTelemetry({ tool: "project_delete" }, async () => {
    rejectWorkflowInitiated("project_delete");

    const project = await db.getProject(input.projectId);
    if (!project) {
      throw new NotFoundError(`Project not found: ${input.projectId}`, {
        hint: "Call project_view(action='list') to see available projects.",
      });
    }

    const tasks = await db.getAllTasks(input.projectId);
    const sample = tasks.slice(0, SAMPLE_LIMIT).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
    }));

    if (input.mode === "dry_run") {
      return asToolText({
        mode: "dry_run",
        project: {
          id: project.id,
          name: project.name,
          description: project.description ?? null,
        },
        affectedTaskCount: tasks.length,
        affectedTaskSample: sample,
        note: "No writes performed. To proceed, call with mode='execute', reason, and confirm=true.",
      });
    }

    // mode === "execute" — TS narrows after the dry_run early-return.
    // Audit row goes FIRST so a mid-cascade crash still leaves a
    // record of intent.
    const affectedIds = [project.id, ...tasks.map((t) => t.id)];
    await writeDestructiveAudit({
      tool: "project_delete",
      projectId: project.id,
      reason: input.reason,
      affectedIds,
      metadata: { projectName: project.name, taskCount: tasks.length },
    });

    // Legacy tasks table has no CASCADE FK to projects — clear tasks
    // explicitly so the row count we audited matches what actually
    // disappears. New tables (task_findings, lesson_summaries,
    // client_active_project) cascade automatically via Group 1.1 FKs.
    for (const t of tasks) {
      await db.deleteTask(t.id);
    }
    await db.deleteProject(project.id);

    return asToolText({
      mode: "execute",
      deleted: true,
      project: { id: project.id, name: project.name },
      deletedTaskCount: tasks.length,
      reason: input.reason,
    });
  });
}

// Exported for the audit-script (Group 6.7) so a single grep target
// can confirm only this module triggers project-level cascade deletes.
export const PROJECT_DELETE_ENTRY_POINT = projectDelete;

// Re-export used by the audit-script when checking for accidental
// forbidden bypasses.
export { rejectWorkflowInitiated };

void AuthError; // keep the import surface stable for future extensions
