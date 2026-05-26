/**
 * Shared Vercel AI SDK adapter (Group 13.3).
 *
 * All real providers (openai, anthropic, openrouter, deepseek) route
 * through this helper so the contract surface in `provider.ts` stays
 * single-implementation. Each provider file only declares:
 *   - which AI-SDK package to import,
 *   - how to build a `LanguageModel` from a model id,
 *   - the canonical `name` for audit rows.
 *
 * Error handling: every thrown error is normalised to
 * `ExternalServiceError` with `details.provider` set, so upstream code
 * paths (workflow_run, GUI) get a stable shape regardless of which SDK
 * raised the original exception.
 */

import { generateObject, generateText, type LanguageModel } from "ai";
import { z } from "zod";
import { ExternalServiceError, ValidationError } from "../../utils/errors.js";
import type {
  LlmGenerateObjectInput,
  LlmGenerateObjectResult,
  LlmGenerateTextInput,
  LlmGenerateTextResult,
  LlmProvider,
  LlmUsage,
} from "../provider.js";

export type ModelFactory = (modelId: string) => LanguageModel;

export interface VercelAdapterOptions {
  /** Stable provider id — surfaces in audits and GUI. */
  name: string;
  /** Provider's default model id, or `undefined` if the caller must pass one. */
  defaultModel?: string;
  /** Builds a `LanguageModel` instance from a model id (e.g. `openai('gpt-4')`). */
  modelFactory: ModelFactory;
}

/**
 * Coerce an AI SDK v6 usage block to our internal shape. The SDK may
 * report `undefined` for any field if the upstream provider didn't
 * include it; we fall back to 0 so the audit row never has a `null`
 * column.
 */
function coerceUsage(raw: unknown): LlmUsage {
  const u = (raw ?? {}) as Record<string, unknown>;
  const input = typeof u.inputTokens === "number" ? u.inputTokens : 0;
  const output = typeof u.outputTokens === "number" ? u.outputTokens : 0;
  const total = typeof u.totalTokens === "number" ? u.totalTokens : input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}

function resolveModelId(opts: VercelAdapterOptions, callerModel?: string): string {
  const modelId = callerModel ?? opts.defaultModel;
  if (!modelId) {
    throw new ValidationError(
      `LLM provider '${opts.name}' has no default model and no per-call model was supplied`,
      {
        hint: "Set LLM_MODEL in env, persist one via the GUI Settings panel, or pass `model` on the call",
      }
    );
  }
  return modelId;
}

function wrapProviderError(name: string, err: unknown): Error {
  if (err instanceof ExternalServiceError) return err;
  if (err instanceof ValidationError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ExternalServiceError(`LLM provider '${name}' call failed: ${message}`, {
    cause: err,
    details: { provider: name },
  });
}

export function createVercelAdapter(opts: VercelAdapterOptions): LlmProvider {
  return {
    name: opts.name,
    defaultModel: opts.defaultModel,

    async generateText(input: LlmGenerateTextInput): Promise<LlmGenerateTextResult> {
      const modelId = resolveModelId(opts, input.model);
      try {
        const result = await generateText({
          model: opts.modelFactory(modelId),
          system: input.system,
          prompt: input.prompt,
          temperature: input.temperature,
          maxOutputTokens: input.maxTokens,
        });
        return {
          text: result.text,
          usage: coerceUsage(result.usage),
          finishReason: result.finishReason,
        };
      } catch (err) {
        throw wrapProviderError(opts.name, err);
      }
    },

    async generateObject<TSchema extends z.ZodTypeAny>(
      input: LlmGenerateObjectInput<TSchema>
    ): Promise<LlmGenerateObjectResult<TSchema>> {
      const modelId = resolveModelId(opts, input.model);
      try {
        const result = await generateObject({
          model: opts.modelFactory(modelId),
          schema: input.schema,
          system: input.system,
          prompt: input.prompt,
          temperature: input.temperature,
          maxOutputTokens: input.maxTokens,
        });
        return {
          object: result.object as z.infer<TSchema>,
          usage: coerceUsage(result.usage),
          finishReason: result.finishReason,
        };
      } catch (err) {
        throw wrapProviderError(opts.name, err);
      }
    },
  };
}
