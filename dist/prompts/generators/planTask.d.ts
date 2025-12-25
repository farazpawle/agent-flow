/**
 * planTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * planTask prompt parameter interface
 */
export interface PlanTaskPromptParams {
    description: string;
    requirements?: string;
    existingTasksReference?: boolean;
    completedTasks?: Task[];
    pendingTasks?: Task[];
    memoryDir: string;
    projectId?: string;
    checkDependencies?: boolean;
}
/**
 * Get the complete planTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getPlanTaskPrompt(params: PlanTaskPromptParams): string;
