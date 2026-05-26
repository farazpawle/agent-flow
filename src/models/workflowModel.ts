import { v4 as uuidv4 } from "uuid";
import { db } from "./db.js";

// Step Types
export type WorkflowStepType =
  | "PLAN"
  | "ANALYZE"
  | "REFLECT"
  | "SPECIFICATION"
  | "DECISION"
  // Phase 2 Group 14.5 — append a row per provider call so audits
  // can answer "which model handled which workflow at what cost".
  | "LLM_CALL";

export interface WorkflowStep {
  id: string;
  projectId: string;
  taskId?: string;
  stepType: WorkflowStepType;
  content: string;
  previousStepId?: string;
  createdAt: Date;

  // Telemetry (Tier 2.2) — optional, populated when the step was
  // produced by an instrumented tool invocation.
  toolName?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  outcome?: "success" | "error";
  errorCode?: string;
  correlationId?: string;
}

/**
 * Optional telemetry fields a caller can attach to a workflow step.
 * All fields are optional; supply only what you have.
 */
export interface WorkflowStepTelemetry {
  toolName?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  outcome?: "success" | "error";
  errorCode?: string;
  correlationId?: string;
}

/**
 * Save a new workflow step. Pass `telemetry` to record per-tool
 * timings and outcome alongside the step content.
 */
export async function createStep(
  projectId: string,
  stepType: WorkflowStepType,
  content: string,
  taskId?: string,
  previousStepId?: string,
  telemetry?: WorkflowStepTelemetry
): Promise<WorkflowStep> {
  const id = uuidv4();
  const createdAt = new Date();

  const step: WorkflowStep = {
    id,
    projectId,
    stepType,
    content,
    taskId,
    previousStepId,
    createdAt,
    ...telemetry,
  };

  await db.createWorkflowStep(step);

  return step;
}

/**
 * Get a step by ID
 */
export async function getStepById(id: string): Promise<WorkflowStep | null> {
  return await db.getWorkflowStep(id);
}

/**
 * Find the latest step of a specific type for a project (and optionally task)
 */
export async function findLatestStep(
  projectId: string,
  stepType: WorkflowStepType,
  taskId?: string
): Promise<WorkflowStep | null> {
  const steps = await db.getWorkflowSteps(projectId);

  // Sort descending by date
  // (Adapter returns ASC, so reverse)
  const sorted = [...steps].reverse();

  const match = sorted.find((s) => {
    if (s.stepType !== stepType) return false;
    if (taskId) return s.taskId === taskId;
    return !s.taskId; // if taskId not in query but in step, mismatch? Or global check? Logic says AND taskId IS NULL.
  });

  return match || null;
}

/**
 * Get workflow history for a project
 */
export async function getWorkflowHistory(projectId: string): Promise<WorkflowStep[]> {
  return await db.getWorkflowSteps(projectId);
}
