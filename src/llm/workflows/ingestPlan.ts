/**
 * `ingest_plan` workflow (Wave 3 §10.A).
 *
 * Parses a freeform markdown plan into a structured task list the
 * `/api/plan/upload/preview` route writes into the preview cache. The
 * commit route then turns the parsed shape into real tasks (+ optional
 * group + dependency edges).
 *
 * Design intent: the author's plan may use ANY markdown — `#`/`##`/`###`
 * headings, `-`/`*` bullets, `1.` numbered lists, `- [ ]` checkboxes, or
 * plain prose. The workflow is a *decomposer*, not a checklist transcriber:
 * it maps that structure onto a Feature → Group → Task hierarchy and breaks
 * coarse sections into right-sized, individually-verifiable tasks.
 *
 * Hierarchy rules (matched by `ingestPlanOutputSchema` and re-checked in
 * the preview handler) — feature-hierarchy:
 *   - A document title / `# Feature: <name>` H1 → the `feature` (one parent
 *     group for the whole plan). `null` when the plan has no title line.
 *   - Each `##`/`###` section → an entry in `groups[]`, in document order.
 *     A plan with no sections collapses to a single group.
 *   - Steps/bullets/sentences under a section → `tasks[]`, each pointing at
 *     its section via `groupIndex` (index into `groups[]`). There is NO
 *     task→subtask nesting any more — `parentIndex` is retired for ingest.
 *   - `dependsOnIndexes` lists the array indices of EARLIER tasks that must
 *     finish before this one can start (genuine prerequisites only).
 */

import { ingestPlanOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

/**
 * Compact, carefully-written few-shot example. It strongly steers the
 * model, so it deliberately demonstrates the desired behaviour — not just
 * the schema shape:
 *   - `# Feature:` → `feature`; each `##` section → an entry in `groups[]`;
 *     bullets under a section → `tasks[]` with `groupIndex` into that group.
 *   - A coarse section ("Add dark mode") is decomposed into the concrete
 *     steps it implies, while each already-atomic bullet maps to exactly ONE
 *     task (no over-splitting). All steps stay inside their section's group.
 *   - `verificationCriteria` is filled on every task.
 *   - Dependencies are mostly `[]`; exactly one genuine `dependsOnIndexes`
 *     edge appears where a task truly blocks another.
 */
const FEW_SHOT_EXAMPLE = [
  "Example — given this plan:",
  "```markdown",
  "# Feature: User Settings",
  "",
  "## Add dark mode",
  "- Persist the user's theme choice",
  "- Add a toggle on the settings page",
  "",
  "## Wire up logout",
  "- Add a logout button to the header",
  "```",
  "",
  "A good response is:",
  "```json",
  JSON.stringify(
    {
      feature: { name: "User Settings", description: null },
      groups: [
        { name: "Add dark mode", description: null },
        { name: "Wire up logout", description: null },
      ],
      tasks: [
        {
          name: "Persist the user's theme choice",
          description: "Store the selected theme so it survives reloads and new sessions.",
          verificationCriteria: "Reloading the page keeps the previously selected theme.",
          dependsOnIndexes: [],
          groupIndex: 0,
        },
        {
          name: "Add a theme toggle to the settings page",
          description: "Add a control on the settings page that switches between light and dark.",
          verificationCriteria: "Toggling the control immediately switches the theme.",
          dependsOnIndexes: [0],
          groupIndex: 0,
        },
        {
          name: "Add a logout button to the header",
          description: "Add a logout button to the global header that triggers sign-out.",
          verificationCriteria: "A logout button is visible in the header for signed-in users.",
          dependsOnIndexes: [],
          groupIndex: 1,
        },
      ],
    },
    null,
    2
  ),
  "```",
].join("\n");

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const planMarkdown = (inputs?.planMarkdown as string | undefined) ?? "";
  const projectName = (inputs?.projectName as string | undefined) ?? "(unspecified)";

  const lines = [
    "Convert the markdown plan below into a structured task list the AgentFlow server can ingest.",
    "",
    `Project: ${projectName}`,
    "",
    "PLAN:",
    "```markdown",
    planMarkdown.length > 0 ? planMarkdown : "(empty plan)",
    "```",
    "",
    "STRUCTURE — the plan may use any markdown (headings, `-`/`*` bullets, `1.` numbered lists, `- [ ]` checkboxes, or prose). Map it onto Feature → Group → Task:",
    "- A document title or a `# Feature: <name>` / top-level H1 → `feature` { name, description }. If there is no such line, set feature = null.",
    "- Each section heading (`##`/`###`) → one entry in `groups[]`, in document order. If the plan has NO sections, emit a single group (name it after the feature/plan, or 'Tasks').",
    "- Steps, bullets, or sentences under a section → entries in `tasks[]`, each with groupIndex = the index of that section in groups[]. There is NO subtask nesting — every task points at a group, not at another task.",
    "- Every task MUST have a valid groupIndex in range [0, groups.length-1]. Never leave a task ungrouped.",
    "",
    "DECOMPOSITION — produce ENOUGH tasks but NOT too many:",
    "- A coarse section (e.g. 'Build auth') is rarely one task. Break it into the concrete steps the section actually describes (endpoint, validation, tests, docs, …), all sharing that section's groupIndex. Aim for tasks an engineer can finish in roughly half a day to a day each.",
    "- Do NOT split a simple, already-atomic bullet into multiple tasks. One concrete bullet ('Add a logout button') is one task — never manufacture sub-steps for it.",
    "- Do not merge unrelated work into one task, and do not pad with work the plan never mentions.",
    "- Scale the task count to the plan's real size (rough guide, NOT a quota to hit): a small plan → ~5–15 tasks; medium → ~15–40; 40+ only if the plan genuinely contains that much work.",
    "",
    "CONTENT — every task needs:",
    "- name: a concrete, imperative action ('Add POST /api/auth/login', not 'Auth').",
    "- description: 1–3 sentences saying WHAT to do and WHY, grounded in the plan's own wording.",
    "- verificationCriteria: a short, checkable acceptance test ('Returns 200 + JWT for valid creds, 401 otherwise'). Always fill this in.",
    "",
    "DEPENDENCIES — be strict:",
    "- Set dependsOnIndexes to the indices of tasks that must finish first. Add a dependency ONLY when this task genuinely cannot start until that task is complete — never just because it appears earlier in the plan or looks related.",
    "- Independent tasks get []. Indices must point at EARLIER tasks (smaller than this task's own index). Prefer the smallest set; do not chain everything linearly.",
    "",
    "Preserve the author's overall ordering and terminology. Never invent scope the plan doesn't imply, and never drop scope it states.",
    "",
    FEW_SHOT_EXAMPLE,
    "",
    "Now return JSON matching the supplied schema for the PLAN above. No prose, no code fences.",
  ];
  return lines.join("\n");
}

export const ingestPlanWorkflow: WorkflowModule<typeof ingestPlanOutputSchema> = {
  name: "ingest_plan",
  systemPrompt:
    "You are AgentFlow's plan-ingester. You read an author's freeform markdown plan — any mix of `#`/`##`/`###` headings, `-`/`*` bullets, `1.` numbered lists, `- [ ]` checkboxes, or prose — and convert it into a Feature → Group → Task hierarchy: one optional feature (the plan's title), an ordered list of groups (the plan's sections), and a list of concrete, independently-executable tasks, each assigned to a group via groupIndex. Decompose coarse sections into right-sized tasks an engineer can finish in roughly half a day to a day each, but never split an already-atomic item or pad with work the plan omits. Stay faithful to the author's intent, sequencing, and terminology; never invent scope the plan doesn't imply, and never drop scope it states.",
  userTemplate: renderPrompt,
  outputSchema: ingestPlanOutputSchema,
  inputTokenBudget: 20_000,
  maxOutputTokens: 8_000,
};
