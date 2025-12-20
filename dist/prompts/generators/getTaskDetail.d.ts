/**
 * getTaskDetail prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * getTaskDetail prompt parameter interface
 */
export interface GetTaskDetailPromptParams {
    taskId: string;
    error?: string;
    task?: Task;
    relatedFilesSummary?: string;
}
/**
 * Get the complete getTaskDetail prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getTaskDetailPrompt(params: GetTaskDetailPromptParams): string;
