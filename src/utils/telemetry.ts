/**
 * Lightweight telemetry helpers.
 *
 * - `withToolTelemetry` wraps a tool handler and records timing +
 *   outcome via the structured logger. Use it at the MCP tool boundary
 *   so every invocation produces a comparable trace.
 *
 * Telemetry never throws. A failure to record must not break the tool
 * call.
 */

import { childLogger, newCorrelationId } from "./logger.js";
import { toAppError } from "./errors.js";

const telemetryLog = childLogger({ component: "telemetry" });

export interface ToolTelemetryFields {
  tool: string;
  correlationId?: string;
  projectId?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  outcome?: "success" | "error";
  errorCode?: string;
}

/**
 * Wrap an async tool handler. Emits a single log line per invocation
 * carrying tool name, duration, outcome, and (if thrown) the AppError
 * code. The original error/result is forwarded unchanged.
 */
export async function withToolTelemetry<T>(
  fields: Pick<ToolTelemetryFields, "tool" | "correlationId" | "projectId">,
  handler: () => Promise<T>
): Promise<T> {
  const correlationId = fields.correlationId ?? newCorrelationId();
  const startedAt = Date.now();
  const baseFields: ToolTelemetryFields = { ...fields, correlationId };

  try {
    const result = await handler();
    safeEmit({
      ...baseFields,
      durationMs: Date.now() - startedAt,
      outcome: "success",
    });
    return result;
  } catch (err) {
    const appErr = toAppError(err);
    safeEmit({
      ...baseFields,
      durationMs: Date.now() - startedAt,
      outcome: "error",
      errorCode: appErr.code,
    });
    throw err;
  }
}

function safeEmit(fields: ToolTelemetryFields): void {
  try {
    telemetryLog.info({ kind: "tool_invocation", ...fields }, "tool invocation");
  } catch {
    // ignore
  }
}
