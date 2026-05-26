/**
 * getTaskDetail prompt generator
 * Responsible for combining templates and parameters into the final prompt
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";
import { Task } from "../../types/index.js";

/**
 * getTaskDetail prompt parameter interface
 */
export interface GetTaskDetailPromptParams {
  taskId: string;
  error?: string;
  task?: Task;
  relatedFilesSummary?: string;
  allTasks?: Task[];
}

/**
 * Get the complete getTaskDetail prompt
 * @param params prompt parameters
 * @returns generated prompt
 */
export function getTaskDetailPrompt(params: GetTaskDetailPromptParams): string {
  const { taskId, error, task, relatedFilesSummary, allTasks } = params;

  // If there's an error, show error message
  if (error) {
    const errorTemplate = loadPromptFromTemplate("getTaskDetail/error.md");
    return generatePrompt(errorTemplate, {
      taskId,
      error,
    });
  }

  // If task not found, show task not found message
  if (!task) {
    const notFoundTemplate = loadPromptFromTemplate("getTaskDetail/notFound.md");
    return generatePrompt(notFoundTemplate, {
      taskId,
    });
  }

  // Process task files if available
  let filesContentPrompt = "";
  const filesTemplate = loadPromptFromTemplate("getTaskDetail/relatedFiles.md"); // Moved this line

  if (relatedFilesSummary) {
    filesContentPrompt = generatePrompt(filesTemplate, {
      relatedFilesSummary,
    });
  }

  // Process task implementation guide if available
  let implementationGuidePrompt = "";
  if (task.implementationGuide) {
    const implementationGuideTemplate = loadPromptFromTemplate(
      "getTaskDetail/implementationGuide.md"
    );
    implementationGuidePrompt = generatePrompt(implementationGuideTemplate, {
      implementationGuide: task.implementationGuide,
    });
  }

  // Process task verification criteria if available
  let verificationCriteriaPrompt = "";
  if (task.verificationCriteria) {
    const verificationCriteriaTemplate = loadPromptFromTemplate(
      "getTaskDetail/verificationCriteria.md"
    );
    verificationCriteriaPrompt = generatePrompt(verificationCriteriaTemplate, {
      verificationCriteria: task.verificationCriteria,
    });
  }

  // Process task notes if available
  let notesPrompt = "";
  if (task.notes) {
    const notesTemplate = loadPromptFromTemplate("getTaskDetail/notes.md");
    notesPrompt = generatePrompt(notesTemplate, {
      notes: task.notes,
    });
  }

  // Process task summary if completed
  let summaryPrompt = "";
  if (task.completedAt && task.summary) {
    const summaryTemplate = loadPromptFromTemplate("getTaskDetail/completedSummary.md");
    summaryPrompt = generatePrompt(summaryTemplate, {
      summary: task.summary || "*No completion summary*",
    });
  }

  // Process task dependencies if available
  let dependenciesPrompt = "";
  if (task.dependencies && task.dependencies.length > 0) {
    const depsTemplate = loadPromptFromTemplate("getTaskDetail/dependencies.md");
    const taskMap = new Map((allTasks || []).map((t) => [t.id, t.name]));
    const depsList = task.dependencies
      .map((d) => {
        const name = taskMap.get(d.taskId);
        return name ? `\`${name}\` (\`${d.taskId}\`)` : `\`${d.taskId}\``;
      })
      .join(", ");
    dependenciesPrompt = generatePrompt(depsTemplate, {
      dependencies: depsList,
    });
  }

  // Start building the base prompt
  const indexTemplate = loadPromptFromTemplate("getTaskDetail/index.md");

  const prompt = generatePrompt(indexTemplate, {
    id: task.id,
    name: task.name,
    description: task.description,
    status: task.status,
    createdTime: task.createdAt ? task.createdAt.toLocaleString() : "unknown",
    updatedTime: task.updatedAt ? task.updatedAt.toLocaleString() : "unknown",
    notesTemplate: notesPrompt,
    dependenciesTemplate: dependenciesPrompt,
    implementationGuideTemplate: implementationGuidePrompt,
    verificationCriteriaTemplate: verificationCriteriaPrompt,
    complatedSummaryTemplate: summaryPrompt,
    relatedFilesTemplate: filesContentPrompt,
  });

  // Load possible custom prompt
  return loadPrompt(prompt, "GET_TASK_DETAIL");
}
