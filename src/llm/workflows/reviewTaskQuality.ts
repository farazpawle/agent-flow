/**
 * `review_task_quality` workflow — decide whether a task is ready.
 */

import { reviewTaskQualityOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const task = (inputs?.task as string | undefined) ?? "(no task supplied)";
  const dependencies = (inputs?.dependencies as string | undefined) ?? "";
  const similar = (inputs?.similar as string | undefined) ?? "";

  const lines = ["Assess this task's readiness for execution.", "", "TASK:", task];
  if (dependencies) {
    lines.push("", "DEPENDENCIES:", dependencies);
  }
  if (similar) {
    lines.push("", "SIMILAR PRIOR TASKS:", similar);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- verdict ∈ ready | unclear | too_large | blocked.",
    "- `reasoning` cites the specific fields you checked.",
    "- If verdict is unclear or too_large, supply `proposedChanges`.",
    "- If verdict is blocked, populate `blockingDependencies` with task IDs."
  );
  return lines.join("\n");
}

export const reviewTaskQualityWorkflow: WorkflowModule<typeof reviewTaskQualityOutputSchema> = {
  name: "review_task_quality",
  systemPrompt:
    "You are AgentFlow's task-readiness reviewer. Decide whether a task is ready to start, or what specifically blocks it. Do not pad — a one-sentence reasoning that names the missing field is better than a paragraph of restatement.",
  userTemplate: renderPrompt,
  outputSchema: reviewTaskQualityOutputSchema,
  inputTokenBudget: 4_000,
  maxOutputTokens: 1_000,
};
