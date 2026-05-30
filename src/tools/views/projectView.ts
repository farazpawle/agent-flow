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
import { computeDisplayNumbers } from "../../models/numbering.js";
import { NotFoundError, ValidationError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import type { TaskGroup } from "../../types/index.js";
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

    // Wave 1 §10.D — flat list of groups in a project plus per-group
    // status counts. Fanout is bounded by the number of groups; we run
    // one COUNT(*) GROUP BY and reshape it client-side for clarity.
    case "groups_list": {
      const project = await getProjectById(input.projectId);
      if (!project) {
        throw new NotFoundError(`Project not found: ${input.projectId}`, {
          hint: "Call project_view(action='list') to see available projects.",
        });
      }
      const groups = await db.listGroups(input.projectId);
      const counts = await db.getGroupCounts(input.projectId);
      // Index counts by groupId so the response can attach them next to
      // each group definition.
      const byGroup = new Map<string | null, Record<string, number>>();
      for (const c of counts) {
        const key = c.groupId;
        const bucket = byGroup.get(key) ?? {};
        bucket[c.status] = (bucket[c.status] ?? 0) + c.count;
        byGroup.set(key, bucket);
      }

      // feature-hierarchy: derive section numbers and nest sections under
      // their feature. Group numbering only needs the groups themselves.
      const { groupNumbers } = computeDisplayNumbers(groups, []);
      const groupDto = (g: TaskGroup) => ({
        id: g.id,
        name: g.name,
        description: g.description ?? null,
        status: g.status,
        parentGroupId: g.parentGroupId ?? null,
        executionOrder: g.executionOrder ?? 0,
        displayNumber: groupNumbers.get(g.id) ?? null,
        createdAt: g.createdAt instanceof Date ? g.createdAt.toISOString() : g.createdAt,
        updatedAt: g.updatedAt instanceof Date ? g.updatedAt.toISOString() : g.updatedAt,
        taskCounts: byGroup.get(g.id) ?? {},
      });

      // Sections grouped under their feature, ordered by executionOrder.
      const childrenByParent = new Map<string, TaskGroup[]>();
      for (const g of groups) {
        if (!g.parentGroupId) continue;
        const bucket = childrenByParent.get(g.parentGroupId);
        if (bucket) bucket.push(g);
        else childrenByParent.set(g.parentGroupId, [g]);
      }
      for (const bucket of childrenByParent.values()) {
        bucket.sort((a, b) => (a.executionOrder ?? 0) - (b.executionOrder ?? 0));
      }

      // Top-level entries: features (and standalone manual groups). Each gets
      // a nested `children` array of its section groups.
      const topLevel = groups.filter((g) => !g.parentGroupId);
      return asToolText({
        action: "groups_list",
        projectId: input.projectId,
        groups: topLevel.map((feature) => ({
          ...groupDto(feature),
          children: (childrenByParent.get(feature.id) ?? []).map(groupDto),
        })),
        ungroupedTaskCounts: byGroup.get(null) ?? {},
      });
    }
  }
}
