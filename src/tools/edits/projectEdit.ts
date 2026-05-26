/**
 * `project_edit` — Phase 1 Group 5.1.
 *
 *   - create     — new project (generates id from gitRemoteUrl or path hash)
 *   - update     — patch existing project fields
 *   - set_active — per-client active-project pointer (writes
 *                  `client_active_project` only; never mutates global state)
 *
 * Replaces `create_project`.
 */

import { v4 as uuidv4 } from "uuid";
import { createHash } from "crypto";
import { db } from "../../models/db.js";
import { NotFoundError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import type { ProjectEditInput } from "./schemas.js";

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

function generateProjectId(seed: string): string {
  const normalised = seed.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
  const hash = createHash("md5").update(normalised).digest("hex").substring(0, 12);
  return `proj-${hash}`;
}

export async function projectEdit(input: ProjectEditInput) {
  return withToolTelemetry({ tool: "project_edit" }, async () => {
    switch (input.action) {
      case "create": {
        const seed = input.gitRemoteUrl ?? input.path ?? `${input.name}:${uuidv4()}`;
        const id = generateProjectId(seed);
        const now = new Date();
        await db.createProject({
          id,
          name: input.name,
          description: input.description,
          path: input.path,
          gitRemoteUrl: input.gitRemoteUrl,
          techStack: input.techStack ?? [],
          createdAt: now,
          updatedAt: now,
        });
        const saved = await db.getProject(id);
        return asToolText({ action: "create", project: saved });
      }

      case "update": {
        const existing = await db.getProject(input.projectId);
        if (!existing) {
          throw new NotFoundError(`Project not found: ${input.projectId}`, {
            hint: "Call project_view(action='list') to see available projects.",
          });
        }
        const merged = {
          ...existing,
          name: input.name ?? existing.name,
          description: input.description ?? existing.description,
          path: input.path ?? existing.path,
          gitRemoteUrl: input.gitRemoteUrl ?? existing.gitRemoteUrl,
          techStack: input.techStack ?? existing.techStack ?? [],
          updatedAt: new Date(),
        };
        await db.createProject(merged); // upsert
        const saved = await db.getProject(input.projectId);
        return asToolText({ action: "update", project: saved });
      }

      case "set_active": {
        // Plan §3.2 — write only the (client_id, project_id) row.
        // No global state, no side effects on other clients.
        const project = await db.getProject(input.projectId);
        if (!project) {
          throw new NotFoundError(`Project not found: ${input.projectId}`, {
            hint: "Cannot set active to a project that doesn't exist; create it first.",
          });
        }
        const result = await db.setActiveProjectForClient(input.clientId, input.projectId);
        return asToolText({
          action: "set_active",
          clientId: input.clientId,
          activeProject: project,
          setAt: result.setAt instanceof Date ? result.setAt.toISOString() : result.setAt,
        });
      }
    }
  });
}
