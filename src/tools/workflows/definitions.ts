/**
 * Manual-mode `workflow_run` contracts — Phase 1 Group 10 / Phase 2 15.2.
 *
 * Each entry implements plan §4.4: the MCP server provides *structure*
 * (purpose / inputRequired / steps / outputSchema / qualityChecklist /
 * nextRecommendedCalls) and the calling agent supplies the reasoning.
 *
 * **Group 15.2 single source of truth:** the `outputSchema` field is
 * derived from the Zod schemas in `src/llm/workflows/_schemas.ts` via
 * `zodToJsonSchema`. The exact same Zod instance is what
 * `runAgentWorkflow` validates the provider's structured response
 * against, so manual-mode callers and agent-mode callers can never
 * drift apart.
 *
 * Why TS objects for the prose blocks: the §4.4 contract response is
 * JSON, not prose. Authoring it in markdown would require either a
 * lossy parser or a frontmatter convention that re-implements TS
 * object literal syntax. Group 10.4's prompt-loader pattern still
 * applies for the LLM system prompts (`src/llm/workflows/<name>.ts`),
 * which is where free-form prose lives.
 */

import type { JSONSchema7 } from "json-schema";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  WORKFLOW_OUTPUT_SCHEMAS,
  analyzeOutputSchema,
  buildContextPackOutputSchema,
  compileSkillOutputSchema,
  detectDuplicatesOutputSchema,
  generateReleaseSummaryOutputSchema,
  ingestPlanOutputSchema,
  narrateAbandonmentOutputSchema,
  planOutputSchema,
  processThoughtOutputSchema,
  recordDecisionOutputSchema,
  reviewOutputSchema,
  reviewTaskQualityOutputSchema,
  splitPlanOutputSchema,
  summarizeLessonsOutputSchema,
} from "../../llm/workflows/_schemas.js";

export type WorkflowName =
  | "plan"
  | "analyze"
  | "review"
  | "split_plan"
  | "process_thought"
  | "record_decision"
  | "review_task_quality"
  | "build_context_pack"
  | "summarize_lessons"
  | "detect_duplicates"
  | "generate_release_summary"
  | "ingest_plan"
  | "narrate_abandonment"
  | "compile_skill";

export const WORKFLOW_NAMES: readonly WorkflowName[] = [
  "plan",
  "analyze",
  "review",
  "split_plan",
  "process_thought",
  "record_decision",
  "review_task_quality",
  "build_context_pack",
  "summarize_lessons",
  "detect_duplicates",
  "generate_release_summary",
  "ingest_plan",
  "narrate_abandonment",
  "compile_skill",
] as const;

export interface WorkflowDefinition {
  /** One-sentence justification for the workflow. */
  purpose: string;
  /** Tool calls the agent should make to gather context. */
  inputRequired: string[];
  /** Ordered, human-readable steps. */
  steps: string[];
  /** JSON Schema the agent's final output must conform to. */
  outputSchema: JSONSchema7;
  /** Self-review questions the agent should answer before declaring done. */
  qualityChecklist: string[];
  /** AgentFlow tool calls to make after the reasoning is complete. */
  nextRecommendedCalls: string[];
}

/**
 * Re-exported so external consumers (Group 16 HTTP routes, etc.) can
 * grab the Zod schema directly without round-tripping through JSON
 * Schema. Same instance Group 15's runner uses.
 */
export { WORKFLOW_OUTPUT_SCHEMAS };

/**
 * Convert a Zod schema to JSON Schema for the manual-mode contract.
 * `$refStrategy: "none"` inlines every nested object so the response
 * is self-contained; we strip the `$schema` annotation so the payload
 * stays compact (consumers compile under any JSON Schema dialect they
 * already use — `tests/unit/workflows.test.ts` compiles under ajv
 * draft-07 by default, which matches the Zod converter's default).
 */
function toJsonSchema(schema: z.ZodTypeAny): JSONSchema7 {
  const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as Record<string, unknown>;
  delete json.$schema;
  return json as JSONSchema7;
}

