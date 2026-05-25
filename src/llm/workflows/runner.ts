/**
 * Agent-mode workflow runner (Group 15.3 / 15.4 / 15.5 / 15.7).
 *
 * Bridges `workflow_run(mode=agent)` to the configured `LlmProvider`:
 *
 *   1. Build the system+user prompt from the workflow module.
 *   2. Enforce the per-workflow input token budget (15.5) — oversize
 *      inputs throw `ValidationError(TOKEN_BUDGET_EXCEEDED)` so the
 *      handler can fall back to manual mode without burning a round
 *      trip on a 4xx.
 *   3. Resolve the provider + model via the Group 13/14 layer.
 *   4. Try `provider.generateObject({ schema })` first (15.4). Most
 *      adapters use structured-output natively.
 *   5. If that fails Zod validation, retry exactly once with
 *      `generateText` + a follow-up prompt that quotes the validation
 *      error verbatim (15.4 "one retry with validation error in next
 *      prompt").
 *   6. Quota-exceeded errors surface as a typed
 *      `WorkflowQuotaError` so the handler can return the manual
 *      payload (15.7) without `try/catch` heuristics.
 *
 * Telemetry: every provider call goes through `withLlmTelemetry`
 * (Group 14.5) so the `workflow_steps` row records {provider, model,
 * selectionStrategy, modelListAge, latencyMs, usage}.
 */

import { z } from "zod";
import { applyEnvironmentAliases } from "../../utils/envConfig.js";
import { ExternalServiceError, ValidationError, toAppError } from "../../utils/errors.js";
import { estimateTokens } from "../../utils/tokenBudget.js";
import { childLogger } from "../../utils/logger.js";
import { createLlmProvider, resolveLlmConfig } from "../factory.js";
import { PROVIDER_NOT_CONFIGURED_CODE } from "../providers/none.js";
import { resolveModelForCall } from "../models/registry.js";
import { withLlmTelemetry } from "../models/telemetry.js";
import { isSelectionStrategy } from "../models/selection.js";
import type { LlmProvider, LlmUsage } from "../provider.js";
import type { DatabaseAdapter } from "../../models/interfaces.js";
import type { WorkflowName } from "../../tools/workflows/definitions.js";
import type { WorkflowModule } from "./types.js";

const log = childLogger({ component: "workflow_runner" });

export const TOKEN_BUDGET_EXCEEDED_CODE = "TOKEN_BUDGET_EXCEEDED" as const;
export const QUOTA_EXCEEDED_CODE = "QUOTA_EXCEEDED" as const;

/**
 * Thrown only when the provider reports a hard quota error. The
 * `workflow_run` handler turns this into a manual-mode payload (15.7);
 * every other provider error propagates as `ExternalServiceError`.
 */
export class WorkflowQuotaError extends ExternalServiceError {
  constructor(
    message: string,
    options: { cause?: unknown; details?: Record<string, unknown> } = {}
  ) {
    super(message, {
      cause: options.cause,
      details: { code: QUOTA_EXCEEDED_CODE, ...(options.details ?? {}) },
    });
  }
}

/**
 * Heuristic quota detection: provider SDKs surface 429 / "quota
 * exceeded" / "insufficient quota" with inconsistent shapes. We match
 * conservatively on message + status code; any false negative just
 * means the caller sees a generic EXTERNAL error instead of the
 * graceful manual-mode fallback.
 */
function looksLikeQuotaError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const status =
    typeof e.statusCode === "number"
      ? e.statusCode
      : typeof e.status === "number"
        ? e.status
        : undefined;
  if (status === 429) return true;
  const code = typeof e.code === "string" ? e.code.toLowerCase() : "";
  if (
    code === "insufficient_quota" ||
    code === "quota_exceeded" ||
    code === QUOTA_EXCEEDED_CODE.toLowerCase()
  ) {
    return true;
  }
  const detailsCode =
    e.details && typeof e.details === "object" && "code" in (e.details as object)
      ? String((e.details as Record<string, unknown>).code ?? "").toLowerCase()
      : "";
  if (
    detailsCode === "insufficient_quota" ||
    detailsCode === "quota_exceeded" ||
    detailsCode === QUOTA_EXCEEDED_CODE.toLowerCase()
  ) {
    return true;
  }
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    message.includes("insufficient quota") ||
    message.includes("quota exceeded") ||
    (message.includes("rate limit") && message.includes("exceeded"))
  );
}

function isProviderNotConfigured(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  const details = e.details as Record<string, unknown> | undefined;
  return details?.code === PROVIDER_NOT_CONFIGURED_CODE;
}

