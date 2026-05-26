/**
 * LLM provider abstraction (Phase 2 — Group 13).
 *
 * Phase-1 schema (`llm_settings`) and env aliases were pre-registered in
 * Group 1 / `envConfig.ts`. This module is the runtime that Phase-2
 * workflows (`workflow_run` in `agent` mode, Group 15) consume.
 *
 * The shape is intentionally narrow:
 *   - `generateText`   — free-form text completion + usage metering.
 *   - `generateObject` — Zod-schema-validated structured output.
 *
 * Provider-specific knobs (tool-calling, parallel calls, streaming,
 * cache headers, etc.) are NOT exposed here; workflows are deliberately
 * one-shot and provider-portable. Adapters MAY enrich requests via
 * `providerOptions` internally but callers see a unified surface.
 */

import { z } from "zod";

/**
 * Token accounting reported by the provider. We mirror the AI SDK v6
 * field names (`inputTokens` / `outputTokens` / `totalTokens`) so the
 * audit row written by Group 14.5 / 16.3 is unambiguous regardless of
 * provider terminology ("prompt" vs "input", "completion" vs "output").
 */
export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/** Common knobs for both call shapes. */
export interface LlmCallCommon {
  /**
   * System prompt. Workflows in `src/llm/workflows/*` (Group 15) supply
   * this; ad-hoc callers may omit it.
   */
  system?: string;
  /** User-side prompt body. */
  prompt: string;
  /** Sampling temperature in [0, 2]. Provider default if omitted. */
  temperature?: number;
  /** Hard cap on output tokens. Provider default if omitted. */
  maxTokens?: number;
  /**
   * Per-call model override. Falls back to the provider's `defaultModel`
   * (resolved by Group 14 selection strategy). Required if the provider
   * was built without a default.
   */
  model?: string;
}

export type LlmGenerateTextInput = LlmCallCommon;

export interface LlmGenerateTextResult {
  text: string;
  usage: LlmUsage;
  /** Provider-reported reason: "stop" | "length" | "tool-calls" | "content-filter" | "error" | … */
  finishReason?: string;
}

export interface LlmGenerateObjectInput<TSchema extends z.ZodTypeAny> extends LlmCallCommon {
  schema: TSchema;
}

export interface LlmGenerateObjectResult<TSchema extends z.ZodTypeAny> {
  object: z.infer<TSchema>;
  usage: LlmUsage;
  finishReason?: string;
}

/**
 * Adapter contract. Every concrete provider in `src/llm/providers/`
 * implements this. The factory (`src/llm/factory.ts`) returns one of
 * these — including a no-op `none` provider that errors out on first
 * call with `PROVIDER_NOT_CONFIGURED`.
 */
export interface LlmProvider {
  /** Stable provider identifier — drives audit rows and the GUI selector. */
  readonly name: string;
  /**
   * Default model id used when callers don't supply one. May be
   * `undefined` for the `none` provider or when the GUI hasn't picked a
   * model yet (selection-strategy fallback happens in Group 14).
   */
  readonly defaultModel: string | undefined;

  generateText(input: LlmGenerateTextInput): Promise<LlmGenerateTextResult>;

  generateObject<TSchema extends z.ZodTypeAny>(
    input: LlmGenerateObjectInput<TSchema>
  ): Promise<LlmGenerateObjectResult<TSchema>>;
}

/** Stable list of supported provider keys — used by factory + envConfig. */
export const SUPPORTED_PROVIDERS = [
  "openai",
  "anthropic",
  "openrouter",
  "deepseek",
  "none",
] as const;

export type SupportedProvider = (typeof SUPPORTED_PROVIDERS)[number];

export function isSupportedProvider(value: string): value is SupportedProvider {
  return (SUPPORTED_PROVIDERS as readonly string[]).includes(value);
}
