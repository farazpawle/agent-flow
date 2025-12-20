/**
 * deleteTask prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */
import { loadPrompt, generatePrompt, loadPromptFromTemplate, } from "../loader.js";
/**
 * Get the complete deleteTask prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getDeleteTaskPrompt(params) {
    const { taskId, task, isTaskCompleted, isSuccess, success, error, taskNotFound, message } = params;
    // Handle case where task doesn't exist
    if (taskNotFound) {
        const notFoundTemplate = loadPromptFromTemplate("deleteTask/notFound.md");
        return generatePrompt(notFoundTemplate, {
            taskId,
        });
    }
    // Handle case where task is already completed
    if (isTaskCompleted) {
        const completedTemplate = loadPromptFromTemplate("deleteTask/completed.md");
        return generatePrompt(completedTemplate, {
            taskId,
            taskName: task?.name || "",
        });
    }
    // Handle case of successful or failed deletion
    const resultTemplate = loadPromptFromTemplate("deleteTask/success.md");
    let prompt = generatePrompt(resultTemplate, {
        taskId,
        taskName: task?.name || "",
        isSuccess: isSuccess || success || false,
        error: error || "",
        message: message || "",
    });
    // Load possible custom prompt
    return loadPrompt(prompt, "DELETE_TASK");
}
//# sourceMappingURL=deleteTask.js.map