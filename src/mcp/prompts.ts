/**
 * MCP Prompts surface (Phase 3 Group 19.3).
 *
 * Re-exposes the three "structure" workflows (`plan`, `analyze`,
 * `review`) as MCP Prompts. Each prompt is a thin wrapper around
 * `workflow_run({workflow: <name>, mode: 'manual'})` — the same
 * structured contract the tool returns is delivered here as a
 * `GetPromptResult` message body.
 *
 * Other workflows (split_plan, summarize_lessons, etc.) stay on the
 * tools surface because they are programmatic actions, not "prompts"
 * the user picks from a list.
 *
 * **Why limit prompts to plan/analyze/review:** these three are the
 * stages a human/agent typically picks from a drop-down — "I want to
 * plan / analyse / review this." The rest (build_context_pack,
 * detect_duplicates, etc.) are mid-workflow utilities the agent
 * invokes from inside an existing task. Surfacing them as prompts
 * would clutter the UI.
 */

import { workflowRun } from "../tools/workflows/index.js";

/**
 * Prompts exposed via MCP. Every prompt routes to `workflow_run` with
 * `mode='manual'` so the calling agent always gets the structured
 * §4.4 contract — even when a provider is configured. Clients that
 * want LLM-driven prompts call the tool directly with `mode='agent'`.
 */
const PROMPT_NAMES = ["plan", "analyze", "review"] as const;
export type PromptName = (typeof PROMPT_NAMES)[number];

interface PromptDescriptor {
  name: PromptName;
  description: string;
  arguments: Array<{ name: string; description: string; required?: boolean }>;
  /** Workflow name passed to `workflow_run`. Identity for the prompt set. */
  workflow: PromptName;
}

const PROMPT_DESCRIPTORS: Record<PromptName, PromptDescriptor> = {
  plan: {
    name: "plan",
    description:
      "Turn a short idea into a structured plan an agent can decompose into tasks. Returns the §4.4 contract with required problem/outcome/milestones output schema.",
    arguments: [
      { name: "idea", description: "The idea or feature to plan.", required: false },
      {
        name: "projectId",
        description: "Project context for the plan (optional).",
        required: false,
      },
      {
        name: "projectSummary",
        description: "Existing project summary to anchor the plan against (optional).",
        required: false,
      },
    ],
    workflow: "plan",
  },
  analyze: {
    name: "analyze",
    description:
      "Convert a draft plan into a technical analysis: pick an approach and weigh it against alternatives.",
    arguments: [
      { name: "plan", description: "Plan text or plan output JSON to analyse.", required: false },
      {
        name: "implementationContext",
        description: "Existing implementation notes to consider (optional).",
        required: false,
      },
      { name: "projectId", description: "Project context (optional).", required: false },
    ],
    workflow: "analyze",
  },
  review: {
    name: "review",
    description:
      "Critique an existing plan or analysis and surface gaps before tasks are created. Returns a readiness verdict plus concrete weaknesses + corrections.",
    arguments: [
      { name: "artefact", description: "The plan or analysis to critique.", required: false },
      {
        name: "similarTasks",
        description: "Related prior tasks for context (optional).",
        required: false,
      },
      { name: "projectId", description: "Project context (optional).", required: false },
    ],
    workflow: "review",
  },
};

export interface PromptListEntry {
  name: PromptName;
  description: string;
  arguments: PromptDescriptor["arguments"];
}

export interface GetPromptResponse {
  description: string;
  messages: Array<{
    role: "user";
    content: { type: "text"; text: string };
  }>;
}

/**
 * `prompts/list` — return every prompt with its argument schema. The
 * schema tells the client what fields to collect from the user before
 * calling `prompts/get`.
 */
export function listPrompts(): PromptListEntry[] {
  return PROMPT_NAMES.map((name) => ({
    name,
    description: PROMPT_DESCRIPTORS[name].description,
    arguments: PROMPT_DESCRIPTORS[name].arguments,
  }));
}

export class UnknownPromptError extends Error {
  readonly status = 404;
  constructor(name: string) {
    super(
      `Unknown prompt '${name}'. Allowed: ${PROMPT_NAMES.join(", ")}. Other workflows live under the tools surface (workflow_run).`
    );
  }
}

function isPromptName(value: string): value is PromptName {
  return (PROMPT_NAMES as readonly string[]).includes(value);
}

/**
 * `prompts/get` — package the manual-mode workflow contract as a
 * single user-role message. The agent reads the JSON, fills in the
 * fields the schema demands, and replies. Same contract the tool
 * surface returns; the only difference is the transport.
 */
export async function getPrompt(
  name: string,
  args: Record<string, string> | undefined
): Promise<GetPromptResponse> {
  if (!isPromptName(name)) throw new UnknownPromptError(name);
  const descriptor = PROMPT_DESCRIPTORS[name];

  // Route through workflow_run in manual mode — same handler the
  // tool surface exposes. Argument values come in as strings (MCP
  // GetPromptRequest restricts arguments to `Record<string,string>`),
  // so we pass them through as the workflow_run `inputs` payload.
  const result = await workflowRun({
    workflow: descriptor.workflow,
    mode: "manual",
    inputs: args && Object.keys(args).length > 0 ? args : undefined,
  });

  const text = result.content?.[0]?.text ?? "{}";
  return {
    description: descriptor.description,
    messages: [
      {
        role: "user",
        content: { type: "text", text },
      },
    ],
  };
}

export { PROMPT_NAMES };
