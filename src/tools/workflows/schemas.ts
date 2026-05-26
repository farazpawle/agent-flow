/**
 * `workflow_run` schema — Phase 1 Group 10.
 *
 * Discriminated union on `workflow` covering all 11 workflows. Each
 * branch carries an optional `inputs` shape so callers can supply the
 * structured context the workflow needs without a free-form blob, plus
 * optional `projectId`/`taskId` shortcuts for the common case.
 *
 * `mode` is an optional override for the env-level `WORKFLOW_MODE`
 * setting (manual | agent | disabled). Group 10 ships manual only; the
 * `agent` value degrades back to manual until Group 15 lands the LLM
 * provider layer. `disabled` returns a typed `WORKFLOW_DISABLED`
 * response without invoking any workflow.
 */

import { z } from "zod";

export const WORKFLOW_MODE_ENUM = z.enum(["manual", "agent", "disabled"]);
export type WorkflowMode = z.infer<typeof WORKFLOW_MODE_ENUM>;

const COMMON_SHAPE = {
  projectId: z.string().min(1).optional(),
  taskId: z.string().min(1).optional(),
  /**
   * Free-form structured context the workflow expects. Manual mode
   * echoes it back in the response so the agent can keep state
   * across workflow_run calls without a separate scratchpad.
   */
  inputs: z.record(z.unknown()).optional(),
  /** Optional override for the env-level WORKFLOW_MODE. */
  mode: WORKFLOW_MODE_ENUM.optional(),
} as const;

// Explicit per-branch declarations so TypeScript can narrow the input
// type by `workflow` (the .map(...) pattern erases it). All 11 branches
// share `COMMON_SHAPE` for Phase 1; Group 15 may sharpen them later.
export const workflowRunSchema = z.discriminatedUnion("workflow", [
  z.object({ workflow: z.literal("plan"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("analyze"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("review"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("split_plan"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("process_thought"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("record_decision"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("review_task_quality"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("build_context_pack"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("summarize_lessons"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("detect_duplicates"), ...COMMON_SHAPE }),
  z.object({ workflow: z.literal("generate_release_summary"), ...COMMON_SHAPE }),
]);

export type WorkflowRunInput = z.infer<typeof workflowRunSchema>;

// Discriminator value enum (handy for callers writing wrappers).
export const WORKFLOW_NAME_ENUM = z.enum([
  "plan",
  "analyze",
  "review",
  "split_plan",
  "process_thought",
  "record_decision",
  "review_task_quality",
  "build_context_pack",
  "summarize_lessons",
  "detect_duplicates",
  "generate_release_summary",
]);
