/**
 * `analyze` workflow — pick a technical approach and weigh it against alternatives.
 */

import { analyzeOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const plan = (inputs?.plan as string | undefined) ?? "(no plan supplied)";
  const implementationContext = (inputs?.implementationContext as string | undefined) ?? "";
  const constraints = Array.isArray(inputs?.constraints)
    ? (inputs?.constraints as unknown[]).map(String)
    : [];

  const lines = ["Read the plan and propose a technical approach.", "", "PLAN:", plan];
  if (implementationContext) {
    lines.push("", "IMPLEMENTATION CONTEXT:", implementationContext);
  }
  if (constraints.length > 0) {
    lines.push("", "CONSTRAINTS:");
    for (const c of constraints) lines.push(`- ${c}`);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- Pick ONE chosenApproach with a rationale naming a concrete failure mode it avoids.",
    "- List ≥1 alternative with its concrete trade-off.",
    "- `riskiestAssumption` must be a single sentence describing what could falsify the choice."
  );
  return lines.join("\n");
}

export const analyzeWorkflow: WorkflowModule<typeof analyzeOutputSchema> = {
  name: "analyze",
  systemPrompt:
    "You are AgentFlow's analysis workflow. Convert a plan into a technical analysis: pick one approach, compare it to alternatives, and surface the riskiest assumption. Be decisive — if data is missing, pick the approach that lets you verify it fastest.",
  userTemplate: renderPrompt,
  outputSchema: analyzeOutputSchema,
  inputTokenBudget: 6_000,
  maxOutputTokens: 1_500,
};
