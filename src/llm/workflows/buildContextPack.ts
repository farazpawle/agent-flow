/**
 * `build_context_pack` workflow — assemble a focused context bundle.
 */

import { buildContextPackOutputSchema } from "./_schemas.js";
import type { WorkflowModule } from "./types.js";

function renderPrompt(inputs: Record<string, unknown> | undefined): string {
  const consumer = (inputs?.consumer as string | undefined) ?? "(downstream workflow)";
  const task = (inputs?.task as string | undefined) ?? "";
  const implementationContext = (inputs?.implementationContext as string | undefined) ?? "";
  const findings = (inputs?.findings as string | undefined) ?? "";
  const budget = (inputs?.tokenBudget as number | undefined) ?? 2_000;

  const lines = [
    `Assemble a context pack for the consumer: ${consumer}.`,
    `Hard token budget: ${budget}.`,
  ];
  if (task) {
    lines.push("", "TASK:", task);
  }
  if (implementationContext) {
    lines.push("", "IMPLEMENTATION CONTEXT:", implementationContext);
  }
  if (findings) {
    lines.push("", "FINDINGS:", findings);
  }
  lines.push(
    "",
    "Return JSON matching the supplied schema.",
    "- Drop boilerplate; keep only what materially changes the consumer's output.",
    "- Mark sections truncated:true when you cut them; cite source IDs in the content."
  );
  return lines.join("\n");
}

export const buildContextPackWorkflow: WorkflowModule<typeof buildContextPackOutputSchema> = {
  name: "build_context_pack",
  systemPrompt:
    "You are AgentFlow's context-pack assembler. Pull only the fields that will materially change the consumer's output. Drop chatty preambles, repeated boilerplate, and stale findings. Cap the result at the supplied token budget.",
  userTemplate: renderPrompt,
  outputSchema: buildContextPackOutputSchema,
  inputTokenBudget: 8_000,
  maxOutputTokens: 2_500,
};
