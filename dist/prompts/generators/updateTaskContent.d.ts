/**
 * updateTaskContent prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * updateTaskContent prompt parameter interface
 */
export interface UpdateTaskContentPromptParams {
    taskId: string;
    task?: Task;
    success?: boolean;
    message?: string;
    validationError?: string;
    emptyUpdate?: boolean;
    updatedTask?: Task;
}
/**
 * Get the complete updateTaskContent prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getUpdateTaskContentPrompt(params: UpdateTaskContentPromptParams): string;
