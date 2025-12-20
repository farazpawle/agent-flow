/**
 * verifyTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * verifyTask prompt parameter interface
 */
export interface VerifyTaskPromptParams {
    task: Task;
}
/**
 * Get the complete prompt for verifyTask
 * @param params prompt parameters
 * @returns the generated prompt
 */
export declare function getVerifyTaskPrompt(params: VerifyTaskPromptParams): string;
