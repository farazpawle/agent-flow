/**
 * Public surface of the Phase-2 Group 15 agent-mode workflow layer.
 *
 * Consumers:
 *   - `src/tools/workflows/workflowRun.ts` — uses
 *     `WORKFLOW_MODULES[name]` + `runAgentWorkflow` when
 *     `WORKFLOW_MODE=agent`.
 *   - `src/tools/workflows/definitions.ts` — re-uses each module's
 *     `outputSchema` (Zod) via `WORKFLOW_OUTPUT_SCHEMAS` and converts
 *     to JSON Schema for the manual-mode `outputSchema` field. This is
 *     the "single source of truth" hand-off plan 15.2 requires.
 */

import type { WorkflowName } from "../../tools/workflows/definitions.js";
import type { WorkflowModule } from "./types.js";

import { planWorkflow } from "./plan.js";
import { analyzeWorkflow } from "./analyze.js";
import { reviewWorkflow } from "./review.js";
import { splitPlanWorkflow } from "./splitPlan.js";
import { processThoughtWorkflow } from "./processThought.js";
import { recordDecisionWorkflow } from "./recordDecision.js";
import { reviewTaskQualityWorkflow } from "./reviewTaskQuality.js";
import { buildContextPackWorkflow } from "./buildContextPack.js";
import { summarizeLessonsWorkflow } from "./summarizeLessons.js";
import { detectDuplicatesWorkflow } from "./detectDuplicates.js";
import { generateReleaseSummaryWorkflow } from "./generateReleaseSummary.js";
import { ingestPlanWorkflow } from "./ingestPlan.js";
import { narrateAbandonmentWorkflow } from "./narrateAbandonment.js";
import { compileSkillWorkflow } from "./compileSkill.js";

export const WORKFLOW_MODULES: Readonly<Record<WorkflowName, WorkflowModule>> = Object.freeze({
  plan: planWorkflow,
  analyze: analyzeWorkflow,
  review: reviewWorkflow,
  split_plan: splitPlanWorkflow,
  process_thought: processThoughtWorkflow,
  record_decision: recordDecisionWorkflow,
  review_task_quality: reviewTaskQualityWorkflow,
  build_context_pack: buildContextPackWorkflow,
  summarize_lessons: summarizeLessonsWorkflow,
  detect_duplicates: detectDuplicatesWorkflow,
  generate_release_summary: generateReleaseSummaryWorkflow,
  ingest_plan: ingestPlanWorkflow,
  narrate_abandonment: narrateAbandonmentWorkflow,
  compile_skill: compileSkillWorkflow,
});

export { WORKFLOW_OUTPUT_SCHEMAS } from "./_schemas.js";
export type { WorkflowModule } from "./types.js";

export {
  runAgentWorkflow,
  WorkflowQuotaError,
  TOKEN_BUDGET_EXCEEDED_CODE,
  QUOTA_EXCEEDED_CODE,
  type RunAgentWorkflowOptions,
  type RunAgentWorkflowResult,
} from "./runner.js";
