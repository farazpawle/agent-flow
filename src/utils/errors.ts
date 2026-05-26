/**
 * Typed application error hierarchy.
 *
 * Every domain failure surfaces as an `AppError` subclass with a stable
 * machine-readable `code` and an optional HTTP status. Tool handlers
 * funnel everything through `toToolErrorResponse` so the MCP boundary
 * stays uniform.
 */

export type AppErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "AUTH"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "DATABASE"
  | "EXTERNAL"
  | "INTERNAL";

export interface AppErrorOptions {
  cause?: unknown;
  hint?: string;
  details?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly hint?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    httpStatus: number,
    message: string,
    options: AppErrorOptions = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = this.constructor.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.hint = options.hint;
    this.details = options.details;
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      hint: this.hint,
      details: this.details,
    };
  }
}

export class ValidationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("VALIDATION", 400, message, options);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("NOT_FOUND", 404, message, options);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("CONFLICT", 409, message, options);
  }
}

export class AuthError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("AUTH", 401, message, options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("FORBIDDEN", 403, message, options);
  }
}

export class RateLimitedError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("RATE_LIMITED", 429, message, options);
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("DATABASE", 500, message, options);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("EXTERNAL", 502, message, options);
  }
}

export class InternalError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super("INTERNAL", 500, message, options);
  }
}

/**
 * Coerce any thrown value into an `AppError`. Unknown errors collapse to
 * `InternalError` while preserving the original via `cause`.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    return new InternalError(err.message, { cause: err });
  }
  return new InternalError("Unknown error", { cause: err });
}

/**
 * Render an AppError as an MCP tool error response. Centralizes the
 * "isError: true + text content block" shape used across tools.
 *
 * Structured `details` (e.g. the optimistic-concurrency CONFLICT body
 * from `src/models/concurrency.ts` matching plan §6.4) are appended as a
 * fenced JSON block so MCP clients can parse them deterministically.
 */
export function toToolErrorResponse(
  tool: string,
  err: unknown
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  const appErr = toAppError(err);
  const lines = [
    `❌ **Error in \`${tool}\`** (${appErr.code})`,
    ``,
    `**What went wrong:** ${appErr.message}`,
  ];
  if (appErr.hint) {
    lines.push(``, `💡 **Hint:** ${appErr.hint}`);
  }
  if (appErr.details) {
    lines.push(``, "```json", JSON.stringify(appErr.details, null, 2), "```");
  }
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    isError: true,
  };
}

/**
 * Render an AppError as an Express JSON error body, paired with its
 * httpStatus. Caller is responsible for `res.status(...)`.
 */
export function toHttpErrorBody(err: unknown): {
  status: number;
  body: { error: string; code: AppErrorCode; hint?: string; details?: Record<string, unknown> };
} {
  const appErr = toAppError(err);
  return {
    status: appErr.httpStatus,
    body: {
      error: appErr.message,
      code: appErr.code,
      ...(appErr.hint ? { hint: appErr.hint } : {}),
      ...(appErr.details ? { details: appErr.details } : {}),
    },
  };
}
