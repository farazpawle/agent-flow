/**
 * completeTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { loadPrompt, generatePrompt, loadPromptFromTemplate, } from "../loader.js";
/**
 * Get the complete completeTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getCompleteTaskPrompt(params) {
    const { task, summary } = params;
    const indexTemplate = loadPromptFromTemplate("completeTask/index.md");
    // Start building the base prompt
    let prompt = generatePrompt(indexTemplate, {
        taskName: task.name,
        taskId: task.id,
        taskDescription: task.description,
        summary: summary || "",
    });
    // Load possible custom prompt
    return loadPrompt(prompt, "COMPLETE_TASK");
}
//# sourceMappingURL=completeTask.js.map