const PLAN: WorkflowDefinition = {
  purpose: "Turn a short idea into a structured plan an agent can decompose into tasks.",
  inputRequired: [
    "project_view(action='get', projectId=<id>)",
    "context_get(type='project_summary', projectId=<id>)",
  ],
  steps: [
    "1. State the problem in one sentence.",
    "2. Sketch the desired outcome — what 'done' looks like.",
    "3. Identify constraints (deadlines, infra, dependencies).",
    "4. Outline 3–7 high-level milestones in dependency order.",
    "5. Flag the open questions the planner cannot yet answer.",
  ],
  outputSchema: toJsonSchema(planOutputSchema),
  qualityChecklist: [
    "Does every milestone map to a verifiable outcome?",
    "Are the dependencies between milestones explicit?",
    "Do the open questions name the missing facts, not just topics?",
  ],
  nextRecommendedCalls: [
    "workflow_run(workflow='split_plan')  // turn milestones into tasks",
    "task_edit(action='create', ...)       // apply directly without LLM",
  ],
};

const ANALYZE: WorkflowDefinition = {
  purpose:
    "Convert a draft plan into a technical analysis: pick an approach and weigh it against alternatives.",
  inputRequired: [
    "workflow_run(workflow='plan') output (or equivalent project notes)",
    "context_get(type='implementation_context', projectId=<id>)",
  ],
  steps: [
    "1. Restate the problem and the constraints in your own words.",
    "2. Propose 2–3 distinct technical approaches.",
    "3. For each, list the main trade-offs (complexity / risk / cost).",
    "4. Pick one and state why; call out the assumptions you are accepting.",
    "5. Identify the riskiest decision and what would falsify it.",
  ],
  outputSchema: toJsonSchema(analyzeOutputSchema),
  qualityChecklist: [
    "Did you rule out at least one approach instead of dismissing it implicitly?",
    "Does the rationale name a concrete failure mode the chosen approach avoids?",
    "Is the riskiest assumption something you could verify in a day?",
  ],
  nextRecommendedCalls: [
    "workflow_run(workflow='review')        // critique this analysis",
    "workflow_run(workflow='split_plan')    // convert into tasks once approved",
  ],
};

const REVIEW: WorkflowDefinition = {
  purpose: "Critique an existing plan or analysis and surface gaps before tasks are created.",
  inputRequired: [
    "workflow_run(workflow='plan'|'analyze') output to critique",
    "context_get(type='similar_tasks', projectId=<id>)",
  ],
  steps: [
    "1. Restate the artefact's central claim in one sentence.",
    "2. List 3–5 specific weaknesses — be concrete, not aesthetic.",
    "3. For each weakness, propose a minimal correction.",
    "4. Score readiness: ready | revise | reject.",
    "5. If revising, list the exact edits the original author should make.",
  ],
  outputSchema: toJsonSchema(reviewOutputSchema),
  qualityChecklist: [
    "Is every weakness backed by a concrete example, not vibe?",
    "Could the original author act on each correction without asking you?",
    "Does 'ready' truly mean ready, or are you avoiding pushback?",
  ],
  nextRecommendedCalls: [
    "task_edit(action='update', ...)        // apply the corrections",
    "workflow_run(workflow='split_plan')    // proceed once readiness=ready",
  ],
};

const SPLIT_PLAN: WorkflowDefinition = {
  purpose:
    "Propose a decomposition of a plan into atomic tasks. The agent must call `task_edit(action='create')` to apply — workflow_run never mutates state.",
  inputRequired: [
    "workflow_run(workflow='plan'|'review') output",
    "task_view(action='list', projectId=<id>, status='all')  // avoid duplicating existing tasks",
  ],
  steps: [
    "1. Restate the plan milestones.",
    "2. For each milestone, list 1–5 atomic tasks (each ≤1 day of work).",
    "3. Mark dependencies between proposed tasks by their proposal index.",
    "4. Assign a priority (critical|high|medium|low) to each.",
    "5. Sanity-check: every milestone has at least one verifiable task.",
  ],
  outputSchema: toJsonSchema(splitPlanOutputSchema),
  qualityChecklist: [
    "Is every task individually verifiable?",
    "Do dependency edges form a DAG (no cycles)?",
    "Did you check against existing tasks to avoid duplicates?",
  ],
  nextRecommendedCalls: ["task_edit(action='create', ...)  // apply each proposed task explicitly"],
};

