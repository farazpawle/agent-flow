/**
 * `record_decision` workflow — document an architectural decision.
 */

import { recordDecisionOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const task = (inputs?.task as string | undefined) ?? "";
  const priorDecisions = (inputs?.priorDecisions as string | undefined) ?? "";
  const proposal =
    (inputs?.proposal as string | undefined) ??
    (inputs?.decision as string | undefined) ??
    "(no proposal supplied)";

  const lines = ["Document this decision.", "", "PROPOSAL:", proposal];
  if (task) {
    lines.push("", "TASK CONTEXT:", task);
  }
  if (priorDecisions) {
    lines.push("", "PRIOR DECISIONS:", priorDecisions);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- `decision` is one forward-looking sentence ('we will …').",
    "- `consequences` names what becomes harder/easier because of this.",
    "- `revisitWhen` is concrete (date / metric / event), not 'someday'."
  );
  return lines.join("\n");
}

export const recordDecisionWorkflow: WorkflowModule<typeof recordDecisionOutputSchema> = {
  name: "record_decision",
  systemPrompt:
    "You are AgentFlow's decision-recording workflow. Capture an architectural or product decision with rationale and rejected alternatives, in a form a teammate joining next month could act on.",
  userTemplate: renderPrompt,
  outputSchema: recordDecisionOutputSchema,
  inputTokenBudget: 4_000,
  maxOutputTokens: 1_500,
};
