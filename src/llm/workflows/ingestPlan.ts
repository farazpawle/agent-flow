/**
 * `ingest_plan` workflow (Wave 3 §10.A).
 *
 * Parses a markdown plan into a structured task tree the
 * `/api/plan/upload/preview` route writes into the preview cache. The
 * commit route then turns the parsed shape into real tasks (+ optional
 * group + dependency edges).
 *
 * Hierarchy rules (matched by `ingestPlanOutputSchema` and re-checked in
 * the preview handler):
 *   - Top-level `- [ ]` bullets → parent tasks.
 *   - Indented `- [ ]` bullets → subtasks with `parentIndex` pointing at
 *     a top-level task earlier in the list (no grandchildren).
 *   - `# Feature: <name>` H1 → optional group with that name.
 *   - `dependsOnPreviousIndex=true` chains the task to its immediate
 *     predecessor in the same `tasks[]` array.
 */

import { ingestPlanOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const planMarkdown = (inputs?.planMarkdown as string | undefined) ?? "";
  const projectName = (inputs?.projectName as string | undefined) ?? "(unspecified)";

  const lines = [
    "Parse the markdown plan below into a structured task list the AgentFlow server can ingest.",
    "",
    `Project: ${projectName}`,
    "",
    "PLAN:",
    "```markdown",
    planMarkdown.length > 0 ? planMarkdown : "(empty plan)",
    "```",
    "",
    "Rules:",
    "- Top-level `- [ ]` checkbox bullets become parent tasks (parentIndex omitted).",
    "- Bullets nested under a top-level bullet become subtasks; set parentIndex to the index of the parent in the resulting tasks[] array.",
    "- Refuse grandchildren: a task whose parentIndex points at a task that already has a parentIndex is invalid.",
    "- A top-of-document line of the form `# Feature: <name>` becomes the optional group { name, description? }.",
    "- Set dependsOnPreviousIndex=true when the bullet text implies the task must follow its immediate predecessor (e.g. 'After …', 'Once X is done …').",
    "- Each task needs a concrete actionable name and a 1–3 sentence description. Reuse the bullet's text — do not invent work.",
    "- Preserve the author's ordering. Do not reorder, merge, or split bullets.",
    "",
    "Return JSON matching the supplied schema. No prose, no code fences.",
  ];
  return lines.join("\n");
}

export const ingestPlanWorkflow: WorkflowModule<typeof ingestPlanOutputSchema> = {
  name: "ingest_plan",
  systemPrompt:
    "You are AgentFlow's plan-ingester. Convert a markdown checklist into a structured task tree without inventing scope. Preserve the author's intent verbatim.",
  userTemplate: renderPrompt,
  outputSchema: ingestPlanOutputSchema,
  inputTokenBudget: 12_000,
  maxOutputTokens: 4_000,
};
