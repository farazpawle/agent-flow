/**
 * Destructive audit log writer (Phase 1 Group 6.3).
 *
 * Persists to the dedicated `destructive_audits` table (no FK cascade,
 * so audit rows outlive the projects/tasks they describe). Writing
 * never throws — losing a single audit record is preferable to blocking
 * the destructive operation it described; production catches sustained
 * failures via the structured logger.
 */

import { v4 as uuidv4 } from "uuid";
import { db } from "../models/db.js";
import { logger } from "./logger.js";
import { getCurrentCaller } from "./callerContext.js";

export interface DestructiveAuditEntry {
  /** Tool that authored the audit (e.g. `"project_delete"`). */
  tool: string;
  /** Project whose row is being deleted, or the parent of deleted tasks. */
  projectId: string;
  /** Why the caller asked us to delete (validated upstream against min-length). */
  reason: string;
  /** Every id that the execute branch removed. */
  affectedIds: string[];
  /** Free-form bag of action-specific metadata (e.g. `{ action: "delete_many" }`). */
  metadata?: Record<string, unknown>;
  /** Optional correlation id for cross-row tracing. */
  correlationId?: string;
}

export async function writeDestructiveAudit(entry: DestructiveAuditEntry): Promise<void> {
  const callerFrame = getCurrentCaller();
  try {
    await db.appendDestructiveAudit({
      id: uuidv4(),
      tool: entry.tool,
      projectId: entry.projectId,
      reason: entry.reason,
      affectedIds: entry.affectedIds,
      invokedBy: callerFrame ? callerFrame.tool : "direct",
      metadata: entry.metadata,
      correlationId: entry.correlationId,
      createdAt: new Date(),
    });
  } catch (err) {
    logger.error({ err, entry }, "destructive audit write failed — operation already executed");
  }
}