const PROCESS_THOUGHT: WorkflowDefinition = {
  purpose:
    "Capture a single reasoning step in a chain-of-thought log. Useful when the agent wants to externalise an in-progress hypothesis without yet acting.",
  inputRequired: ["Optional: workflow_run(workflow='analyze') output for context"],
  steps: [
    "1. State the current hypothesis or question.",
    "2. Note what evidence supports it.",
    "3. Note what would refute it.",
    "4. State the next action you'd take.",
  ],
  outputSchema: toJsonSchema(processThoughtOutputSchema),
  qualityChecklist: [
    "Is the hypothesis falsifiable?",
    "Does the next action move you closer to confirming or refuting it?",
  ],
  nextRecommendedCalls: ["artifact_record(kind='finding', type='thought', content=<thought>)"],
};

const RECORD_DECISION: WorkflowDefinition = {
  purpose:
    "Document an architectural or product decision with rationale and rejected alternatives.",
  inputRequired: [
    "task_view(action='get', taskId=<id>)  // the task the decision applies to",
    "context_get(type='decisions', projectId=<id>)",
  ],
  steps: [
    "1. State the decision in one sentence ('we will …').",
    "2. State the context that forced the decision.",
    "3. List the alternatives considered and why each was rejected.",
    "4. State the consequences — what becomes harder/easier because of this.",
    "5. Identify when the decision should be revisited.",
  ],
  outputSchema: toJsonSchema(recordDecisionOutputSchema),
  qualityChecklist: [
    "Could a teammate joining next month understand why this was chosen?",
    "Is the trigger for revisiting concrete (date, metric, event) rather than 'someday'?",
  ],
  nextRecommendedCalls: ["artifact_record(kind='finding', type='decision', content=<decision>)"],
};

const REVIEW_TASK_QUALITY: WorkflowDefinition = {
  purpose: "Decide whether a task is ready for execution or needs more definition.",
  inputRequired: [
    "task_view(action='get', taskId=<id>)",
    "task_view(action='list', projectId=<id>, status='all')  // for dependency check",
    "context_get(type='similar_tasks', taskId=<id>)",
  ],
  steps: [
    "1. Read the task fields from task_view(action='get').",
    "2. Check whether Description, Problem Statement, and Verification Criteria are present and clear.",
    "3. Check whether all dependencies are in status='completed'.",
    "4. Estimate task size — flag if >1 day of work or touches >5 files.",
    "5. Decide verdict: ready | unclear | too_large | blocked.",
    "6. If unclear or too_large, propose specific changes.",
  ],
  outputSchema: toJsonSchema(reviewTaskQualityOutputSchema),
  qualityChecklist: [
    "Is the Verification Criteria specific enough that I'd know when the task is done?",
    "Are there hidden dependencies (env, infra, external services) not listed?",
    "Could this task be split into 2–3 smaller tasks with clearer outcomes?",
  ],
  nextRecommendedCalls: [
    "If verdict='ready': task_lifecycle(action='start')",
    "If verdict='unclear' or 'too_large': task_edit(action='update', ...) with the proposed changes",
    "If verdict='blocked': task_lifecycle(action='block', reason=<blocker>)",
  ],
};

