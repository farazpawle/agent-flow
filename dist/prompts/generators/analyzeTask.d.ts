/**
 * analyzeTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
/**
 * analyzeTask prompt parameter interface
 */
export interface AnalyzeTaskPromptParams {
    summary: string;
    initialConcept: string;
    previousAnalysis?: string;
}
/**
 * Get the complete analyzeTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export declare function getAnalyzeTaskPrompt(params: AnalyzeTaskPromptParams): string;
