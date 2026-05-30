/**
 * Plan upload — Wave 3 §10.A.
 *
 * Two-step flow:
 *   1. POST /api/plan/upload/preview — JSON `{ planMarkdown, projectId,
 *      filename?, contentType? }`. LLM runs, no DB writes, returns
 *      `{ previewId, feature?, groups, tasks }`.
 *   2. POST /api/plan/upload/commit  — JSON `{ previewId, projectId, edits? }`.
 *      Wraps the writes in `runInTransaction` (feature-hierarchy):
 *      Feature (parent group) → section Groups → Tasks (each in its group) →
 *      dependency wiring. After the txn, `recalculateTaskOrder` assigns
 *      `executionOrder` so DAG nodes carry real numbers (not `0`).
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
import { recalculateTaskOrder } from "../models/taskModel.js";
import type { Task, TaskDependency } from "../types/index.js";
import { TaskStatus } from "../types/index.js";

/** Default feature name when the plan has no title / the user drops it. */
const DEFAULT_FEATURE_NAME = "Imported plan";

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
  /** Indices of earlier tasks that must finish before this one starts. */
  dependsOnIndexes: number[];
  /** Index into `ParsedPlanPayload.groups` of the section this task belongs to. */
  groupIndex: number;
}

export interface ParsedPlanGroup {
  name: string;
  description?: string;
}

/** The plan's parent group — one Feature per uploaded plan. */
export interface ParsedPlanFeature {
  name: string;
  description?: string;
}

