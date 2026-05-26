/**
 * Anthropic provider (Group 13.3).
 *
 * Wraps `@ai-sdk/anthropic` via the shared Vercel adapter. API key
 * resolution mirrors the OpenAI adapter — explicit `apiKey` argument
 * wins, otherwise `ANTHROPIC_API_KEY` from env.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import type { LlmProvider } from "../provider.js";
import { createVercelAdapter } from "./shared.js";

export interface CreateAnthropicProviderOptions {
  apiKey?: string;
  defaultModel?: string;
}

export function createAnthropicProvider(opts: CreateAnthropicProviderOptions = {}): LlmProvider {
  const client = createAnthropic({
    apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY,
  });
  return createVercelAdapter({
    name: "anthropic",
    defaultModel: opts.defaultModel,
    modelFactory: (id: string) => client(id),
  });
}
