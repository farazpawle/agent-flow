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
 * it maps that structure onto a flat, ordered task list and breaks coarse
 * sections into right-sized, individually-verifiable tasks.
 *
 * Hierarchy rules (matched by `ingestPlanOutputSchema` and re-checked in
 * the preview handler):
 *   - Section headings / top-level units of work → top-level tasks
 *     (`parentIndex` omitted/null).
 *   - Steps listed under a section → subtasks with `parentIndex` pointing
 *     at a top-level task earlier in the list (one level only — no
 *     grandchildren; deeper nesting is flattened up, never errored).
 *   - A document title / `# Feature: <name>` H1 → the optional group.
 *   - `dependsOnIndexes` lists the array indices of EARLIER tasks that must
 *     finish before this one can start (genuine prerequisites only).
 */

import { ingestPlanOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

/**
 * Compact, carefully-written few-shot example. It strongly steers the
 * model, so it deliberately demonstrates the desired behaviour — not just
 * the schema shape:
 *   - `# Feature:` → group; section headings → top-level tasks; bullets →
 *     one-level subtasks (parentIndex).
 *   - A coarse heading ("Add dark mode") is decomposed into a deliverable
 *     task + its concrete steps, while each already-atomic bullet maps to
 *     exactly ONE task (no over-splitting).
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
      group: { name: "User Settings", description: null },
      tasks: [
        {
          name: "Implement dark-mode theming",
          description:
            "Add a dark theme and let users switch to it, per the 'Add dark mode' section.",
          verificationCriteria: "The app renders in a dark palette when dark mode is active.",
          dependsOnIndexes: [],
          parentIndex: null,
        },
        {
          name: "Persist the user's theme choice",
          description: "Store the selected theme so it survives reloads and new sessions.",
          verificationCriteria: "Reloading the page keeps the previously selected theme.",
          dependsOnIndexes: [],
          parentIndex: 0,
        },
        {
          name: "Add a theme toggle to the settings page",
          description: "Add a control on the settings page that switches between light and dark.",
          verificationCriteria: "Toggling the control immediately switches the theme.",
          dependsOnIndexes: [1],
          parentIndex: 0,
        },
        {
          name: "Wire up logout",
          description: "Let signed-in users end their session from the header.",
          verificationCriteria: "Logging out clears the session and returns to the login screen.",
          dependsOnIndexes: [],
          parentIndex: null,
        },
        {
          name: "Add a logout button to the header",
          description: "Add a logout button to the global header that triggers sign-out.",
          verificationCriteria: "A logout button is visible in the header for signed-in users.",
          dependsOnIndexes: [],
          parentIndex: 3,
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
    "STRUCTURE — the plan may use any markdown (headings, `-`/`*` bullets, `1.` numbered lists, `- [ ]` checkboxes, or prose). Map it like this:",
    "- A document title or a `# Feature: <name>` / top-level H1 → the optional group { name, description }. If there is no such line, omit the group (null).",
    "- Each section heading (`##`/`###`) or top-level item that is a distinct deliverable → a top-level task (parentIndex = null).",
    "- Steps, bullets, or sentences listed under a section → subtasks of that section's task (parentIndex = the index of that section task earlier in tasks[]).",
    "- Keep nesting to ONE level: if the plan nests deeper, flatten the deepest items up into their nearest section task. Never emit a grandchild and never error — always produce tasks.",
    "",
    "DECOMPOSITION — produce ENOUGH tasks but NOT too many:",
    "- A coarse heading (e.g. 'Build auth') is not one task. Break it into the concrete steps the section actually describes (endpoint, validation, tests, docs, …). Aim for tasks an engineer can finish in roughly half a day to a day each.",
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
    "You are AgentFlow's plan-ingester. You read an author's freeform markdown plan — any mix of `#`/`##`/`###` headings, `-`/`*` bullets, `1.` numbered lists, `- [ ]` checkboxes, or prose — and convert it into a flat, ordered list of concrete, independently-executable tasks (with optional one-level subtasks). Decompose coarse sections into right-sized tasks an engineer can finish in roughly half a day to a day each, but never split an already-atomic item or pad with work the plan omits. Stay faithful to the author's intent, sequencing, and terminology; never invent scope the plan doesn't imply, and never drop scope it states.",
  userTemplate: renderPrompt,
  outputSchema: ingestPlanOutputSchema,
  inputTokenBudget: 20_000,
  maxOutputTokens: 8_000,
};
