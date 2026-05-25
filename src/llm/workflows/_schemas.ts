/**
 * Workflow output schemas — Phase 2 Group 15.1 / 15.2.
 *
 * Single source of truth: every workflow's output is defined here as a
 * Zod schema. The two consumers are:
 *
 *   1. `src/tools/workflows/definitions.ts` — converts each schema to
 *      JSON Schema via `zod-to-json-schema` and ships it in the
 *      manual-mode `outputSchema` field (plan §4.4).
 *   2. `src/llm/workflows/<name>.ts` — passes the same Zod schema to
 *      `LlmProvider.generateObject({ schema })` (or a `generateText`
 *      + safeParse fallback) so the agent-mode response is validated
 *      against exactly the contract the manual mode advertised.
 *
 * Strict vs lax: schemas use Zod default `.object()` (additionalProperties
 * = false in the emitted JSON Schema). Tightening here improves
 * LLM-output safety — the model can't sneak in fields the agent isn't
 * expecting. The Phase-1 manual-mode contract was lax (no
 * additionalProperties), but no downstream consumer relied on extra
 * fields, so this is a safe sharpening.
 */

import { z } from "zod";

// ────────────────────────────────────────────────────────────────────────
// plan
// ────────────────────────────────────────────────────────────────────────

export const planOutputSchema = z.object({
  problem: z.string().min(20),
  outcome: z.string().min(20),
  constraints: z.array(z.string()).optional(),
  milestones: z
    .array(
      z.object({
        name: z.string().min(3),
        rationale: z.string().min(10),
        dependsOn: z.array(z.string()).optional(),
      })
    )
    .min(1),
  openQuestions: z.array(z.string()).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// analyze
// ────────────────────────────────────────────────────────────────────────

export const analyzeOutputSchema = z.object({
  chosenApproach: z.object({
    name: z.string().min(3),
    rationale: z.string().min(20),
  }),
  alternatives: z
    .array(
      z.object({
        name: z.string(),
        tradeoff: z.string().min(10),
      })
    )
    .min(1),
  riskiestAssumption: z.string().min(20),
  falsificationTest: z.string().optional(),
});

// ────────────────────────────────────────────────────────────────────────
// review
// ────────────────────────────────────────────────────────────────────────

export const reviewOutputSchema = z.object({
  readiness: z.enum(["ready", "revise", "reject"]),
  weaknesses: z
    .array(
      z.object({
        issue: z.string().min(10),
        correction: z.string().min(10),
        severity: z.enum(["low", "med", "high"]).optional(),
      })
    )
    .min(1),
  requiredEdits: z.array(z.string()).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// split_plan
// ────────────────────────────────────────────────────────────────────────

export const splitPlanOutputSchema = z.object({
  tasks: z
    .array(
      z.object({
        name: z.string().min(3),
        description: z.string().min(10),
        priority: z.enum(["critical", "high", "medium", "low"]).optional(),
        verificationCriteria: z.string().optional(),
        dependsOnIndex: z.array(z.number().int().min(0)).optional(),
      })
    )
    .min(1),
  notes: z.string().optional(),
});

// ────────────────────────────────────────────────────────────────────────
// process_thought
// ────────────────────────────────────────────────────────────────────────

export const processThoughtOutputSchema = z.object({
  hypothesis: z.string().min(10),
  supporting: z.array(z.string()).optional(),
  refuting: z.array(z.string()).optional(),
  nextAction: z.string().min(10),
});

// ────────────────────────────────────────────────────────────────────────
// record_decision
// ────────────────────────────────────────────────────────────────────────

export const recordDecisionOutputSchema = z.object({
  decision: z.string().min(10),
  context: z.string().min(20),
  alternatives: z
    .array(
      z.object({
        name: z.string(),
        rejectedBecause: z.string().min(10),
      })
    )
    .optional(),
  consequences: z.string().min(20),
  revisitWhen: z.string().optional(),
});

// ────────────────────────────────────────────────────────────────────────
// review_task_quality
// ────────────────────────────────────────────────────────────────────────

export const reviewTaskQualityOutputSchema = z.object({
  verdict: z.enum(["ready", "unclear", "too_large", "blocked"]),
  reasoning: z.string().min(20),
  proposedChanges: z.string().optional(),
  blockingDependencies: z.array(z.string()).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// build_context_pack
// ────────────────────────────────────────────────────────────────────────

export const buildContextPackOutputSchema = z.object({
  consumer: z.string().min(3),
  sections: z
    .array(
      z.object({
        title: z.string(),
        content: z.string().min(1),
        truncated: z.boolean().optional(),
      })
    )
    .min(1),
  approxTokens: z.number().int().min(0).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// summarize_lessons
// ────────────────────────────────────────────────────────────────────────

export const summarizeLessonsOutputSchema = z.object({
  lessons: z
    .array(
      z.object({
        topic: z.string().min(3),
        lesson: z.string().min(20),
        sourceFindingIds: z.array(z.string()).min(1),
      })
    )
    .min(1),
});

// ────────────────────────────────────────────────────────────────────────
// detect_duplicates
// ────────────────────────────────────────────────────────────────────────

export const detectDuplicatesOutputSchema = z.object({
  candidates: z.array(
    z.object({
      taskIds: z.array(z.string()).min(2),
      proposal: z.enum(["merge", "keep_distinct", "mark_subtask"]),
      reason: z.string().min(10),
    })
  ),
});

// ────────────────────────────────────────────────────────────────────────
// generate_release_summary
// ────────────────────────────────────────────────────────────────────────

export const generateReleaseSummaryOutputSchema = z.object({
  version: z.string().min(1),
  highlights: z
    .array(
      z.object({
        theme: z.enum(["feature", "fix", "chore", "docs", "perf", "security"]),
        summary: z.string().min(10),
        relatedTaskIds: z.array(z.string()).optional(),
      })
    )
    .min(1),
  breakingChanges: z.array(z.string()).optional(),
  artifactRefs: z.array(z.string()).optional(),
});

// ────────────────────────────────────────────────────────────────────────
// Registry — name → schema (used by both manual-mode contract builder
// and agent-mode runner). Frozen so callers don't mutate it.
// ────────────────────────────────────────────────────────────────────────

import type { WorkflowName } from "../../tools/workflows/definitions.js";

export const WORKFLOW_OUTPUT_SCHEMAS: Readonly<Record<WorkflowName, z.ZodTypeAny>> = Object.freeze({
  plan: planOutputSchema,
  analyze: analyzeOutputSchema,
  review: reviewOutputSchema,
  split_plan: splitPlanOutputSchema,
  process_thought: processThoughtOutputSchema,
  record_decision: recordDecisionOutputSchema,
  review_task_quality: reviewTaskQualityOutputSchema,
  build_context_pack: buildContextPackOutputSchema,
  summarize_lessons: summarizeLessonsOutputSchema,
  detect_duplicates: detectDuplicatesOutputSchema,
  generate_release_summary: generateReleaseSummaryOutputSchema,
});
