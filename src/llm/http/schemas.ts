/**
 * HTTP body schemas for the `/api/llm/*` routes (Phase 2 Group 16).
 *
 * Kept separate from `src/llm/factory.ts` so the routes can validate
 * without importing the factory and dragging in provider clients.
 */

import { z } from "zod";
import { SUPPORTED_PROVIDERS } from "../provider.js";
import { SELECTION_STRATEGIES } from "../models/selection.js";

/** Allowed `WORKFLOW_MODE` values (same surface `workflow_run` exposes). */
export const WORKFLOW_MODE_VALUES = ["manual", "agent", "disabled"] as const;

/**
 * `POST /api/llm/settings` body. Every field is optional so the GUI can
 * patch one at a time. API keys are explicitly absent — they are
 * env-only by design (plan §16.2) and `setLlmSettings` doesn't accept
 * them either.
 *
 * `null` values are accepted and treated as "clear this field"; missing
 * fields are left untouched.
 */
export const llmSettingsBodySchema = z
  .object({
    provider: z
      .enum([...SUPPORTED_PROVIDERS] as [string, ...string[]])
      .nullable()
      .optional(),
    model: z.string().min(1).max(256).nullable().optional(),
    selectionStrategy: z
      .enum([...SELECTION_STRATEGIES] as [string, ...string[]])
      .nullable()
      .optional(),
    workflowMode: z
      .enum([...WORKFLOW_MODE_VALUES] as [string, ...string[]])
      .nullable()
      .optional(),
  })
  .strict();

export type LlmSettingsBody = z.infer<typeof llmSettingsBodySchema>;

/**
 * `POST /api/llm/model/refresh` body. Just the provider id; if absent
 * the refresh route returns a 400.
 */
export const llmModelRefreshBodySchema = z
  .object({
    provider: z.enum([...SUPPORTED_PROVIDERS] as [string, ...string[]]),
  })
  .strict();

export type LlmModelRefreshBody = z.infer<typeof llmModelRefreshBodySchema>;
