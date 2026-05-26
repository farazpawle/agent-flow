import { EventEmitter } from "events";

export const taskEvents = new EventEmitter();

export const TASK_EVENTS = {
  UPDATED: "updated",
  // Phase 1 Group 8.3 — deprecation shims emit this event so the GUI
  // activity log (over SSE) can surface a warning row whenever an
  // agent calls a deprecated tool name.
  DEPRECATION: "deprecation",
};

export interface DeprecationEventPayload {
  tool: string; // e.g. "verify_task"
  replacement: string; // e.g. "task_lifecycle(action='request_review')"
  removalVersion: string; // see DEPRECATION_REMOVAL_VERSION
  taskId?: string;
  correlationId?: string;
  at: string; // ISO timestamp
}
