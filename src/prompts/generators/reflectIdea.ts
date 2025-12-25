/**
 * reflectIdea prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import {
  loadPrompt,
  generatePrompt,
  loadPromptFromTemplate,
} from "../loader.js";

/**
 * reflectIdea prompt parameter interface
 */
export interface ReflectIdeaPromptParams {
  summary: string;
  analysis: string;
}

/**
 * Get complete reflectIdea prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getReflectTaskPrompt(params: ReflectIdeaPromptParams): string {
  // NOTE: Export name kept as getReflectTaskPrompt temporarily for compatibility
  const indexTemplate = loadPromptFromTemplate("reflectIdea/index.md");
  const prompt = generatePrompt(indexTemplate, {
    summary: params.summary,
    analysis: params.analysis,
  });

  return loadPrompt(prompt, "REFLECT_IDEA");
}
