/**
 * `artifact_record` — Phase 1 Group 9.
 *
 * Append-only artifact ingestion. Every successful call writes exactly
 * one row to `task_findings` via `db.createFinding`. There is no
 * UPDATE or DELETE handler exposed on the MCP surface — Group 1.9's
 * retention job is the only writer that ever removes rows, and it
 * operates by cutoff timestamp, not by id.
 *
 * The returned `findingId` is the handle callers reference from
 * `task_lifecycle(action='finalize', result.evidenceRefs=[...])` and
 * read back via `context_get(type='findings', taskId)`. See plan §3.7
 * + §6.5 for the round-trip contract.
 */

import { db } from "../../models/db.js";
import { NotFoundError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import type { ArtifactRecordInput } from "./schemas.js";

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Translate the per-kind discriminated input into the flat `content`
 * payload `task_findings` expects. Kind-specific scalars (sha, url,
 * status, etc.) are folded into `content` so the row is queryable
 * directly without joining out to a per-kind side table.
 */
function buildFindingPayload(input: ArtifactRecordInput): {
  type: string | undefined;
  content: unknown;
} {
  switch (input.kind) {
    case "finding":
      return { type: input.type, content: input.content };
    case "test_log":
      return {
        type: input.outcome,
        content: {
          outcome: input.outcome,
          content: input.content,
          ...(input.suite ? { suite: input.suite } : {}),
          ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        },
      };
    case "build_log":
      return {
        type: input.outcome,
        content: {
          outcome: input.outcome,
          content: input.content,
          ...(input.toolchain ? { toolchain: input.toolchain } : {}),
          ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
        },
      };
    case "reference":
      return {
        type: undefined,
        content: {
          url: input.url,
          ...(input.title ? { title: input.title } : {}),
          ...(input.note ? { note: input.note } : {}),
        },
      };
    case "commit":
      return {
        type: undefined,
        content: {
          sha: input.sha,
          message: input.message,
          ...(input.url ? { url: input.url } : {}),
          ...(input.author ? { author: input.author } : {}),
        },
      };
    case "pull_request":
      return {
        type: input.status,
        content: {
          url: input.url,
          status: input.status,
          ...(input.title ? { title: input.title } : {}),
          ...(input.author ? { author: input.author } : {}),
        },
      };
    case "evidence":
      return { type: input.type, content: input.content };
  }
}

export async function artifactRecord(input: ArtifactRecordInput) {
  return withToolTelemetry({ tool: "artifact_record" }, async () => {
    // Pre-check: the underlying adapter throws a generic Error if it
    // can't resolve `project_id` from `task_id`. Surface a typed
    // NotFoundError with a helpful hint so the agent self-corrects.
    const task = await db.getTask(input.taskId);
    if (!task) {
      throw new NotFoundError(`Task not found: ${input.taskId}`, {
        hint: "Call task_view(action='get', taskId) to confirm the id.",
      });
    }

    const { type, content } = buildFindingPayload(input);
    const finding = await db.createFinding({
      taskId: input.taskId,
      kind: input.kind,
      ...(type !== undefined ? { type } : {}),
      content,
      ...(input.metadata ? { metadata: input.metadata } : {}),
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    });

    return asToolText({
      tool: "artifact_record",
      findingId: finding.id,
      kind: finding.kind,
      type: finding.type ?? null,
      taskId: finding.taskId,
      projectId: finding.projectId,
      createdAt: finding.createdAt.toISOString(),
    });
  });
}
