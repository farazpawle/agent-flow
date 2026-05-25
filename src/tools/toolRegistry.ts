/**
 * Centralized tool-name → Zod schema map.
 *
 * Phase 1 Group 2.2: this is the single source of truth the
 * `scripts/export-tool-schemas.mjs` golden-fixture exporter walks.
 * `src/index.ts` already wires each schema into the MCP `ListTools`
 * response inline; keeping the names in lock-step with this registry
 * is what makes the fixture diff meaningful.
 *
 * When a Group 4+ tool is added, register it here AND in `src/index.ts`.
 * The CI golden-fixture step (Group 12.5) will detect drift.
 */

import type { ZodTypeAny } from "zod";

// Phase 1 Group 10.8 — plan_idea + process_thought removed from the
// MCP surface; their behaviour is subsumed by `workflow_run` with the
// `plan`/`analyze`/`review`/`process_thought` workflows.

// Phase 1 Group 4 — read-only view tools.
import { projectViewSchema, taskViewSchema, contextGetSchema } from "./views/index.js";

// Phase 1 Group 5 — non-destructive edit tools.
import { projectEditSchema, taskEditSchema } from "./edits/index.js";

// Phase 1 Group 6 — destructive tools (dry_run/execute split).
import { projectDeleteSchema, taskDeleteSchema } from "./deletes/index.js";

// Phase 1 Group 7 — task lifecycle (replaces execute_task / verify_task /
// complete_task on the agent surface).
//
// Phase 4 Group 20 — the verify_task / complete_task deprecation shims
// (kept for one minor as advertised by `DEPRECATION_REMOVAL_VERSION =
// "1.2.0"`) are now removed. Callers must use `task_lifecycle`
// directly. See CHANGELOG "[1.2.0]" for the migration pointer.
import { taskLifecycleSchema } from "./lifecycle/index.js";

// Phase 1 Group 9 — artifact_record append-only ingestion. Discriminated
// on `kind`; never exposed UPDATE/DELETE. The findingId returned here is
// the handle for `task_lifecycle(finalize).result.evidenceRefs[]` and
// for `context_get(type='findings')`.
import { artifactRecordSchema } from "./artifacts/index.js";

// Phase 1 Group 10 — workflow_run manual-mode scaffold. Discriminated
// union on `workflow` covering 11 workflows. Replaces plan_idea +
// process_thought; agent mode (Group 15) will reuse the outputSchema
// JSON Schemas defined in `./workflows/definitions.ts`.
import { workflowRunSchema } from "./workflows/index.js";

/**
 * Map of MCP tool name → Zod input schema.
 * Names must match the literal `name` passed to `ListToolsRequestSchema` in
 * `src/index.ts`; the golden-fixture diff catches mismatches.
 */
export const TOOL_SCHEMAS: Readonly<Record<string, ZodTypeAny>> = Object.freeze({
  // Phase 1 Group 4 — view tools (replace list_tasks, find_task,
  // list_projects, get_project_context).
  task_view: taskViewSchema,
  project_view: projectViewSchema,
  context_get: contextGetSchema,

  // Phase 1 Group 5 — non-destructive edit tools (replace create_project,
  // update_task, reorder_tasks; consume non-destructive split_tasks paths).
  project_edit: projectEditSchema,
  task_edit: taskEditSchema,

  // Phase 1 Group 6 — destructive tools (replace delete_project,
  // delete_task, split_tasks(clearAllTasks)).
  project_delete: projectDeleteSchema,
  task_delete: taskDeleteSchema,

  // Phase 1 Group 7 — unified lifecycle tool (replaces execute_task,
  // verify_task, complete_task). The Group-8 verify_task /
  // complete_task shims were removed in Phase 4 Group 20 (v1.2.0).
  task_lifecycle: taskLifecycleSchema,

  // Phase 1 Group 9 — append-only artifact ingestion. Discriminated
  // on `kind` (finding | test_log | build_log | reference | commit |
  // pull_request | evidence). NO update/delete handler is exposed —
  // append-only is enforced at the API layer.
  artifact_record: artifactRecordSchema,

  // Phase 1 Group 10 — workflow_run manual-mode scaffold. Replaces
  // plan_idea + process_thought; agent mode lands in Group 15.
  workflow_run: workflowRunSchema,
});

export type ToolName = keyof typeof TOOL_SCHEMAS;

export function getToolSchema(name: string): ZodTypeAny | undefined {
  return (TOOL_SCHEMAS as Record<string, ZodTypeAny>)[name];
}

export function listToolNames(): string[] {
  return Object.keys(TOOL_SCHEMAS).sort();
}
