import { v4 as uuidv4 } from "uuid";
import { db } from "./db.js";

// Step Types
export type WorkflowStepType =
    | "PLAN"
    | "ANALYZE"
    | "REFLECT"
    | "SPECIFICATION"
    | "DECISION";

export interface WorkflowStep {
    id: string;
    projectId: string;
    taskId?: string;
    stepType: WorkflowStepType;
    content: string;
    previousStepId?: string;
    createdAt: Date;
}

/**
 * Save a new workflow step
 */
export async function createStep(
    projectId: string,
    stepType: WorkflowStepType,
    content: string,
    taskId?: string,
    previousStepId?: string
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
        createdAt
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

    const match = sorted.find(s => {
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
