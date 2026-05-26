import { generatePrompt, loadPromptFromTemplate } from "../../prompts/index.js";

export function renderTaskToolMessage(templatePath: string, params: Record<string, unknown> = {}) {
  return generatePrompt(loadPromptFromTemplate(templatePath), params);
}
