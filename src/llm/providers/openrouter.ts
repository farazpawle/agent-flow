/**
 * OpenRouter provider (Group 13.3).
 *
 * OpenRouter exposes an OpenAI-compatible REST surface, so we route
 * through `@ai-sdk/openai-compatible` rather than pulling in a separate
 * community SDK. The base URL is hardcoded — OpenRouter has no
 * self-hosted gateway story and the URL has been stable since launch.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LlmProvider } from "../provider.js";
import { createVercelAdapter } from "./shared.js";

export interface CreateOpenRouterProviderOptions {
  apiKey?: string;
  defaultModel?: string;
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

export function createOpenRouterProvider(opts: CreateOpenRouterProviderOptions = {}): LlmProvider {
  const client = createOpenAICompatible({
    name: "openrouter",
    apiKey: opts.apiKey ?? process.env.OPENROUTER_API_KEY,
    baseURL: OPENROUTER_BASE_URL,
    includeUsage: true,
    // Without this the openai-compatible adapter treats the chat model as
    // NOT supporting structured outputs, drops the `json_schema`
    // responseFormat (emitting the AI SDK warning "JSON response format
    // schema is only supported with structuredOutputs"), and
    // `generateObject` can never satisfy the workflow's Zod schema. OpenRouter
    // forwards the json_schema response_format to the underlying model, so
    // schema-capable models (gpt-4o-mini, claude, etc.) enforce it.
    supportsStructuredOutputs: true,
  });
  return createVercelAdapter({
    name: "openrouter",
    defaultModel: opts.defaultModel,
    modelFactory: (id: string) => client(id),
  });
}
