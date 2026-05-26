/**
 * No-op LLM provider (Group 13.5).
 *
 * Returned by the factory when `LLM_PROVIDER=none` (the default) so
 * `workflow_run(mode=agent)` and any opportunistic caller can probe
 * for a provider without crashing on import. Every call rejects with
 * `EXTERNAL` + `code=PROVIDER_NOT_CONFIGURED` — never throws an
 * unhandled error, so `workflow_run` can fall through to manual mode
 * (plan §4.4, see Group 15.7).
 */

import { ExternalServiceError } from "../../utils/errors.js";
import type { LlmProvider } from "../provider.js";

export const PROVIDER_NOT_CONFIGURED_CODE = "PROVIDER_NOT_CONFIGURED" as const;

function notConfigured(): never {
  throw new ExternalServiceError("No LLM provider configured (LLM_PROVIDER=none).", {
    hint: "Set LLM_PROVIDER to one of: openai | anthropic | openrouter | deepseek, then supply the matching API key.",
    details: { code: PROVIDER_NOT_CONFIGURED_CODE, provider: "none" },
  });
}

export function createNoneProvider(): LlmProvider {
  return {
    name: "none",
    defaultModel: undefined,
    async generateText() {
      return notConfigured();
    },
    async generateObject() {
      return notConfigured();
    },
  };
}
