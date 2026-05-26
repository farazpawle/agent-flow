/**
 * generateRoadmap prompt generator
 * Produces roadmap guidance with strict mandatory sections for structured planning.
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";

export interface GenerateRoadmapPromptParams {
  summary: string;
  analysis?: string;
  context?: string;
  flowMode?: "fast" | "structured";
}

export function getGenerateRoadmapPrompt(params: GenerateRoadmapPromptParams): string {
  const indexTemplate = loadPromptFromTemplate("generateRoadmap/index.md");

  const prompt = generatePrompt(indexTemplate, {
    summary: params.summary,
    analysis: params.analysis || "No explicit analysis provided.",
    context: params.context || "No additional context provided.",
    flowMode: params.flowMode || "structured",
  });

  return loadPrompt(prompt, "GENERATE_ROADMAP");
}
