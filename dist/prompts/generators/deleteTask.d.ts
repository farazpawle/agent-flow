/**
 * deleteTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * deleteTask prompt parameter interface
 */
export interface DeleteTaskPromptParams {
    taskId: string;
    task?: Task;
    isTaskCompleted?: boolean;
    isSuccess?: boolean;
    success?: boolean;
    message?: string;
    error?: string;
    taskNotFound?: boolean;
}
/**
 * Get the complete deleteTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getDeleteTaskPrompt(params: DeleteTaskPromptParams): string;
