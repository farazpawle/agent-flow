/**
 * completeTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";
import { Task } from "../../types/index.js";

/**
 * completeTask prompt parameter interface
 */
export interface CompleteTaskPromptParams {
  task: Task;
  summary?: string;
  completionTime?: string;
}

/**
 * Get the complete completeTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getCompleteTaskPrompt(params: CompleteTaskPromptParams): string {
  const { task, summary, completionTime } = params;

  const indexTemplate = loadPromptFromTemplate("completeTask/index.md");

  const noSummaryWarning =
    !summary || summary.trim() === ""
      ? "⚠️ **No completion summary provided.** It is recommended to include a brief summary of what was done for future reference and dependency tracking."
      : "";

  const prompt = generatePrompt(indexTemplate, {
    name: task.name,
    id: task.id,
    taskDescription: task.description,
    summary: summary || "",
    completionTime: completionTime || new Date().toLocaleString(),
    noSummaryWarning,
  });

  // Load possible custom prompt
  return loadPrompt(prompt, "COMPLETE_TASK");
}