export interface RunAgentWorkflowOptions {
  workflow: WorkflowModule;
  inputs: Record<string, unknown> | undefined;
  /** Project ID for the telemetry row. */
  projectId?: string;
  /** Correlation ID for tracing (HTTP `X-Correlation-Id`). */
  correlationId?: string;
  /** Test seam — defaults to `createLlmProvider({ db })`. */
  provider?: LlmProvider;
  /** Test seam for env reads. */
  env?: NodeJS.ProcessEnv;
  /** DB adapter for the factory; defaults to `dbFactory.getDatabase()`. */
  db?: DatabaseAdapter;
}

export interface RunAgentWorkflowResult {
  workflow: WorkflowName;
  object: unknown;
  usage?: LlmUsage;
  /** Provider id used for the call (for the response envelope). */
  provider: string;
  model: string;
  selectionStrategy: string;
  /** True when the result came from the `generateText` + retry path. */
  fromRetry: boolean;
}

interface PreparedPrompt {
  system: string;
  user: string;
  estimatedTokens: number;
}

function prepare(
  workflow: WorkflowModule,
  inputs: Record<string, unknown> | undefined
): PreparedPrompt {
  const system = workflow.systemPrompt;
  const user = workflow.userTemplate(inputs);
  const estimatedTokens = estimateTokens(system) + estimateTokens(user);
  return { system, user, estimatedTokens };
}

function enforceBudget(workflow: WorkflowModule, prepared: PreparedPrompt): void {
  if (prepared.estimatedTokens > workflow.inputTokenBudget) {
    throw new ValidationError(
      `Workflow '${workflow.name}' input exceeds the configured budget (${prepared.estimatedTokens} > ${workflow.inputTokenBudget} tokens).`,
      {
        hint: "Trim the `inputs` payload (cite source ids instead of pasting full bodies) or split the call into smaller workflow_run invocations.",
        details: {
          code: TOKEN_BUDGET_EXCEEDED_CODE,
          workflow: workflow.name,
          estimatedTokens: prepared.estimatedTokens,
          budget: workflow.inputTokenBudget,
        },
      }
    );
  }
}

function buildRetryPrompt(
  workflow: WorkflowModule,
  originalUser: string,
  rawText: string,
  error: z.ZodError
): string {
  const issues = error.issues
    .map((i) => `- ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  return [
    originalUser,
    "",
    "Your previous response did NOT validate against the schema:",
    "```",
    rawText.length > 4_000 ? `${rawText.slice(0, 4_000)}…` : rawText,
    "```",
    "",
    "Validation errors:",
    issues,
    "",
    "Reply ONLY with corrected JSON that matches the schema. No prose, no code fences.",
  ].join("\n");
}

function tryParseObject(rawText: string): unknown {
  // Models often wrap JSON in ```json fences — strip them defensively.
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = fenced ? fenced[1] : rawText;
  return JSON.parse(body);
}

