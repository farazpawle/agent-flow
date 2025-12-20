/**
 * listTasks prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * listTasks prompt parameter interface
 */
export interface ListTasksPromptParams {
    status: string;
    tasks: Record<string, Task[]>;
    allTasks: Task[];
}
/**
 * Get the complete listTasks prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getListTasksPrompt(params: ListTasksPromptParams): string;