export interface ParsedPlanPayload {
  /** Parent group for the whole plan; defaults to "Imported plan" at commit if absent. */
  feature?: ParsedPlanFeature;
  /** Section groups, in document order. Always at least one. */
  groups: ParsedPlanGroup[];
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

/**
 * Map the strict-mode LLM output (nullable fields) back to the
 * `ParsedPlanPayload` shape used everywhere downstream (optional fields).
 * `ingestPlanOutputSchema` uses `.nullable()` so OpenAI/OpenRouter strict
 * json_schema accepts it; here we collapse `null` → `undefined`.
 */
function normalizeParsedPlan(raw: unknown): ParsedPlanPayload {
  const obj = (raw ?? {}) as {
    feature?: { name: string; description?: string | null } | null;
    groups?: Array<{ name: string; description?: string | null }> | null;
    tasks?: Array<{
      name: string;
      description: string;
      verificationCriteria?: string | null;
      dependsOnIndexes?: number[] | null;
      groupIndex?: number | null;
    }>;
  };
  const feature = obj.feature
    ? { name: obj.feature.name, description: obj.feature.description ?? undefined }
    : undefined;
  const groups = (obj.groups ?? []).map((g) => ({
    name: g.name,
    description: g.description ?? undefined,
  }));
  const tasks = (obj.tasks ?? []).map((t) => ({
    name: t.name,
    description: t.description,
    verificationCriteria: t.verificationCriteria ?? undefined,
    dependsOnIndexes: t.dependsOnIndexes ?? [],
    groupIndex: t.groupIndex ?? 0,
  }));
  return { feature, groups, tasks };
}

/**
 * Defensive re-check after the Zod parse (feature-hierarchy): every task must
 * point at an existing section group, and dependencies must reference EARLIER
 * tasks (no self/forward refs or cycles).
 */
function validatePlanShape(payload: ParsedPlanPayload): void {
  const { groups, tasks } = payload;
  if (tasks.length === 0) {
    throw new ValidationError("ingest_plan produced zero tasks.", {
      hint: "Add at least one actionable item to the uploaded plan.",
    });
  }
  if (groups.length === 0) {
    throw new ValidationError("ingest_plan produced zero groups.", {
      hint: "Every plan needs at least one section group for its tasks.",
      details: { code: "VALIDATION", groups: 0 },
    });
  }
  for (let i = 0; i < tasks.length; i += 1) {
    const t = tasks[i];

    for (const dep of t.dependsOnIndexes) {
      if (dep >= i) {
        throw new ValidationError(
          `Task at index ${i} depends on index ${dep}, which is not earlier in the list.`,
          {
            hint: "Dependencies must point at tasks that appear before this one.",
            details: { code: "VALIDATION", index: i, dependsOnIndex: dep },
          }
        );
      }
    }

    if (!Number.isInteger(t.groupIndex) || t.groupIndex < 0 || t.groupIndex >= groups.length) {
      throw new ValidationError(
        `Task at index ${i} has groupIndex=${t.groupIndex}, out of range [0, ${groups.length - 1}].`,
        {
          hint: "Every task must reference an existing section group.",
          details: {
            code: "VALIDATION",
            index: i,
            groupIndex: t.groupIndex,
            groups: groups.length,
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
    const payload = normalizeParsedPlan(agentResult.object);

    // 6. Defensive re-validate the parsed plan shape.
    validatePlanShape(payload);

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
      feature: payload.feature ?? null,
      groups: payload.groups,
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

const editGroupShape = z.object({
  index: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  description: z.string().optional(),
});

const commitBodySchema = z.object({
  previewId: z.string().min(1),
  projectId: z.string().min(1),
  edits: z
    .object({
      feature: z
        .object({
          drop: z.boolean().optional(),
          name: z.string().min(1).optional(),
          description: z.string().optional(),
        })
        .optional(),
      groups: z.array(editGroupShape).optional(),
      tasks: z.array(editTaskShape).optional(),
    })
    .optional(),
});

interface CommitResultBody {
  featureId: string;
  groupIds: string[];
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

  // ── Feature: rename, or drop → fall back to the default name at commit. ──
  let feature = payload.feature;
  if (edits.feature) {
    if (edits.feature.drop) {
      feature = undefined;
    } else if (feature) {
      feature = {
        name: edits.feature.name ?? feature.name,
        description: edits.feature.description ?? feature.description,
      };
    } else if (edits.feature.name) {
      feature = { name: edits.feature.name, description: edits.feature.description };
    }
  }

  // ── Group renames by index (sections are never dropped directly; an empty
  //    group is pruned below once all its tasks are removed). ──
  const groups = payload.groups.map((g) => ({ ...g }));
  for (const patch of edits.groups ?? []) {
    if (patch.index >= groups.length) {
      throw new ValidationError(
        `edits.groups[*].index ${patch.index} is out of range (have ${groups.length} groups).`,
        { hint: "Re-fetch the preview before committing." }
      );
    }
    const g = groups[patch.index];
    if (patch.name) g.name = patch.name;
    if (patch.description !== undefined) g.description = patch.description;
  }

  // ── Per-task patches + drops. groupIndex points at groups[] (stable across
  //    task drops), so only dependsOnIndexes needs re-threading here. ──
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

  // Build the task survivor list and an old→new task-index map; remap deps.
  const taskRemap: Record<number, number> = {};
  const survivors: ParsedPlanTask[] = [];
  for (let i = 0; i < patched.length; i += 1) {
    if (dropSet.has(i)) continue;
    taskRemap[i] = survivors.length;
    survivors.push(patched[i]);
  }
  for (const t of survivors) {
    t.dependsOnIndexes = t.dependsOnIndexes.filter((d) => !dropSet.has(d)).map((d) => taskRemap[d]);
  }

  // Prune groups left with zero surviving tasks, then re-thread groupIndex
  // through the surviving groups (this is the groupIndex re-threading the
  // feature-hierarchy plan calls for).
  const usedGroups = new Set<number>(survivors.map((t) => t.groupIndex));
  const groupRemap: Record<number, number> = {};
  const survivingGroups: ParsedPlanGroup[] = [];
  for (let g = 0; g < groups.length; g += 1) {
    if (!usedGroups.has(g)) continue;
    groupRemap[g] = survivingGroups.length;
    survivingGroups.push(groups[g]);
  }
  for (const t of survivors) t.groupIndex = groupRemap[t.groupIndex];

  return { feature, groups: survivingGroups, tasks: survivors };
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
    validatePlanShape(finalPayload);

    // Drop preview before the writes — if the commit fails the caller
    // gets a clean error and a fresh preview, not a half-applied state.
    previewCache.delete(previewId);

    const dropped = entry.payload.tasks.length - finalPayload.tasks.length;

    const result = await db.runInTransaction<CommitResultBody>(async () => {
      // 1. Feature — one parent group for the whole plan (parentGroupId omitted
      //    ⇒ stored NULL). Default name when the plan had no title / was dropped.
      const feature = await db.createGroup({
        projectId,
        name: finalPayload.feature?.name ?? DEFAULT_FEATURE_NAME,
        description: finalPayload.feature?.description,
      });

      // 2. Section groups — children of the feature, ordered by document order.
      const sectionGroupIds: string[] = [];
      for (let g = 0; g < finalPayload.groups.length; g += 1) {
        const grp = await db.createGroup({
          projectId,
          name: finalPayload.groups[g].name,
          description: finalPayload.groups[g].description,
          parentGroupId: feature.id,
          executionOrder: g,
        });
        sectionGroupIds.push(grp.id);
      }

      // 3. Tasks — pre-allocate ids so `dependsOnIndexes` resolves against any
      //    earlier task. No parentTaskId from ingest; each task lives in its
      //    section group. A single forward pass suffices since deps only point
      //    at earlier tasks (already written by the time we reach `i`).
      const taskIds: string[] = finalPayload.tasks.map(() => uuidv4());
      const now = new Date();

      for (let i = 0; i < finalPayload.tasks.length; i += 1) {
        const t = finalPayload.tasks[i];
        // de-dupe so a repeated index doesn't create duplicate edges.
        const deps: TaskDependency[] = [...new Set(t.dependsOnIndexes)].map((di) => ({
          taskId: taskIds[di],
        }));
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
          groupId: sectionGroupIds[t.groupIndex],
        };
        await db.saveTask(task);
      }

      return {
        featureId: feature.id,
        groupIds: sectionGroupIds,
        taskIds,
        insertedCount: taskIds.length,
        droppedIndices: Array.from({ length: dropped }, (_, k) => k),
      };
    });

    // After the txn: assign executionOrder so the DAG nodes carry real
    // numbers (root cause #2 — the `0` badge). Outside the txn so a recalc
    // hiccup can't roll back a successful commit.
    try {
      await recalculateTaskOrder(projectId);
    } catch (recalcErr) {
      log.warn(
        { err: (recalcErr as Error)?.message, projectId, correlationId },
        "recalculateTaskOrder after plan commit failed (tasks committed; ordering deferred)"
      );
    }

    log.info(
      {
        previewId,
        projectId,
        featureId: result.featureId,
        groupCount: result.groupIds.length,
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
