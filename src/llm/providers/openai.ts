/**
 * OpenAI provider (Group 13.3).
 *
 * Wraps `@ai-sdk/openai` via the shared Vercel adapter. The API key
 * comes from `OPENAI_API_KEY` and is read by the SDK itself when we
 * fall back to the default `openai` provider singleton; passing
 * `apiKey` explicitly via `createOpenAI` lets the factory respect
 * runtime `llm_settings` overrides without touching `process.env`.
 */

import { createOpenAI } from "@ai-sdk/openai";
import type { LlmProvider } from "../provider.js";
import { createVercelAdapter } from "./shared.js";

export interface CreateOpenAiProviderOptions {
  apiKey?: string;
  defaultModel?: string;
}

export function createOpenAiProvider(opts: CreateOpenAiProviderOptions = {}): LlmProvider {
  const client = createOpenAI({
    apiKey: opts.apiKey ?? process.env.OPENAI_API_KEY,
  });
  return createVercelAdapter({
    name: "openai",
    defaultModel: opts.defaultModel,
    modelFactory: (id: string) => client(id),
  });
}
