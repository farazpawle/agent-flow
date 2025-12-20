/**
 * splitTasks prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * splitTasks prompt parameter interface
 */
export interface SplitTasksPromptParams {
    globalAnalysisResult?: string;
    memoryDir?: string;
    updateMode: "append" | "overwrite" | "selective" | "clearAllTasks";
    tasks?: Task[];
    allTasks?: Task[];
    createdTasks?: Task[];
}
/**
 * Get the complete splitTasks prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getSplitTasksPrompt(params: SplitTasksPromptParams): string;
