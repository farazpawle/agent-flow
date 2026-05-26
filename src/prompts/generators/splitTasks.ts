/**
 * splitTasks prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";
import { Task } from "../../types/index.js";

/**
 * splitTasks prompt parameter interface
 */
export interface SplitTasksPromptParams {
  globalAnalysisResult?: string;
  memoryDir?: string;
  updateMode: "append" | "overwrite" | "selective" | "clearAllTasks";
  tasks?: Task[];
  allTasks?: Task[];
  createdTasks?: Task[];
  syncStats?: { created: number; updated: number; deleted: number };
}

function buildSplitPrompt(params: SplitTasksPromptParams, promptKey: string): string {
  const indexTemplate = loadPromptFromTemplate("splitTasks/index.md");

  let tasksContext = "";
  if (params.tasks && params.tasks.length > 0) {
    const taskDetailsTemplate = loadPromptFromTemplate("splitTasks/taskDetails.md");

    // Render each task using the template (one call per task)
    params.tasks.forEach((task, index) => {
      const dependenciesContent =
        task.dependencies && task.dependencies.length > 0
          ? task.dependencies
              .map((dep) => {
                const depTaskName =
                  params.tasks?.find((t) => t.id === dep.taskId)?.name || dep.taskId;
                return `\`${depTaskName}\``;
              })
              .join(", ")
          : "none";

      tasksContext += generatePrompt(taskDetailsTemplate, {
        index: (index + 1).toString(),
        name: task.name,
        id: task.id,
        description: task.description,
        notes: task.notes || "",
        implementationGuide: task.implementationGuide || "",
        verificationCriteria: task.verificationCriteria || "",
        dependencies: dependenciesContent,
      });
      tasksContext += "\n";
    });
  }

  const stats = params.syncStats;
  const syncSummary = stats
    ? `✅ **${stats.created}** created | 🔄 **${stats.updated}** updated | 🗑️ **${stats.deleted}** deleted`
    : "";

  const prompt = generatePrompt(indexTemplate, {
    globalAnalysisResult: params.globalAnalysisResult,
    tasksContext,
    updateMode: params.updateMode,
    memoryDir: params.memoryDir,
    syncSummary,
  });

  // Load possible custom prompt
  return loadPrompt(prompt, promptKey);
}

/**
 * Get the complete splitTasks prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getSplitTasksPrompt(params: SplitTasksPromptParams): string {
  return buildSplitPrompt(params, "SPLIT_TASKS");
}
