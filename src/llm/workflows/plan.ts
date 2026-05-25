/**
 * `plan` workflow — turns a short idea into a structured plan.
 */

import { planOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const idea =
    (inputs?.idea as string | undefined) ??
    (inputs?.description as string | undefined) ??
    "(no idea supplied)";
  const projectSummary = (inputs?.projectSummary as string | undefined) ?? "";
  const constraints = Array.isArray(inputs?.constraints)
    ? (inputs?.constraints as unknown[]).map(String)
    : [];

  const lines = ["Produce a structured plan for the following idea.", "", `IDEA:`, idea];
  if (projectSummary) {
    lines.push("", "PROJECT CONTEXT:", projectSummary);
  }
  if (constraints.length > 0) {
    lines.push("", "KNOWN CONSTRAINTS:");
    for (const c of constraints) lines.push(`- ${c}`);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- `problem`/`outcome` must be ≥20 chars.",
    "- 3–7 milestones in dependency order, each with a `rationale`.",
    "- `openQuestions` lists missing facts (not topics) the planner can't answer."
  );
  return lines.join("\n");
}

export const planWorkflow: WorkflowModule<typeof planOutputSchema> = {
  name: "plan",
  systemPrompt:
    "You are AgentFlow's planning workflow. Convert a short idea into a structured plan suitable for downstream task splitting. Be concrete; never produce filler. If you don't know something, list it under openQuestions rather than guessing.",
  userTemplate: renderPrompt,
  outputSchema: planOutputSchema,
  inputTokenBudget: 4_000,
  maxOutputTokens: 1_500,
};
