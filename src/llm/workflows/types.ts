/**
 * Shared workflow-runner types (Group 15).
 *
 * Each agent-mode workflow module exports a `WorkflowModule` so the
 * runner in `runner.ts` can dispatch generically. The `inputs` payload
 * is the same `WorkflowRunInput.inputs` blob the caller passes to
 * `workflow_run`; each workflow's `userTemplate` decides which fields
 * matter and renders the user prompt accordingly.
 */

import type { z } from "zod";
import type { WorkflowName } from "../../tools/workflows/definitions.js";

export interface WorkflowModule<TSchema extends z.ZodTypeAny = z.ZodTypeAny> {
  name: WorkflowName;
  /** Static system prompt — sets role + invariants for the model. */
  systemPrompt: string;
  /** Build the user-side prompt from the caller's `inputs` blob. */
  userTemplate: (inputs: Record<string, unknown> | undefined) => string;
  /** Zod schema the response must conform to. */
  outputSchema: TSchema;
  /**
   * Hard upper bound on the **input** prompt size, measured as the
   * sum of estimated tokens in `systemPrompt` + rendered user prompt.
   * Enforced before the provider call (15.5). Keeps an oversize
   * inputs blob from triggering a provider-side 4xx after we've
   * already paid for the round trip.
   */
  inputTokenBudget: number;
  /** Cap on the provider's output tokens. */
  maxOutputTokens?: number;
}
