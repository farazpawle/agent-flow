/**
 * `generate_release_summary` workflow — compose a human-readable release summary.
 */

import { generateReleaseSummaryOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const version = (inputs?.version as string | undefined) ?? "(version unspecified)";
  const completedTasks = (inputs?.completedTasks as string | undefined) ?? "";
  const findings = (inputs?.findings as string | undefined) ?? "";

  const lines = [`Compose a release summary for version: ${version}.`];
  if (completedTasks) {
    lines.push("", "COMPLETED TASKS SINCE LAST RELEASE:", completedTasks);
  }
  if (findings) {
    lines.push("", "RELEVANT FINDINGS (commits / PRs / etc):", findings);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- Group highlights by theme: feature / fix / chore / docs / perf / security.",
    "- Write one-line user-facing summaries — assume no project context.",
    "- Surface breakingChanges FIRST when present; don't bury them."
  );
  return lines.join("\n");
}

export const generateReleaseSummaryWorkflow: WorkflowModule<
  typeof generateReleaseSummaryOutputSchema
> = {
  name: "generate_release_summary",
  systemPrompt:
    "You are AgentFlow's release-summary writer. Produce a human-readable release summary from completed tasks and recorded artifacts. Group highlights by theme; surface breaking changes prominently.",
  userTemplate: renderPrompt,
  outputSchema: generateReleaseSummaryOutputSchema,
  inputTokenBudget: 10_000,
  maxOutputTokens: 2_500,
};
