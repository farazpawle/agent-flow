/**
 * `compile_skill` workflow (Wave 3 §10.E).
 *
 * Rolls up `tasks.lessonsLearned` (COMPLETED tasks) plus high-signal
 * `task_findings` (kind ∈ lessons|decision|success) into a project-level
 * "Skill" document. The caller pre-clusters items lexically and only
 * sends clusters with ≥2 supporting items — the LLM is then responsible
 * for distilling each cluster into a tight `{ topic, rules[],
 * sourceFindingIds[] }` block.
 *
 * Output cap: 3000 tokens; if the call returns more, the model server
 * truncates and we just fail validation (the model layer drops oldest
 * items first on the *input* side).
 */

import { compileSkillOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const projectName = (inputs?.projectName as string | undefined) ?? "(unspecified)";
  const clusters = (inputs?.clusters as string | undefined) ?? "(no clusters)";
  const priorSummary = (inputs?.priorSummary as string | undefined) ?? "";

  const lines = [
    `Distil the clustered source material below into a forward-looking Skill document for project '${projectName}'.`,
    "",
    "Each cluster MUST become one entry in `topics[]`. Each topic needs:",
    "- a short `topic` (≤8 words, the recurring theme),",
    "- 1–5 actionable `rules` written in second person ('When X, do Y…'),",
    "- `sourceFindingIds` carried verbatim from the cluster header so the audit trail is preserved.",
    "",
    "Do NOT invent rules outside the supplied evidence. If a cluster's items contradict each other, surface the tension as a single rule that names the trade-off.",
    "",
    "Frontmatter should include:",
    "- `name`: '<project name> skill'",
    "- `description`: a one-sentence purpose.",
    "- `compiledAt`: today's ISO date.",
    "",
    "SOURCE CLUSTERS:",
    clusters,
  ];
  if (priorSummary) {
    lines.push("", "PRIOR SKILL (avoid duplicating identical rules):", priorSummary);
  }
  lines.push("", "Return JSON matching the supplied schema. No prose, no code fences.");
  return lines.join("\n");
}

export const compileSkillWorkflow: WorkflowModule<typeof compileSkillOutputSchema> = {
  name: "compile_skill",
  systemPrompt:
    "You are AgentFlow's Skill-compiler. Distil clustered lessons + decisions into a tight, forward-looking project Skill. Cite findingIds verbatim; never invent material outside the supplied evidence.",
  userTemplate: renderPrompt,
  outputSchema: compileSkillOutputSchema,
  inputTokenBudget: 12_000,
  maxOutputTokens: 3_000,
};
