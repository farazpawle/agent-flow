/**
 * Centralized structured logger backed by pino.
 *
 * Writes to stderr by default so it never collides with the MCP stdio
 * protocol (which owns stdout). Use `logger.child({ ... })` to attach
 * stable context (e.g. correlation IDs, tool name) at the call site.
 */

import pino, { type Logger, type LoggerOptions } from "pino";

const isDevelopment = process.env.NODE_ENV === "development";
const isTest = process.env.NODE_ENV === "test";

const level =
  process.env.LOG_LEVEL?.toLowerCase() || (isTest ? "silent" : isDevelopment ? "debug" : "info");

const baseOptions: LoggerOptions = {
  level,
  base: { service: "agent-flow" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: [
      "password",
      "token",
      "apiKey",
      "*.password",
      "*.token",
      "*.apiKey",
      "*.api_key",
      "*.authorization",
      "headers.authorization",
    ],
    censor: "[REDACTED]",
  },
};

// Pretty-print only in dev. In production / MCP stdio mode we emit JSON.
const prettyTransport: LoggerOptions["transport"] | undefined =
  isDevelopment && !process.env.AGENTFLOW_LOG_JSON
    ? {
        target: "pino-pretty",
        options: {
          destination: 2, // stderr
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname,service",
        },
      }
    : undefined;

// stderr destination (fd 2). Never write to stdout — MCP protocol owns it.
const destination = pino.destination({ dest: 2, sync: false });

export const logger: Logger = prettyTransport
  ? pino({ ...baseOptions, transport: prettyTransport })
  : pino(baseOptions, destination);

/**
 * Create a child logger with bound context.
 *
 * @example
 *   const log = childLogger({ tool: "planIdea", correlationId });
 *   log.info({ stage: "plan" }, "starting");
 */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}

/**
 * Generate a short correlation ID for a single tool invocation.
 * Not cryptographically strong — purely for log correlation.
 */
export function newCorrelationId(): string {
  return Math.random().toString(36).slice(2, 10);
}
