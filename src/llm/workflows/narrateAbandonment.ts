/**
 * `narrate_abandonment` workflow (Wave 3 §10.F).
 *
 * Produces a one-paragraph human-readable note describing why an
 * in-flight task was abandoned (explicit `release` or claim expiry).
 * The lifecycle handler appends the returned `summary` to `task.notes`
 * — the templated fallback (`[released … by …]` / `[abandoned …, claim
 * expired]`) is used when the provider is unavailable or errors.
 *
 * Budget: tight on output (≤200 tokens) because the note lands in an
 * append-only audit trail and we don't want it dominating the field.
 */

import { narrateAbandonmentOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const taskName = (inputs?.taskName as string | undefined) ?? "(unnamed task)";
  const trigger = (inputs?.trigger as string | undefined) ?? "released";
  const heldBy = (inputs?.heldBy as string | undefined) ?? "(unknown)";
  const lastFindings = (inputs?.lastFindings as string | undefined) ?? "(none)";
  const notesTail = (inputs?.notesTail as string | undefined) ?? "(none)";
  const releaseNote = (inputs?.releaseNote as string | undefined) ?? "";

  const lines = [
    "Write a one-paragraph audit note (≤120 words) explaining why this task was left in an abandoned state.",
    "",
    `Task: ${taskName}`,
    `Trigger: ${trigger}`,
    `Holder before abandonment: ${heldBy}`,
    "",
    "Recent findings (most recent first, ≤5):",
    lastFindings,
    "",
    "Tail of task.notes (most recent ~500 chars):",
    notesTail,
  ];
  if (releaseNote) {
    lines.push("", "Holder's release reason:", releaseNote);
  }
  lines.push(
    "",
    "Write past-tense, factual, no speculation. State what was tried and what the next agent should pick up. Single paragraph.",
    "",
    "Return JSON matching the supplied schema."
  );
  return lines.join("\n");
}

export const narrateAbandonmentWorkflow: WorkflowModule<typeof narrateAbandonmentOutputSchema> = {
  name: "narrate_abandonment",
  systemPrompt:
    "You are AgentFlow's abandonment-narrator. Produce a single short audit paragraph summarising why a task was left mid-flight. No speculation, no advice, just a factual handoff note.",
  userTemplate: renderPrompt,
  outputSchema: narrateAbandonmentOutputSchema,
  inputTokenBudget: 4_000,
  maxOutputTokens: 200,
};
