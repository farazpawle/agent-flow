/**
 * Zod-backed Express helpers for the GUI HTTP API.
 *
 * - `validateBody(schema)` / `validateQuery(schema)` produce middleware
 *   that parses the request and short-circuits with a 400 + AppError
 *   shape if validation fails.
 * - `*Schemas` define the public request contracts for mutating routes.
 *
 * Schemas here mirror what `taskModel.updateTask` accepts and what the
 * existing Zod task schemas (`src/tools/task/schemas.ts`) describe, but
 * are intentionally narrower — HTTP callers only mutate a small slice.
 */

import type { Request, Response, NextFunction } from "express";
import { z, type ZodTypeAny } from "zod";
import { ValidationError, toHttpErrorBody } from "./errors.js";
import { childLogger } from "./logger.js";

const log = childLogger({ component: "httpValidation" });

const ALLOWED_STATUSES = ["Pending", "In Progress", "Completed", "Blocked"] as const;

/**
 * Whitelist of fields a PATCH /api/tasks/:id caller may set.
 * Anything outside this list is silently dropped by Zod's `.strip()`.
 */
export const patchTaskBodySchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(20_000).optional(),
    notes: z.string().max(20_000).optional(),
    status: z
      .union([
        z.enum(ALLOWED_STATUSES),
        z.enum(["pending", "in_progress", "in progress", "completed", "blocked"]),
      ])
      .optional(),
    executionOrder: z.number().int().min(0).optional(),
    implementationGuide: z.string().max(20_000).optional(),
    verificationCriteria: z.string().max(20_000).optional(),
    problemStatement: z.string().max(20_000).optional(),
    technicalPlan: z.string().max(20_000).optional(),
    finalOutcome: z.string().max(20_000).optional(),
    lessonsLearned: z.string().max(20_000).optional(),
    summary: z.string().max(20_000).optional(),
    dependencies: z
      .array(z.object({ taskId: z.string().min(1) }))
      .max(50)
      .optional(),
    relatedFiles: z
      .array(
        z.object({
          path: z.string().min(1).max(1024),
          type: z.string().min(1).max(64),
          description: z.string().max(2_000).optional(),
        })
      )
      .max(100)
      .optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: "Request body must include at least one updatable field.",
  });

export type PatchTaskBody = z.infer<typeof patchTaskBodySchema>;

export const reorderTasksBodySchema = z.object({
  taskIds: z.array(z.string().min(1)).min(2).max(500),
  projectId: z.string().min(1).optional(),
});

export const sseQuerySchema = z.object({
  clientId: z.string().min(1).max(128).optional(),
});

/**
 * Build an Express middleware that validates `req.body` against `schema`.
 * On success the parsed value replaces `req.body` so downstream handlers
 * see the normalized shape (extra keys stripped, defaults applied).
 */
export function validateBody<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
      );
      const err = new ValidationError("Request body failed validation.", {
        details: { issues },
      });
      log.warn({ path: req.path, issues }, "rejected invalid body");
      const { status, body } = toHttpErrorBody(err);
      res.status(status).json(body);
      return;
    }
    req.body = parsed.data;
    next();
  };
}

/**
 * Build an Express middleware that validates `req.query` against `schema`.
 */
export function validateQuery<T extends ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (i) => `${i.path.join(".") || "(root)"}: ${i.message}`
      );
      const err = new ValidationError("Query parameters failed validation.", {
        details: { issues },
      });
      log.warn({ path: req.path, issues }, "rejected invalid query");
      const { status, body } = toHttpErrorBody(err);
      res.status(status).json(body);
      return;
    }
    // Express 5 makes req.query a getter; assign onto an internal property
    // for handlers that prefer the parsed shape.
    (req as Request & { validatedQuery?: unknown }).validatedQuery = parsed.data;
    next();
  };
}

/**
 * Normalize the status string coming from the SPA (it may send
 * `pending` / `in_progress`) to the canonical TaskStatus values that
 * `updateTask` expects.
 */
export function normalizeStatus(status: string | undefined): string | undefined {
  if (typeof status !== "string") return status;
  const trimmed = status.trim().toLowerCase();
  switch (trimmed) {
    case "pending":
      return "Pending";
    case "in_progress":
    case "in progress":
      return "In Progress";
    case "completed":
      return "Completed";
    case "blocked":
      return "Blocked";
    default:
      return status;
  }
}