export async function runAgentWorkflow(
  opts: RunAgentWorkflowOptions
): Promise<RunAgentWorkflowResult> {
  const env = opts.env ?? process.env;
  applyEnvironmentAliases(env);

  // 15.5 — enforce the input budget BEFORE we open a provider client
  // or hit the network.
  const prepared = prepare(opts.workflow, opts.inputs);
  enforceBudget(opts.workflow, prepared);

  // Build the provider. Reuses Group 13's factory so DB-backed
  // settings (llm_settings) override env unless LLM_CONFIG_LOCK=true.
  const config = await resolveLlmConfig({ db: opts.db, env });
  if (config.provider === "none") {
    // Surface as PROVIDER_NOT_CONFIGURED so the handler can fall
    // back to manual mode just like a quota error.
    throw new ExternalServiceError("No LLM provider configured (LLM_PROVIDER=none).", {
      hint: "Set LLM_PROVIDER to one of: openai | anthropic | openrouter | deepseek, then supply the matching API key.",
      details: { code: PROVIDER_NOT_CONFIGURED_CODE, provider: "none" },
    });
  }

  const provider = opts.provider ?? (await createLlmProvider({ db: opts.db, env }));

  // Resolve {provider, model, selectionStrategy} for the telemetry
  // row + the per-call `model` argument.
  const strategyRaw = env.LLM_SELECTION_STRATEGY?.trim();
  const strategy = strategyRaw && isSelectionStrategy(strategyRaw) ? strategyRaw : undefined;
  const resolution = await resolveModelForCall({
    provider: config.provider,
    preferredModel: config.model,
    strategy,
    env,
  });

  const callMeta = {
    tool: "workflow_run",
    workflow: opts.workflow.name,
    projectId: opts.projectId,
    correlationId: opts.correlationId,
    resolution,
  };

  let fromRetry = false;

  try {
    return await withLlmTelemetry<RunAgentWorkflowResult>(callMeta, async () => {
      // 15.4 — try structured output first.
      try {
        const objResult = await provider.generateObject({
          system: prepared.system,
          prompt: prepared.user,
          schema: opts.workflow.outputSchema,
          model: resolution.model,
          maxTokens: opts.workflow.maxOutputTokens,
        });
        // `generateObject` returns a pre-parsed object, but
        // some adapters return it loosely typed. Validate again
        // to be defensive — and so the same `parse` happens
        // regardless of which provider we hit.
        const parsed = opts.workflow.outputSchema.parse(objResult.object);
        const result: RunAgentWorkflowResult = {
          workflow: opts.workflow.name,
          object: parsed,
          usage: objResult.usage,
          provider: provider.name,
          model: resolution.model,
          selectionStrategy: resolution.selectionStrategy,
          fromRetry: false,
        };
        return { result, usage: objResult.usage };
      } catch (firstErr) {
        // Quota errors short-circuit before we attempt the
        // text-fallback retry — burning a second call won't
        // unblock us.
        if (looksLikeQuotaError(firstErr)) {
          throw new WorkflowQuotaError(
            `Provider '${provider.name}' returned a quota error for workflow '${opts.workflow.name}'.`,
            { cause: firstErr, details: { workflow: opts.workflow.name } }
          );
        }

        // Some providers reject `generateObject` for non-schema
        // reasons (auth, network, content-filter). Re-throw
        // those instead of pretending a retry would help.
        const appErr = toAppError(firstErr);
        if (appErr.code === "AUTH" || appErr.code === "RATE_LIMITED") {
          throw firstErr;
        }

        // 15.4 — single retry with the validation error fed
        // back into the prompt. We swap to `generateText` for
        // the retry because most adapters that fail
        // `generateObject` schema validation will succeed with
        // free-form text + our own Zod parse.
        fromRetry = true;
        log.warn(
          {
            workflow: opts.workflow.name,
            provider: provider.name,
            error: appErr.message,
          },
          "generateObject failed — retrying once with generateText + schema feedback"
        );

        const zodErr =
          firstErr instanceof z.ZodError
            ? firstErr
            : new z.ZodError([
                {
                  code: z.ZodIssueCode.custom,
                  path: [],
                  message: appErr.message,
                },
              ]);

        const retryPrompt = buildRetryPrompt(opts.workflow, prepared.user, "", zodErr);

        let textResult;
        try {
          textResult = await provider.generateText({
            system: prepared.system,
            prompt: retryPrompt,
            model: resolution.model,
            maxTokens: opts.workflow.maxOutputTokens,
          });
        } catch (retryErr) {
          if (looksLikeQuotaError(retryErr)) {
            throw new WorkflowQuotaError(
              `Provider '${provider.name}' returned a quota error on retry for workflow '${opts.workflow.name}'.`,
              { cause: retryErr, details: { workflow: opts.workflow.name } }
            );
          }
          throw retryErr;
        }

        let parsedAfterRetry;
        try {
          const rawJson = tryParseObject(textResult.text);
          parsedAfterRetry = opts.workflow.outputSchema.parse(rawJson);
        } catch (parseErr) {
          // 15.4 explicitly caps retries at ONE. If the
          // retry also fails parsing, surface a typed
          // EXTERNAL error rather than recurse.
          throw new ExternalServiceError(
            `Workflow '${opts.workflow.name}' agent-mode response failed schema validation on retry.`,
            {
              cause: parseErr,
              details: {
                workflow: opts.workflow.name,
                provider: provider.name,
                rawTextLength: textResult.text.length,
              },
              hint: "Inspect the workflow's system prompt or fall back to manual mode for this call.",
            }
          );
        }

        const result: RunAgentWorkflowResult = {
          workflow: opts.workflow.name,
          object: parsedAfterRetry,
          usage: textResult.usage,
          provider: provider.name,
          model: resolution.model,
          selectionStrategy: resolution.selectionStrategy,
          fromRetry: true,
        };
        return { result, usage: textResult.usage };
      }
    });
  } catch (err) {
    if (err instanceof WorkflowQuotaError) throw err;
    if (isProviderNotConfigured(err)) throw err;
    throw err;
  } finally {
    // fromRetry is captured in the returned object directly; this
    // block exists only as a debug hook for future logging.
    void fromRetry;
  }
}