const BUILD_CONTEXT_PACK: WorkflowDefinition = {
  purpose:
    "Assemble a focused context bundle (≤ token budget) the agent can pass into the next reasoning step.",
  inputRequired: [
    "task_view(action='get', taskId=<id>)",
    "context_get(type='implementation_context', taskId=<id>)",
    "context_get(type='findings', taskId=<id>)",
  ],
  steps: [
    "1. Decide the consumer of this pack (which workflow / which agent).",
    "2. Pull only the fields that will materially change the consumer's output.",
    "3. Drop chatty preambles, repeated boilerplate, and stale findings.",
    "4. Cap the result at the token budget; truncate long fields head/tail.",
  ],
  outputSchema: toJsonSchema(buildContextPackOutputSchema),
  qualityChecklist: [
    "Would a fresh agent be able to act on this without follow-up reads?",
    "Did you cite the source of every section (findingId / taskId / step)?",
  ],
  nextRecommendedCalls: ["// pass the returned pack as input to the next workflow_run call"],
};

const SUMMARIZE_LESSONS: WorkflowDefinition = {
  purpose: "Roll up recent findings into a project-level lesson summary that survives task churn.",
  inputRequired: [
    "context_get(type='lessons', projectId=<id>)",
    "context_get(type='findings', projectId=<id>)",
  ],
  steps: [
    "1. Cluster recent findings by topic.",
    "2. For each cluster, extract the recurring observation (≥ 2 supporting findings).",
    "3. Phrase it as a forward-looking lesson ('next time, …').",
    "4. List the source findingIds so the lesson is auditable.",
  ],
  outputSchema: toJsonSchema(summarizeLessonsOutputSchema),
  qualityChecklist: [
    "Does each lesson aggregate ≥2 findings, not just rephrase one?",
    "Is the lesson actionable in a future task — not folkloric advice?",
  ],
  nextRecommendedCalls: ["// after review, persist via the model layer createLessonSummary"],
};

const DETECT_DUPLICATES: WorkflowDefinition = {
  purpose: "Find candidate-duplicate tasks within a project before splitting/creating new ones.",
  inputRequired: ["task_view(action='list', projectId=<id>, status='all')"],
  steps: [
    "1. Read the task list.",
    "2. Group tasks whose names or descriptions overlap substantially.",
    "3. For each group, propose: merge / keep_distinct / mark_subtask.",
    "4. Cite the specific overlap (shared verb, shared file, shared output).",
  ],
  outputSchema: toJsonSchema(detectDuplicatesOutputSchema),
  qualityChecklist: [
    "Did you compare descriptions, not just names?",
    "Is 'merge' justified by overlap in *outcome*, not just keywords?",
  ],
  nextRecommendedCalls: ["task_edit(action='merge', taskIds=[...], expectedVersions={...})"],
};

const GENERATE_RELEASE_SUMMARY: WorkflowDefinition = {
  purpose:
    "Compose a human-readable release summary from the project's completed tasks and recorded artifacts.",
  inputRequired: [
    "task_view(action='by_status', projectId=<id>, status='Completed')",
    "context_get(type='findings', projectId=<id>)",
  ],
  steps: [
    "1. Gather completed tasks since the last release.",
    "2. Group by theme (feature / fix / chore / docs).",
    "3. For each, write a one-line user-facing summary.",
    "4. List notable PRs / commits from artifact_record(kind='commit'|'pull_request').",
    "5. Call out any breaking changes or migration steps.",
  ],
  outputSchema: toJsonSchema(generateReleaseSummaryOutputSchema),
  qualityChecklist: [
    "Would a user without project context understand each highlight?",
    "Are breaking changes called out *first*, not buried?",
  ],
  nextRecommendedCalls: [
    "artifact_record(kind='reference', taskId=<release_task>, url=<release_url>)",
  ],
};

