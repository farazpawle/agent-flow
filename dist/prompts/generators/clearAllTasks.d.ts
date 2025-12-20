/**
 * clearAllTasks prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
/**
 * clearAllTasks prompt parameter interface
 */
export interface ClearAllTasksPromptParams {
    confirm?: boolean;
    success?: boolean;
    message?: string;
    backupFile?: string;
    isEmpty?: boolean;
}
/**
 * Get complete clearAllTasks prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getClearAllTasksPrompt(params: ClearAllTasksPromptParams): string;
