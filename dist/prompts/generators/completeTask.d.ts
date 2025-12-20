/**
 * completeTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * completeTask prompt parameter interface
 */
export interface CompleteTaskPromptParams {
    task: Task;
    summary?: string;
    completionTime?: string;
}
/**
 * Get the complete completeTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getCompleteTaskPrompt(params: CompleteTaskPromptParams): string;
