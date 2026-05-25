/**
 * `process_thought` workflow — capture a single reasoning step.
 */

import { processThoughtOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const thought =
    (inputs?.thought as string | undefined) ??
    (inputs?.question as string | undefined) ??
    "(no thought supplied)";
  const context = (inputs?.context as string | undefined) ?? "";

  const lines = ["Capture this reasoning step.", "", "THOUGHT:", thought];
  if (context) {
    lines.push("", "CONTEXT:", context);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- Hypothesis must be falsifiable.",
    "- nextAction must move you closer to confirming or refuting the hypothesis."
  );
  return lines.join("\n");
}

export const processThoughtWorkflow: WorkflowModule<typeof processThoughtOutputSchema> = {
  name: "process_thought",
  systemPrompt:
    "You are AgentFlow's chain-of-thought capture workflow. Externalise a single reasoning step: hypothesis, supporting evidence, refuting evidence, next action. Be terse.",
  userTemplate: renderPrompt,
  outputSchema: processThoughtOutputSchema,
  inputTokenBudget: 3_000,
  maxOutputTokens: 800,
};
