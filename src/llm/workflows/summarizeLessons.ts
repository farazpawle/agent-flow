/**
 * `summarize_lessons` workflow — roll up findings into project-level lessons.
 */

import { summarizeLessonsOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const findings = (inputs?.findings as string | undefined) ?? "(no findings supplied)";
  const priorLessons = (inputs?.priorLessons as string | undefined) ?? "";

  const lines = [
    "Roll up the findings below into a small number of forward-looking lessons.",
    "",
    "FINDINGS:",
    findings,
  ];
  if (priorLessons) {
    lines.push("", "PRIOR LESSON SUMMARIES (avoid duplicating):", priorLessons);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- Each lesson must aggregate ≥2 findings — phrase as 'next time, …'.",
    "- Cite the source findingIds so each lesson is auditable.",
    "- Drop folkloric advice — the lesson must be actionable in a future task."
  );
  return lines.join("\n");
}

export const summarizeLessonsWorkflow: WorkflowModule<typeof summarizeLessonsOutputSchema> = {
  name: "summarize_lessons",
  systemPrompt:
    "You are AgentFlow's lesson-summariser. Cluster findings by topic and produce forward-looking lessons that survive task churn. Never produce a lesson from a single finding.",
  userTemplate: renderPrompt,
  outputSchema: summarizeLessonsOutputSchema,
  inputTokenBudget: 8_000,
  maxOutputTokens: 1_800,
};
