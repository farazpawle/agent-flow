/**
 * queryTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * queryTask prompt parameter interface
 */
export interface QueryTaskPromptParams {
    query: string;
    isId: boolean;
    tasks: Task[];
    totalTasks: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
/**
 * Get the complete queryTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getQueryTaskPrompt(params: QueryTaskPromptParams): string;
