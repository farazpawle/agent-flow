/**
 * Plan upload — Wave 3 §10.A.
 *
 * Two-step flow:
 *   1. POST /api/plan/upload/preview — JSON `{ planMarkdown, projectId,
 *      filename?, contentType? }`. LLM runs, no DB writes, returns
 *      `{ previewId, group?, tasks }`.
 *   2. POST /api/plan/upload/commit  — JSON `{ previewId, projectId, edits? }`.
 *      Wraps the writes in `runInTransaction`: optional group → parent
 *      tasks → subtasks → dependency wiring.
 *
 * Constraints:
 *   - MIME allowlist applied to body `contentType` (else 415): text/markdown,
 *     text/plain. Default when omitted: text/markdown.
 *   - Size cap on UTF-8 byte length of `planMarkdown`: 200 KB (else 413).
 *   - Preview cache: in-memory `Map<previewId, …>`, 5-minute TTL.
 *   - LLM_PROVIDER=none → 503 LLM_NOT_CONFIGURED on both routes; no
 *     regex fallback.
 *
 * Why JSON instead of multipart/form-data: keeps the route under the
 * existing `express.json()` middleware (1 MB body limit) without
 * pulling multer into the dependency tree. The UI builds the body via
 * a `fetch` call after `FileReader.readAsText()`; CLI smoke tests use
 * `curl -X POST -H 'Content-Type: application/json' --data-binary @body.json`.
 */

import { randomUUID } from "crypto";
import { v4 as uuidv4 } from "uuid";
import type { Request, Response } from "express";
import { z } from "zod";

import { db } from "../models/db.js";
import { childLogger } from "../utils/logger.js";
import {
  AppError,
  ExternalServiceError,
  NotFoundError,
  ValidationError,
  toAppError,
  toHttpErrorBody,
} from "../utils/errors.js";
import { safeParseTool } from "../utils/schemaParse.js";
import { runAgentWorkflow, WORKFLOW_MODULES, WorkflowQuotaError } from "../llm/workflows/index.js";
import { resolveLlmConfig } from "../llm/factory.js";
import { PROVIDER_NOT_CONFIGURED_CODE } from "../llm/providers/none.js";
import type { Task, TaskDependency } from "../types/index.js";
import { TaskStatus } from "../types/index.js";
import type { TaskGroup } from "../types/index.js";

const log = childLogger({ component: "plan_upload" });

// ────────────────────────────────────────────────────────────────────────
// Constants — kept in sync with CLAUDE.md "Plan upload (10.A)".
// ────────────────────────────────────────────────────────────────────────

export const PLAN_UPLOAD_MAX_BYTES = 200 * 1024; // 200 KB
export const PLAN_UPLOAD_MIME_ALLOWLIST: ReadonlySet<string> = new Set([
  "text/markdown",
  "text/plain",
  "text/x-markdown",
  // Browsers occasionally fall back to this when no MIME is known.
  "application/octet-stream",
]);
export const PLAN_UPLOAD_PREVIEW_TTL_MS = 5 * 60 * 1000;
const PREVIEW_SWEEP_INTERVAL_MS = 60 * 1000;

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────

export interface ParsedPlanTask {
  name: string;
  description: string;
  verificationCriteria?: string;
  dependsOnPreviousIndex: boolean;
  parentIndex?: number;
}

export interface ParsedPlanGroup {
  name: string;
  description?: string;
}

export interface ParsedPlanPayload {
  group?: ParsedPlanGroup;
  tasks: ParsedPlanTask[];
}

interface PreviewEntry {
  projectId: string;
  payload: ParsedPlanPayload;
  expiresAt: number;
  createdAt: number;
}

// ────────────────────────────────────────────────────────────────────────
// Preview cache (in-memory).
// ────────────────────────────────────────────────────────────────────────

const previewCache = new Map<string, PreviewEntry>();

function sweepPreviews(now: number = Date.now()): number {
  let removed = 0;
  for (const [id, entry] of previewCache.entries()) {
    if (entry.expiresAt <= now) {
      previewCache.delete(id);
      removed += 1;
    }
  }
  return removed;
}

let sweepTimer: ReturnType<typeof setInterval> | null = null;
export function startPreviewSweeper(): void {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => sweepPreviews(), PREVIEW_SWEEP_INTERVAL_MS);
  // Don't keep the process alive purely for the sweeper.
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

export function stopPreviewSweeper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}

/** Test-only handles so suites can drive the cache without timing. */
export const __testing = {
  previewCache,
  sweepPreviews,
};

// ────────────────────────────────────────────────────────────────────────
// Validation helpers — defensive re-check after the Zod schema parse
// because grandchildren are easier to reject here with the full array
// in hand than via a Zod refinement.
// ────────────────────────────────────────────────────────────────────────

