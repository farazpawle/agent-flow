/**
 * `review` workflow — critique a plan/analysis and surface gaps.
 */

import { reviewOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const artefact =
    (inputs?.artefact as string | undefined) ??
    (inputs?.plan as string | undefined) ??
    (inputs?.analysis as string | undefined) ??
    "(no artefact supplied)";
  const similarTasks = (inputs?.similarTasks as string | undefined) ?? "";

  const lines = ["Critique the artefact below.", "", "ARTEFACT:", artefact];
  if (similarTasks) {
    lines.push("", "SIMILAR PRIOR TASKS:", similarTasks);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- 3–5 specific weaknesses; cite a concrete example for each, not vibes.",
    "- Each weakness must come with a minimal `correction` the original author can act on.",
    "- `readiness` is `ready` only if the original author needs no further input from you."
  );
  return lines.join("\n");
}

export const reviewWorkflow: WorkflowModule<typeof reviewOutputSchema> = {
  name: "review",
  systemPrompt:
    "You are AgentFlow's critique workflow. Critique plans and analyses for concrete weaknesses — never aesthetic feedback. Score readiness honestly; do not avoid pushback.",
  userTemplate: renderPrompt,
  outputSchema: reviewOutputSchema,
  inputTokenBudget: 6_000,
  maxOutputTokens: 1_500,
};
