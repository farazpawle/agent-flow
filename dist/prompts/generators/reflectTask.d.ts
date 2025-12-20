/**
 * reflectTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
/**
 * reflectTask prompt parameter interface
 */
export interface ReflectTaskPromptParams {
    summary: string;
    analysis: string;
}
/**
 * Get complete reflectTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getReflectTaskPrompt(params: ReflectTaskPromptParams): string;
