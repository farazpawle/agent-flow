/**
 * `split_plan` workflow — decompose a plan into atomic tasks.
 *
 * Per plan 15.6: this workflow returns a PROPOSAL only. It never
 * mutates state — the agent must call `task_edit(action='create')`
 * for each proposed task to apply.
 */

import { splitPlanOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const plan = (inputs?.plan as string | undefined) ?? "(no plan supplied)";
  const existingTasks = (inputs?.existingTasks as string | undefined) ?? "";

  const lines = ["Propose a decomposition of the plan into atomic tasks.", "", "PLAN:", plan];
  if (existingTasks) {
    lines.push("", "EXISTING TASKS (avoid duplicating):", existingTasks);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- Each task is ≤1 day of work and individually verifiable.",
    "- `dependsOnIndex` references the 0-based proposal index of prior tasks.",
    "- Do NOT call task_edit — this workflow is proposal-only. The caller will apply."
  );
  return lines.join("\n");
}

export const splitPlanWorkflow: WorkflowModule<typeof splitPlanOutputSchema> = {
  name: "split_plan",
  systemPrompt:
    "You are AgentFlow's task-decomposition workflow. Decompose a plan into a list of atomic tasks. Output is a PROPOSAL only — never invoke any tool yourself. The agent will apply the decomposition explicitly via task_edit(action='create').",
  userTemplate: renderPrompt,
  outputSchema: splitPlanOutputSchema,
  inputTokenBudget: 6_000,
  maxOutputTokens: 2_500,
};
