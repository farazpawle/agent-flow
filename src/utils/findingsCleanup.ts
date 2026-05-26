/**
 * Findings retention job.
 *
 * Phase 1 (Group 1.9): when `FINDINGS_RETENTION_DAYS` is set to a positive
 * integer, schedule a nightly cleanup that deletes rows from
 * `task_findings` whose `created_at` is older than the threshold.
 *
 * Leaving the env var unset (or non-positive) keeps findings forever and
 * the job is never started.
 */

import type { DatabaseAdapter } from "../models/interfaces.js";
import { logger } from "./logger.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_INTERVAL_MS = ONE_DAY_MS;

let timer: ReturnType<typeof setInterval> | null = null;
let lastConfig: { retentionDays: number; intervalMs: number } | null = null;

/**
 * Parse the configured retention in days. Returns `null` when disabled.
 */
export function parseRetentionDays(rawValue: string | undefined): number | null {
  if (rawValue === undefined || rawValue === null) return null;
  const trimmed = String(rawValue).trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Run a single cleanup pass. Exported for tests so the schedule does not
 * need to fire to validate behaviour.
 */
export async function runFindingsCleanupOnce(
  db: Pick<DatabaseAdapter, "deleteFindingsOlderThan">,
  retentionDays: number,
  now: number = Date.now()
): Promise<number> {
  if (retentionDays <= 0) return 0;
  const cutoffMs = now - retentionDays * ONE_DAY_MS;
  const deleted = await db.deleteFindingsOlderThan(cutoffMs);
  if (deleted > 0) {
    logger.info({ deleted, retentionDays, cutoffMs }, "findings retention cleanup removed rows");
  }
  return deleted;
}

/**
 * Start the recurring cleanup. Idempotent: a second call replaces the
 * existing timer. Returns the resolved config or `null` when disabled.
 *
 * @param intervalMs — override scheduler cadence (default 24h). Tests use
 *   a small value to exercise the timer without waiting a day.
 */
export function startFindingsCleanup(
  db: Pick<DatabaseAdapter, "deleteFindingsOlderThan">,
  options?: { retentionDays?: number | null; intervalMs?: number }
): { retentionDays: number; intervalMs: number } | null {
  const retentionDays =
    options?.retentionDays ?? parseRetentionDays(process.env.FINDINGS_RETENTION_DAYS);

  if (retentionDays == null || retentionDays <= 0) {
    stopFindingsCleanup();
    return null;
  }

  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  stopFindingsCleanup();

  lastConfig = { retentionDays, intervalMs };

  // Kick a cleanup off the loop immediately so the first sweep does not
  // wait a full interval after startup. Errors are logged, never thrown.
  void runFindingsCleanupOnce(db, retentionDays).catch((err) =>
    logger.error({ err }, "findings retention cleanup failed (initial run)")
  );

  timer = setInterval(() => {
    void runFindingsCleanupOnce(db, retentionDays).catch((err) =>
      logger.error({ err }, "findings retention cleanup failed")
    );
  }, intervalMs);

  // Don't keep the event loop alive solely for the cleanup timer.
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref?: () => void }).unref?.();
  }

  logger.info({ retentionDays, intervalMs }, "findings retention cleanup scheduled");
  return lastConfig;
}

export function stopFindingsCleanup(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  lastConfig = null;
}

export function getFindingsCleanupConfig(): { retentionDays: number; intervalMs: number } | null {
  return lastConfig;
}
