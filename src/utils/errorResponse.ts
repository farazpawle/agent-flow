/**
 * Standardized error response helper for MCP tool handlers.
 *
 * Kept for backward compatibility with existing callers that pass raw
 * string errors. New code should throw `AppError` subclasses and let the
 * tool boundary call `toToolErrorResponse` from `./errors.js` directly.
 */

import { InternalError, toToolErrorResponse } from "./errors.js";

export function renderError(
  tool: string,
  error: string,
  hint?: string
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  return toToolErrorResponse(tool, new InternalError(error, { hint }));
}

export { toToolErrorResponse, toHttpErrorBody } from "./errors.js";
export {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  AuthError,
  ForbiddenError,
  RateLimitedError,
  DatabaseError,
  ExternalServiceError,
  InternalError,
  toAppError,
} from "./errors.js";
