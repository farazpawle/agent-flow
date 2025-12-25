/**
 * analyzeIdea prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import {
  loadPrompt,
  generatePrompt,
  loadPromptFromTemplate,
} from "../loader.js";

/**
 * analyzeIdea prompt parameter interface
 */
export interface AnalyzeIdeaPromptParams {
  summary: string;
  initialConcept: string;
  previousAnalysis?: string;
}

/**
 * Get the complete analyzeIdea prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getAnalyzeTaskPrompt(params: AnalyzeIdeaPromptParams): string {
  // NOTE: Export name kept as getAnalyzeTaskPrompt temporarily for compatibility
  const indexTemplate = loadPromptFromTemplate("analyzeIdea/index.md");

  const iterationTemplate = loadPromptFromTemplate("analyzeIdea/iteration.md");

  let iterationPrompt = "";
  if (params.previousAnalysis) {
    iterationPrompt = generatePrompt(iterationTemplate, {
      previousAnalysis: params.previousAnalysis,
    });
  }

  let prompt = generatePrompt(indexTemplate, {
    summary: params.summary,
    initialConcept: params.initialConcept,
    iterationPrompt: iterationPrompt,
  });

  return loadPrompt(prompt, "ANALYZE_IDEA");
}