function validateTaskTree(tasks: ParsedPlanTask[]): void {
  if (tasks.length === 0) {
    throw new ValidationError("ingest_plan produced zero tasks.", {
      hint: "Add at least one `- [ ]` checkbox bullet to the uploaded plan.",
    });
  }
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i];
    if (t.parentIndex === undefined) continue;
    if (t.parentIndex >= i) {
      throw new ValidationError(
        `Task at index ${i} has parentIndex=${t.parentIndex}, which is not earlier in the list.`,
        {
          hint: "Subtasks must follow their parent in the array.",
          details: { code: "VALIDATION", index: i, parentIndex: t.parentIndex },
        }
      );
    }
    const parent = tasks[t.parentIndex];
    if (parent.parentIndex !== undefined) {
      throw new ValidationError(
        `Task at index ${i} would be a grandchild — subtasks may only be one level deep.`,
        {
          hint: "Flatten the hierarchy: every subtask's parent must itself be a top-level task.",
          details: {
            code: "VALIDATION",
            index: i,
            parentIndex: t.parentIndex,
            grandparentIndex: parent.parentIndex,
          },
        }
      );
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Body validation — runs before the LLM.
// ────────────────────────────────────────────────────────────────────────

export function assertPlanBytes(planMarkdown: string, contentType: string | undefined): void {
  const mime = (contentType ?? "text/markdown").toLowerCase();
  const baseMime = mime.split(";")[0].trim();
  if (!PLAN_UPLOAD_MIME_ALLOWLIST.has(baseMime)) {
    throw new AppError(
      "VALIDATION",
      415,
      `Unsupported contentType '${contentType ?? "(unspecified)"}'.`,
      {
        hint: `Allowed: ${[...PLAN_UPLOAD_MIME_ALLOWLIST].filter((m) => !m.startsWith("application/")).join(", ")}.`,
        details: { code: "UNSUPPORTED_MIME", contentType },
      }
    );
  }
  const byteLength = Buffer.byteLength(planMarkdown, "utf-8");
  if (byteLength > PLAN_UPLOAD_MAX_BYTES) {
    throw new AppError(
      "VALIDATION",
      413,
      `Uploaded plan exceeds the ${PLAN_UPLOAD_MAX_BYTES / 1024} KB limit (got ${byteLength} bytes).`,
      {
        hint: "Trim the plan, or split it into a smaller file before uploading.",
        details: { code: "FILE_TOO_LARGE", maxBytes: PLAN_UPLOAD_MAX_BYTES, byteLength },
      }
    );
  }
}

// ────────────────────────────────────────────────────────────────────────
// LLM-not-configured guard (used by both preview and commit so a locked
// instance can't be probed by the upload route either).
// ────────────────────────────────────────────────────────────────────────

async function assertLlmConfigured(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = await resolveLlmConfig({ db, env });
  if (config.provider === "none") {
    throw new ExternalServiceError(
      "Plan upload requires an LLM provider; LLM_PROVIDER is set to 'none'.",
      {
        // Mirrors workflow_run's 15.7 envelope so the front-end has one
        // code to special-case.
        details: { code: "LLM_NOT_CONFIGURED", provider: "none" },
        hint: "Set LLM_PROVIDER (openai | anthropic | openrouter | deepseek) and the matching API key, then retry.",
      }
    );
  }
}

function llmUnavailableHttp(
  err: unknown
): { status: number; body: ReturnType<typeof toHttpErrorBody>["body"] } | null {
  const appErr = toAppError(err);
  const details = appErr.details as Record<string, unknown> | undefined;
  const code = typeof details?.code === "string" ? details.code : "";
  if (code === "LLM_NOT_CONFIGURED" || code === PROVIDER_NOT_CONFIGURED_CODE) {
    const { body } = toHttpErrorBody(appErr);
    return { status: 503, body };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────────────
// Preview handler.
// ────────────────────────────────────────────────────────────────────────

const previewBodySchema = z.object({
  projectId: z.string().min(1, "projectId is required."),
  planMarkdown: z.string().min(1, "planMarkdown is required."),
  filename: z.string().optional(),
  contentType: z.string().optional(),
});

export async function handlePlanUploadPreview(req: Request, res: Response): Promise<void> {
  const correlationId = (req as Request & { correlationId?: string }).correlationId;
  try {
    // 1. Body schema (presence + types).
    const parsed = safeParseTool("plan_upload_preview", previewBodySchema, req.body ?? {});
    if (!parsed.ok) {
      const { status, body } = toHttpErrorBody(parsed.error);
      res.status(status).json(body);
      return;
    }
    const { projectId, planMarkdown, contentType } = parsed.data;

    // 2. Size + MIME — these need their own status codes (413/415) so
    //    the front-end can render a tailored error toast.
    assertPlanBytes(planMarkdown, contentType);

    // 3. Project must exist.
    const project = await db.getProject(projectId);
    if (!project) {
      throw new NotFoundError(`Project not found: ${projectId}`, {
        hint: "Call project_view(action='list') to confirm the id.",
      });
    }

    // 4. LLM availability — return 503 if provider=none.
    await assertLlmConfigured();

    // 5. Parse plan via LLM.
    const agentResult = await runAgentWorkflow({
      workflow: WORKFLOW_MODULES.ingest_plan,
      inputs: { planMarkdown, projectName: project.name },
      projectId,
      correlationId,
    });
    const payload = agentResult.object as ParsedPlanPayload;

    // 6. Defensive re-validate the tree.
    validateTaskTree(payload.tasks);

    // 7. Stash in preview cache.
    const previewId = randomUUID();
    const now = Date.now();
    previewCache.set(previewId, {
      projectId,
      payload,
      expiresAt: now + PLAN_UPLOAD_PREVIEW_TTL_MS,
      createdAt: now,
    });
    log.info(
      { previewId, projectId, taskCount: payload.tasks.length, correlationId },
      "plan upload preview ready"
    );

    res.status(200).json({
      previewId,
      projectId,
      group: payload.group ?? null,
      tasks: payload.tasks,
      expiresAt: new Date(now + PLAN_UPLOAD_PREVIEW_TTL_MS).toISOString(),
    });
  } catch (err) {
    const unavailable = llmUnavailableHttp(err);
    if (unavailable) {
      res.status(unavailable.status).json(unavailable.body);
      return;
    }
    if (err instanceof WorkflowQuotaError) {
      const { body } = toHttpErrorBody(err);
      res.status(503).json(body);
      return;
    }
    log.warn({ err: (err as Error)?.message, correlationId }, "plan upload preview failed");
    const { status, body } = toHttpErrorBody(err);
    res.status(status).json(body);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Commit handler.
// ────────────────────────────────────────────────────────────────────────

const editTaskShape = z.object({
  index: z.number().int().nonnegative(),
  drop: z.boolean().optional(),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  verificationCriteria: z.string().optional(),
});

const commitBodySchema = z.object({
  previewId: z.string().min(1),
  projectId: z.string().min(1),
  edits: z
    .object({
      group: z
        .object({
          drop: z.boolean().optional(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
        })
        .optional(),
      tasks: z.array(editTaskShape).optional(),
    })
    .optional(),
});

interface CommitResultBody {
  groupId: string | null;
  taskIds: string[];
  insertedCount: number;
  droppedIndices: number[];
}

/** Apply caller-supplied edits to the preview payload (pure). */
export function applyPlanEdits(
  payload: ParsedPlanPayload,
  edits: z.infer<typeof commitBodySchema>["edits"]
): ParsedPlanPayload {
  if (!edits) return payload;

  let group = payload.group;
  if (edits.group) {
    if (edits.group.drop) {
      group = undefined;
    } else if (group) {
      group = {
        name: edits.group.name ?? group.name,
        description: edits.group.description ?? group.description,
      };
    } else if (edits.group.name) {
      group = { name: edits.group.name, description: edits.group.description };
    }
  }

  // Apply per-task patches by index, then drop and re-thread parentIndex.
  const patched = payload.tasks.map((t) => ({ ...t }));
  const dropSet = new Set<number>();
  for (const patch of edits.tasks ?? []) {
    if (patch.index >= patched.length) {
      throw new ValidationError(
        `edits.tasks[*].index ${patch.index} is out of range (have ${patched.length} tasks).`,
        { hint: "Re-fetch the preview before committing." }
      );
    }
    if (patch.drop) {
      dropSet.add(patch.index);
      continue;
    }
    const t = patched[patch.index];
    if (patch.name) t.name = patch.name;
    if (patch.description) t.description = patch.description;
    if (patch.verificationCriteria !== undefined) {
      t.verificationCriteria = patch.verificationCriteria;
    }
  }

  // Re-thread parentIndex / dependsOnPreviousIndex through the dropped indices.
  // If a parent is dropped, drop all its children too (they'd dangle).
  const closed = new Set<number>(dropSet);
  let grew = true;
  while (grew) {
    grew = false;
    for (let i = 0; i < patched.length; i += 1) {
      if (closed.has(i)) continue;
      const t = patched[i];
      if (t.parentIndex !== undefined && closed.has(t.parentIndex)) {
        closed.add(i);
        grew = true;
      }
    }
  }

  // Build the survivor list and an old→new index map.
  const remap: Record<number, number> = {};
  const survivors: ParsedPlanTask[] = [];
  for (let i = 0; i < patched.length; i += 1) {
    if (closed.has(i)) continue;
    remap[i] = survivors.length;
    survivors.push(patched[i]);
  }
  for (const t of survivors) {
    if (t.parentIndex !== undefined) t.parentIndex = remap[t.parentIndex];
  }

  return { group, tasks: survivors };
}

export async function handlePlanUploadCommit(req: Request, res: Response): Promise<void> {
  const correlationId = (req as Request & { correlationId?: string }).correlationId;
  try {
    const parsed = safeParseTool("plan_upload_commit", commitBodySchema, req.body ?? {});
    if (!parsed.ok) {
      const { status, body } = toHttpErrorBody(parsed.error);
      res.status(status).json(body);
      return;
    }
    const { previewId, projectId, edits } = parsed.data;

    // LLM-availability check — keeps the commit route symmetrical with
    // preview. Provider=none means the preview cache shouldn't exist,
    // but explicitly returning 503 avoids leaking cache state.
    await assertLlmConfigured();

    const entry = previewCache.get(previewId);
    if (!entry) {
      // 410 Gone is the precise code for an evicted preview — the
      // caller can retry the preview step.
      throw new AppError("NOT_FOUND", 410, "Preview not found or expired.", {
        hint: "Re-upload the plan to /api/plan/upload/preview to refresh the previewId.",
        details: { code: "PREVIEW_EXPIRED", previewId },
      });
    }
    if (entry.expiresAt <= Date.now()) {
      previewCache.delete(previewId);
      throw new AppError("NOT_FOUND", 410, "Preview not found or expired.", {
        hint: "Re-upload the plan to /api/plan/upload/preview to refresh the previewId.",
        details: { code: "PREVIEW_EXPIRED", previewId },
      });
    }
    if (entry.projectId !== projectId) {
      throw new ValidationError(
        `previewId belongs to a different project (preview=${entry.projectId}, body=${projectId}).`,
        { details: { code: "PROJECT_MISMATCH" } }
      );
    }

    const project = await db.getProject(projectId);
    if (!project) {
      throw new NotFoundError(`Project not found: ${projectId}`);
    }

    // Apply edits and re-validate before writing.
    const finalPayload = applyPlanEdits(entry.payload, edits);
    validateTaskTree(finalPayload.tasks);

    // Drop preview before the writes — if the commit fails the caller
    // gets a clean error and a fresh preview, not a half-applied state.
    previewCache.delete(previewId);

    const dropped = entry.payload.tasks.length - finalPayload.tasks.length;

    const result = await db.runInTransaction<CommitResultBody>(async () => {
      let groupRecord: TaskGroup | null = null;
      if (finalPayload.group) {
        groupRecord = await db.createGroup({
          projectId,
          name: finalPayload.group.name,
          description: finalPayload.group.description,
        });
      }

      // Pre-allocate ids so `dependsOnPreviousIndex` can resolve
      // against any predecessor regardless of insert order. Parents
      // still go in first to avoid an FK violation on `parent_task_id`.
      const taskIds: string[] = finalPayload.tasks.map(() => uuidv4());
      const now = new Date();

      const writeOne = async (i: number) => {
        const t = finalPayload.tasks[i];
        const deps: TaskDependency[] = [];
        if (t.dependsOnPreviousIndex && i > 0) {
          deps.push({ taskId: taskIds[i - 1] });
        }
        const task: Task = {
          id: taskIds[i],
          name: t.name,
          description: t.description,
          status: TaskStatus.PENDING,
          dependencies: deps,
          createdAt: now,
          updatedAt: now,
          projectId,
          verificationCriteria: t.verificationCriteria,
          groupId: groupRecord?.id,
          ...(t.parentIndex !== undefined ? { parentTaskId: taskIds[t.parentIndex] } : {}),
        };
        await db.saveTask(task);
      };

      // Two passes by parent/child role so parent rows exist before
      // FK-referencing child rows hit `tasks.parent_task_id`.
      for (let i = 0; i < finalPayload.tasks.length; i += 1) {
        if (finalPayload.tasks[i].parentIndex === undefined) await writeOne(i);
      }
      for (let i = 0; i < finalPayload.tasks.length; i += 1) {
        if (finalPayload.tasks[i].parentIndex !== undefined) await writeOne(i);
      }

      return {
        groupId: groupRecord?.id ?? null,
        taskIds,
        insertedCount: taskIds.length,
        droppedIndices: Array.from({ length: dropped }, (_, k) => k),
      };
    });

    log.info(
      {
        previewId,
        projectId,
        groupId: result.groupId,
        insertedCount: result.insertedCount,
        correlationId,
      },
      "plan upload commit completed"
    );
    res.status(200).json(result);
  } catch (err) {
    const unavailable = llmUnavailableHttp(err);
    if (unavailable) {
      res.status(unavailable.status).json(unavailable.body);
      return;
    }
    log.warn({ err: (err as Error)?.message, correlationId }, "plan upload commit failed");
    const { status, body } = toHttpErrorBody(err);
    res.status(status).json(body);
  }
}
