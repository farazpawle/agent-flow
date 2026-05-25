/**
 * `workflow_run` — Phase 1 Group 10 (manual mode) + Phase 2 Group 15
 * (agent mode).
 *
 * The MCP server returns *structure*; the calling agent supplies the
 * reasoning unless an LLM provider is configured. In `agent` mode the
 * server invokes `runAgentWorkflow` (Group 15) which validates the
 * provider response against the same Zod schema the manual contract
 * advertises.
 *
 * Mode resolution order (most specific wins):
 *   1. `input.mode`            — explicit per-call override
 *   2. `WORKFLOW_MODE` env     — process-level default
 *   3. fallback "manual"
 *
 * `WORKFLOW_MODE=disabled` returns a typed `WORKFLOW_DISABLED` payload
 * (NOT an error) so callers can short-circuit gracefully without
 * try/catching every workflow_run.
 *
 * **Fallback semantics (Group 15.7 + 15.3):**
 *   - `LLM_PROVIDER=none`        → manual payload + `agentFallback`.
 *   - `QUOTA_EXCEEDED`           → manual payload + `agentFallback`.
 *   - Token-budget exceeded      → manual payload + `agentFallback`.
 *   - Any other provider error   → bubble up as the tool error so the
 *     caller can decide whether to retry; we do NOT silently mask
 *     network / auth / parse failures.
 */

import { childLogger } from "../../utils/logger.js";
import { toAppError } from "../../utils/errors.js";
import { withToolTelemetry } from "../../utils/telemetry.js";
import { PROVIDER_NOT_CONFIGURED_CODE } from "../../llm/providers/none.js";
import {
  runAgentWorkflow,
  TOKEN_BUDGET_EXCEEDED_CODE,
  QUOTA_EXCEEDED_CODE,
  WORKFLOW_MODULES,
  WorkflowQuotaError,
} from "../../llm/workflows/index.js";
import { WORKFLOW_DEFINITIONS, type WorkflowDefinition, type WorkflowName } from "./definitions.js";
import type { WorkflowRunInput, WorkflowMode } from "./schemas.js";

const log = childLogger({ component: "workflow_run" });

function asToolText(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

/**
 * Resolve effective mode from per-call override, env, and default.
 * Exported so tests can drive the resolution without touching env.
 */
export function resolveWorkflowMode(
  perCall: WorkflowMode | undefined,
  envValue: string | undefined
): WorkflowMode {
  if (perCall) return perCall;
  const v = (envValue ?? "").toLowerCase();
  if (v === "agent" || v === "manual" || v === "disabled") return v as WorkflowMode;
  return "manual";
}

interface ManualResponse extends WorkflowDefinition {
  mode: "manual";
  workflow: WorkflowName;
  /** Echo of caller-supplied inputs so the agent can keep state. */
  inputs?: Record<string, unknown>;
}

function buildManualResponse(
  workflow: WorkflowName,
  inputs: Record<string, unknown> | undefined
): ManualResponse {
  const def = WORKFLOW_DEFINITIONS[workflow];
  return {
    mode: "manual",
    workflow,
    purpose: def.purpose,
    inputRequired: def.inputRequired,
    steps: def.steps,
    outputSchema: def.outputSchema,
    qualityChecklist: def.qualityChecklist,
    nextRecommendedCalls: def.nextRecommendedCalls,
    ...(inputs ? { inputs } : {}),
  };
}

function buildDisabledResponse(workflow: WorkflowName) {
  return {
    mode: "disabled" as const,
    code: "WORKFLOW_DISABLED" as const,
    workflow,
    message: "workflow_run is administratively disabled on this server (WORKFLOW_MODE=disabled).",
    hint: "Set WORKFLOW_MODE=manual to get structured guidance without an LLM key, or WORKFLOW_MODE=agent (provider configured) to invoke the LLM.",
  };
}

/**
 * Classify a provider/runner error into either:
 *   - "fallback"  → return the manual payload + `agentFallback` envelope
 *   - "propagate" → throw so MCP returns a tool error
 *
 * Fallback covers the documented graceful-degradation paths (Group
 * 15.7 quota; 15.5 token budget; 15.3 provider-not-configured); every
 * other code surfaces verbatim so users see real failures instead of
 * silently masked ones.
 */
function classifyAgentFailure(
  err: unknown
): { kind: "fallback"; reason: string; note: string } | { kind: "propagate" } {
  if (err instanceof WorkflowQuotaError) {
    return {
      kind: "fallback",
      reason: QUOTA_EXCEEDED_CODE,
      note: "Provider returned a quota error. Returning the manual contract so the calling agent can proceed without an LLM round-trip.",
    };
  }
  const appErr = toAppError(err);
  const detailsCode =
    appErr.details && typeof appErr.details === "object" && "code" in appErr.details
      ? String((appErr.details as Record<string, unknown>).code ?? "")
      : "";

  if (detailsCode === PROVIDER_NOT_CONFIGURED_CODE) {
    return {
      kind: "fallback",
      reason: PROVIDER_NOT_CONFIGURED_CODE,
      note: "No LLM provider is configured (LLM_PROVIDER=none). Returning the manual contract; set LLM_PROVIDER + the matching API key to enable agent mode.",
    };
  }
  if (detailsCode === TOKEN_BUDGET_EXCEEDED_CODE) {
    return {
      kind: "fallback",
      reason: TOKEN_BUDGET_EXCEEDED_CODE,
      note: "The supplied inputs exceeded the workflow's input token budget. Trim the payload and retry, or call manual mode directly.",
    };
  }
  return { kind: "propagate" };
}

export async function workflowRun(input: WorkflowRunInput) {
  return withToolTelemetry({ tool: "workflow_run" }, async () => {
    const mode = resolveWorkflowMode(input.mode, process.env.WORKFLOW_MODE);
    const workflow = input.workflow as WorkflowName;

    if (mode === "disabled") {
      return asToolText(buildDisabledResponse(workflow));
    }

    if (mode === "manual") {
      return asToolText(buildManualResponse(workflow, input.inputs));
    }

    // mode === "agent" — Group 15 path.
    try {
      const module = WORKFLOW_MODULES[workflow];
      const agentResult = await runAgentWorkflow({
        workflow: module,
        inputs: input.inputs,
        projectId: input.projectId,
      });
      return asToolText({
        mode: "agent" as const,
        workflow,
        provider: agentResult.provider,
        model: agentResult.model,
        selectionStrategy: agentResult.selectionStrategy,
        fromRetry: agentResult.fromRetry,
        ...(agentResult.usage ? { usage: agentResult.usage } : {}),
        output: agentResult.object,
        ...(input.inputs ? { inputs: input.inputs } : {}),
      });
    } catch (err) {
      const classified = classifyAgentFailure(err);
      if (classified.kind === "propagate") {
        // Surface real failures (network, auth, content-filter,
        // schema-violation-after-retry) to the caller instead
        // of masking them as a soft fallback.
        throw err;
      }

      const appErr = toAppError(err);
      log.warn(
        {
          workflow,
          reason: classified.reason,
          error: appErr.message,
        },
        "agent-mode workflow_run fell back to manual"
      );

      const manual = buildManualResponse(workflow, input.inputs);
      return asToolText({
        ...manual,
        agentFallback: {
          reason: classified.reason,
          note: classified.note,
          providerError: appErr.message,
        },
      });
    }
  });
}
