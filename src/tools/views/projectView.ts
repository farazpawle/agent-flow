/**
 * `project_view` — Phase 1 Group 4.1.
 *
 * Read-only discriminated-union tool replacing `list_projects` and
 * `get_project_context`. Resolution rules per plan §3.1:
 *
 *   - list    — every project (no filtering)
 *   - get     — exact project by id
 *   - summary — project + task counts grouped by status
 *   - active  — per-client active project pointer (from
 *               `client_active_project`; falls back to "none set" rather
 *               than throwing so callers can prompt the user to set one)
 *
 * The handler never throws on missing rows — it returns a typed
 * `NotFoundError` so the central `toToolErrorResponse` builds the
 * uniform MCP error envelope.
 */

import { db } from "../../models/db.js";
import { getAllProjects, getProjectById, type Project } from "../../models/projectModel.js";
import { getCurrentClientId } from "../../models/clientModel.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import type { ProjectViewInput } from "./schemas.js";

function projectPayload(p: Project) {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    path: p.path ?? null,
    gitRemoteUrl: (p as Project & { gitRemoteUrl?: string }).gitRemoteUrl ?? null,
    techStack: p.techStack ?? [],
    taskCount: p.taskCount ?? 0,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : p.createdAt,
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : p.updatedAt,
  };
}

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

export async function projectView(input: ProjectViewInput) {
  return withToolTelemetry({ tool: "project_view" }, () => dispatch(input));
}

async function dispatch(input: ProjectViewInput) {
  switch (input.action) {
    case "list": {
      const projects = await getAllProjects(true);
      return asToolText({ action: "list", projects: projects.map(projectPayload) });
    }

    case "get": {
      const project = await getProjectById(input.projectId);
      if (!project) {
        throw new NotFoundError(`Project not found: ${input.projectId}`, {
          hint: "Call project_view(action='list') to see available projects.",
        });
      }
      return asToolText({ action: "get", project: projectPayload(project) });
    }

    case "summary": {
      const project = await getProjectById(input.projectId);
      if (!project) {
        throw new NotFoundError(`Project not found: ${input.projectId}`, {
          hint: "Call project_view(action='list') to see available projects.",
        });
      }
      const tasks = await db.getAllTasks(input.projectId);
      const byStatus: Record<string, number> = {};
      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      }
      return asToolText({
        action: "summary",
        project: projectPayload(project),
        taskCounts: {
          total: tasks.length,
          byStatus,
        },
      });
    }

    case "active": {
      const clientId = input.clientId ?? getCurrentClientId() ?? process.env.CLIENT_ID ?? null;

      if (!clientId) {
        throw new ValidationError(
          "project_view(action='active') requires a clientId — none registered for this session.",
          {
            hint: "Pass `clientId` explicitly or ensure the MCP client identifies itself on connect.",
          }
        );
      }

      const active = await db.getActiveProjectForClient(clientId);
      if (!active) {
        return asToolText({
          action: "active",
          clientId,
          activeProject: null,
          note: "No active project set for this client. Use project_edit(action='set_active', projectId, clientId) to set one.",
        });
      }

      const project = await getProjectById(active.projectId);
      return asToolText({
        action: "active",
        clientId,
        activeProject: project ? projectPayload(project) : null,
        // `setAt` answers "since when" for audit purposes.
        setAt: active.setAt instanceof Date ? active.setAt.toISOString() : active.setAt,
        // If the row is dangling (project deleted out from under us)
        // tell the caller — they can clear the pointer.
        ...(project
          ? {}
          : { warning: "active row points to a missing project; consider clearing" }),
      });
    }
  }
}
