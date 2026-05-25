/**
 * DeepSeek provider (Group 13.3).
 *
 * DeepSeek's API is OpenAI-compatible, so we reuse
 * `@ai-sdk/openai-compatible` pointed at `https://api.deepseek.com/v1`
 * (plan §13.1: "or OpenAI-compat client pointed at api.deepseek.com").
 * Base URL is hardcoded — DeepSeek has no self-hosted gateway story
 * and the URL has been stable since launch.
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LlmProvider } from "../provider.js";
import { createVercelAdapter } from "./shared.js";

export interface CreateDeepSeekProviderOptions {
  apiKey?: string;
  defaultModel?: string;
}

const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

export function createDeepSeekProvider(opts: CreateDeepSeekProviderOptions = {}): LlmProvider {
  const client = createOpenAICompatible({
    name: "deepseek",
    apiKey: opts.apiKey ?? process.env.DEEPSEEK_API_KEY,
    baseURL: DEEPSEEK_BASE_URL,
    includeUsage: true,
  });
  return createVercelAdapter({
    name: "deepseek",
    defaultModel: opts.defaultModel,
    modelFactory: (id: string) => client(id),
  });
}
