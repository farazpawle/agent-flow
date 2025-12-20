/**
 * executeTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { Task } from "../../types/index.js";
/**
 * Task complexity assessment interface
 */
interface ComplexityAssessment {
    level: string;
    metrics: {
        descriptionLength: number;
        dependenciesCount: number;
    };
    recommendations?: string[];
}
/**
 * executeTask prompt parameter interface
 */
export interface ExecuteTaskPromptParams {
    task: Task;
    complexityAssessment?: ComplexityAssessment;
    relatedFilesSummary?: string;
    dependencyTasks?: Task[];
}
/**
 * Get the complete executeTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getExecuteTaskPrompt(params: ExecuteTaskPromptParams): string;
export {};
