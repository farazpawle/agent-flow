/**
 * `detect_duplicates` workflow — find candidate-duplicate tasks.
 *
 * Per plan 15.6: proposal-only. The agent must call
 * `task_edit(action='merge', ...)` to apply.
 */

import { detectDuplicatesOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const tasks = (inputs?.tasks as string | undefined) ?? "(no tasks supplied)";

  const lines = [
    "Find candidate-duplicate tasks in the list below.",
    "",
    "TASKS:",
    tasks,
    "",
    "Return JSON matching the supplied schema.",
    "- Compare descriptions, not just names.",
    "- `merge` only when the outcome overlaps, not just keywords.",
    "- This is a PROPOSAL — never call task_edit yourself.",
  ];
  return lines.join("\n");
}

export const detectDuplicatesWorkflow: WorkflowModule<typeof detectDuplicatesOutputSchema> = {
  name: "detect_duplicates",
  systemPrompt:
    "You are AgentFlow's duplicate-detection workflow. Identify task pairs/groups whose outcomes overlap. Output is a PROPOSAL only — never call any tool yourself. The agent will apply merges explicitly via task_edit(action='merge').",
  userTemplate: renderPrompt,
  outputSchema: detectDuplicatesOutputSchema,
  inputTokenBudget: 8_000,
  maxOutputTokens: 2_000,
};
