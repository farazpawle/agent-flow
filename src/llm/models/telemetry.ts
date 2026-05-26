/**
 * LLM-call telemetry (Group 14.5).
 *
 * Records `{provider, model, selectionStrategy, modelListAge,
 * inputTokens, outputTokens, latencyMs, cost?}` for every
 * `workflow_run(mode=agent)` provider call. Group 15 invokes
 * `recordLlmCall` after each `generateText` / `generateObject`
 * returns, and on failure too (with `outcome=error` + `errorCode`).
 *
 * Persistence: writes a `workflow_steps` row via the active
 * `DatabaseAdapter`. The structured logger also emits a single
 * `kind: 'llm_call'` line so log-only observers can follow along
 * without DB inspection.
 *
 * Telemetry never throws — a recording failure must not break the
 * underlying call.
 */

import { v4 as uuidv4 } from "uuid";
import { childLogger, newCorrelationId } from "../../utils/logger.js";
import { dbFactory } from "../../models/dbFactory.js";
import type { WorkflowStep } from "../../models/workflowModel.js";
import type { ResolveModelResult } from "./registry.js";
import type { LlmUsage } from "../provider.js";
import type { SelectionStrategy } from "./selection.js";

const llmLog = childLogger({ component: "llm_telemetry" });

export interface LlmCallRecord {
  /** Tool that owned the call (typically `workflow_run`). */
  tool: string;
  workflow?: string;
  projectId?: string;
  correlationId?: string;
  provider: string;
  model: string;
  selectionStrategy: SelectionStrategy;
  modelListAge: number;
  usage?: LlmUsage;
  latencyMs: number;
  /** USD cost as reported by the provider. */
  cost?: number;
  outcome: "success" | "error";
  errorCode?: string;
}

/**
 * Persist + log a single LLM call. Calls flow through here from
 * Group 15's `workflow_run(mode=agent)` handler. All fields are
 * optional except `tool`, `provider`, `model`, `selectionStrategy`,
 * `modelListAge`, `latencyMs`, `outcome` — those are the columns the
 * plan §14.5 audit row requires.
 */
export async function recordLlmCall(record: LlmCallRecord): Promise<void> {
  const correlationId = record.correlationId ?? newCorrelationId();

  // 1. Always emit a structured log line. Cheap, never throws.
  try {
    llmLog.info({ kind: "llm_call", ...record, correlationId }, "llm call");
  } catch {
    // log path swallows everything — guard is just defence-in-depth
  }

  // 2. Persist to workflow_steps. Best-effort; swallow errors so the
  //    LLM call result isn't lost to a DB hiccup. The structured
  //    payload lives in `content` (JSON) so we don't need a schema
  //    change beyond the LLM_CALL stepType.
  try {
    const step: WorkflowStep = {
      id: uuidv4(),
      projectId: record.projectId ?? "(unscoped)",
      stepType: "LLM_CALL",
      content: JSON.stringify({
        workflow: record.workflow,
        provider: record.provider,
        model: record.model,
        selectionStrategy: record.selectionStrategy,
        modelListAge: record.modelListAge,
        cost: record.cost,
      }),
      createdAt: new Date(),
      toolName: record.tool,
      durationMs: record.latencyMs,
      inputTokens: record.usage?.inputTokens,
      outputTokens: record.usage?.outputTokens,
      outcome: record.outcome,
      errorCode: record.errorCode,
      correlationId,
    };
    await dbFactory.getDatabase().createWorkflowStep(step);
  } catch (err) {
    try {
      llmLog.warn(
        { err: (err as Error).message, correlationId },
        "Failed to persist llm_call workflow_step"
      );
    } catch {
      // last-ditch: nothing else to do
    }
  }
}

/**
 * Convenience wrapper: time a single provider call, then record the
 * result. Group 15 uses this so its handler body stays terse.
 */
export async function withLlmTelemetry<T>(
  meta: {
    tool: string;
    workflow?: string;
    projectId?: string;
    correlationId?: string;
    resolution: ResolveModelResult;
  },
  fn: () => Promise<{ result: T; usage?: LlmUsage; cost?: number }>
): Promise<T> {
  const startedAt = Date.now();
  try {
    const { result, usage, cost } = await fn();
    await recordLlmCall({
      tool: meta.tool,
      workflow: meta.workflow,
      projectId: meta.projectId,
      correlationId: meta.correlationId,
      provider: meta.resolution.provider,
      model: meta.resolution.model,
      selectionStrategy: meta.resolution.selectionStrategy,
      modelListAge: meta.resolution.modelListAge,
      usage,
      cost,
      latencyMs: Date.now() - startedAt,
      outcome: "success",
    });
    return result;
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: unknown }).code)
        : undefined;
    await recordLlmCall({
      tool: meta.tool,
      workflow: meta.workflow,
      projectId: meta.projectId,
      correlationId: meta.correlationId,
      provider: meta.resolution.provider,
      model: meta.resolution.model,
      selectionStrategy: meta.resolution.selectionStrategy,
      modelListAge: meta.resolution.modelListAge,
      latencyMs: Date.now() - startedAt,
      outcome: "error",
      errorCode: code,
    });
    throw err;
  }
}