const INGEST_PLAN: WorkflowDefinition = {
  purpose:
    "Parse an uploaded markdown plan into a Feature → Group → Task hierarchy the server can ingest. Used internally by POST /api/plan/upload/preview — not typically invoked directly by agents.",
  inputRequired: [
    "planMarkdown: the raw markdown body uploaded by the user",
    "projectName: the destination project's name (for context)",
  ],
  steps: [
    "1. Identify a document title / `# Feature: <name>` → `feature` { name, description } (null if absent).",
    "2. Map each `##`/`###` section → an entry in `groups[]`, in document order (a section-less plan → a single group).",
    "3. Map the steps/bullets under a section → entries in `tasks[]`, each with groupIndex into groups[] (no subtask nesting; parentIndex is retired).",
    "4. Decompose coarse sections into right-sized (~½–1 day) tasks within the same group; never split an already-atomic item or pad with work the plan omits.",
    "5. Set dependsOnIndexes to earlier tasks that must finish first — genuine prerequisites only; independent tasks get [].",
  ],
  outputSchema: toJsonSchema(ingestPlanOutputSchema),
  qualityChecklist: [
    "Were coarse sections decomposed into right-sized tasks (not one giant task, not over-split)?",
    "Does every task have a concrete name, description, and verificationCriteria?",
    "Does every task have a valid groupIndex, and do all dependsOnIndexes point at earlier tasks?",
  ],
  nextRecommendedCalls: [
    "// internal: handler stores result in preview cache then issues task_edit(action='create') in a transaction",
  ],
};

const NARRATE_ABANDONMENT: WorkflowDefinition = {
  purpose:
    "Produce a one-paragraph audit note (≤120 words) when a task is released or its claim expires. Appended to task.notes to replace the templated `[released …]` / `[abandoned …]` tag.",
  inputRequired: [
    "taskName, trigger ('released'|'expired'), heldBy",
    "lastFindings (up to 5 most recent)",
    "notesTail (~500 chars from task.notes)",
  ],
  steps: [
    "1. Read the trigger + holder identity.",
    "2. Summarise what was attempted (from findings + notes tail).",
    "3. Name the unfinished work in one sentence.",
    "4. State the next agent's starting point.",
  ],
  outputSchema: toJsonSchema(narrateAbandonmentOutputSchema),
  qualityChecklist: [
    "Is the note past-tense and factual (no speculation)?",
    "Did you keep the body ≤120 words?",
    "Does the next agent have a clear pickup point?",
  ],
  nextRecommendedCalls: [
    "// internal: lifecycle handler appends `summary` to task.notes via task_edit(append_note)",
  ],
};

const COMPILE_SKILL: WorkflowDefinition = {
  purpose:
    "Roll up a project's completed-task lessons + decisions into a forward-looking Skill document keyed by topic.",
  inputRequired: [
    "projectName",
    "clusters: lexically-pre-grouped lessons/decisions/findings (≥2 items each)",
    "priorSummary (optional): the previous compile result to avoid restating identical rules",
  ],
  steps: [
    "1. For each cluster, identify the recurring theme → `topic`.",
    "2. Distil 1–5 actionable rules per topic in second-person ('When X, do Y…').",
    "3. Carry the source findingIds verbatim for the audit trail.",
    "4. Emit frontmatter with project name + ISO compile timestamp.",
  ],
  outputSchema: toJsonSchema(compileSkillOutputSchema),
  qualityChecklist: [
    "Is every rule grounded in ≥2 source items from its cluster?",
    "Did you avoid inventing rules outside the supplied evidence?",
    "Are rules forward-looking and actionable, not folkloric?",
  ],
  nextRecommendedCalls: [
    "// internal: skillModel.upsertSkill persists `body`; topics >150 lines fan out to project_skill_references",
  ],
};

export const WORKFLOW_DEFINITIONS: Readonly<Record<WorkflowName, WorkflowDefinition>> =
  Object.freeze({
    plan: PLAN,
    analyze: ANALYZE,
    review: REVIEW,
    split_plan: SPLIT_PLAN,
    process_thought: PROCESS_THOUGHT,
    record_decision: RECORD_DECISION,
    review_task_quality: REVIEW_TASK_QUALITY,
    build_context_pack: BUILD_CONTEXT_PACK,
    summarize_lessons: SUMMARIZE_LESSONS,
    detect_duplicates: DETECT_DUPLICATES,
    generate_release_summary: GENERATE_RELEASE_SUMMARY,
    ingest_plan: INGEST_PLAN,
    narrate_abandonment: NARRATE_ABANDONMENT,
    compile_skill: COMPILE_SKILL,
  });
