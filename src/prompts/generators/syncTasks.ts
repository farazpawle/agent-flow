/**
 * syncTasks prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";
import { Task } from "../../types/index.js";

/**
 * syncTasks prompt parameter interface
 */
export interface SyncTasksPromptParams {
  globalAnalysisResult?: string;
  memoryDir?: string;
  updateMode: "append" | "overwrite" | "selective" | "clearAllTasks";
  flowMode?: "fast" | "structured";
  roadmapDecision?: "proceed" | "reject";
  tasks?: Task[];
  allTasks?: Task[];
  createdTasks?: Task[];
  syncStats?: { created: number; updated: number; deleted: number };
}

function buildSyncPrompt(params: SyncTasksPromptParams, promptKey: string): string {
  const indexTemplate = loadPromptFromTemplate("syncTasks/index.md");

  let tasksContext = "";
  if (params.tasks && params.tasks.length > 0) {
    const taskDetailsTemplate = loadPromptFromTemplate("syncTasks/taskDetails.md");

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
    flowMode: params.flowMode || "fast",
    roadmapDecision: params.roadmapDecision || "N/A",
    memoryDir: params.memoryDir,
    syncSummary,
  });

  // Load possible custom prompt
  return loadPrompt(prompt, promptKey);
}

/**
 * Get the complete syncTasks prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getSyncTasksPrompt(params: SyncTasksPromptParams): string {
  return buildSyncPrompt(params, "SYNC_TASKS");
}
