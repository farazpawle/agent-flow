/**
 * findTask prompt generator
 * Handles both exact UUID lookup (full detail) and keyword search results
 */

import { loadPrompt, generatePrompt, loadPromptFromTemplate } from "../loader.js";
import { Task } from "../../types/index.js";

export interface FindTaskPromptParams {
  query: string;
  isId: boolean;
  tasks: Task[];
  allTasks?: Task[];
  totalTasks: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Get the complete findTask prompt.
 * When isId=true → renders full task detail (like getTaskDetail).
 * When isId=false → renders keyword search results (like queryTask).
 */
export function getFindTaskPrompt(params: FindTaskPromptParams): string {
  const { query, isId, tasks, allTasks, totalTasks, page, pageSize, totalPages } = params;

  if (isId) {
    // --- Full detail view ---
    const task = tasks[0];

    if (!task) {
      const notFoundTemplate = loadPromptFromTemplate("findTask/notFound.md");
      return generatePrompt(notFoundTemplate, { taskId: query });
    }

    // Process related files
    let filesContentPrompt = "";
    const filesTemplate = loadPromptFromTemplate("findTask/relatedFiles.md");
    if (task.relatedFiles && task.relatedFiles.length > 0) {
      const relatedFilesSummary = task.relatedFiles
        .map((f) => `- \`${f.path}\` (${f.type})${f.description ? `: ${f.description}` : ""}`)
        .join("\n");
      filesContentPrompt = generatePrompt(filesTemplate, { relatedFilesSummary });
    }

    // Process implementation guide
    let implementationGuidePrompt = "";
    if (task.implementationGuide) {
      const igTemplate = loadPromptFromTemplate("findTask/implementationGuide.md");
      implementationGuidePrompt = generatePrompt(igTemplate, {
        implementationGuide: task.implementationGuide,
      });
    }

    // Process verification criteria
    let verificationCriteriaPrompt = "";
    if (task.verificationCriteria) {
      const vcTemplate = loadPromptFromTemplate("findTask/verificationCriteria.md");
      verificationCriteriaPrompt = generatePrompt(vcTemplate, {
        verificationCriteria: task.verificationCriteria,
      });
    }

    // Process notes
    let notesPrompt = "";
    if (task.notes) {
      const notesTemplate = loadPromptFromTemplate("findTask/notes.md");
      notesPrompt = generatePrompt(notesTemplate, { notes: task.notes });
    }

    // Process completion summary
    let summaryPrompt = "";
    if (task.completedAt && task.summary) {
      const summaryTemplate = loadPromptFromTemplate("findTask/completedSummary.md");
      summaryPrompt = generatePrompt(summaryTemplate, {
        summary: task.summary || "*No completion summary*",
      });
    }

    // Process dependencies
    let dependenciesPrompt = "";
    if (task.dependencies && task.dependencies.length > 0) {
      const depsTemplate = loadPromptFromTemplate("findTask/dependencies.md");
      const taskMap = new Map((allTasks || []).map((t) => [t.id, t.name]));
      const depsList = task.dependencies
        .map((d) => {
          const name = taskMap.get(d.taskId);
          return name ? `\`${name}\` (\`${d.taskId}\`)` : `\`${d.taskId}\``;
        })
        .join(", ");
      dependenciesPrompt = generatePrompt(depsTemplate, { dependencies: depsList });
    }

    const indexTemplate = loadPromptFromTemplate("findTask/index.md");
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

    return loadPrompt(prompt, "FIND_TASK");
  }

  // --- Keyword search results ---
  if (tasks.length === 0) {
    const notFoundTemplate = loadPromptFromTemplate("findTask/searchNotFound.md");
    return generatePrompt(notFoundTemplate, { query });
  }

  const taskDetailsTemplate = loadPromptFromTemplate("findTask/searchTaskDetails.md");
  let tasksContent = "";
  for (const task of tasks) {
    tasksContent += generatePrompt(taskDetailsTemplate, {
      taskId: task.id,
      taskName: task.name,
      taskStatus: task.status,
      taskDescription:
        task.description.length > 100
          ? `${task.description.substring(0, 100)}...`
          : task.description,
      createdAt: new Date(task.createdAt).toLocaleString(),
    });
  }

  const searchIndexTemplate = loadPromptFromTemplate("findTask/searchIndex.md");
  const prompt = generatePrompt(searchIndexTemplate, {
    tasksContent,
    page,
    totalPages,
    pageSize,
    totalTasks,
    query,
  });

  return loadPrompt(prompt, "FIND_TASK");
}
