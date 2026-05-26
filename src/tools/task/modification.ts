import { z } from "zod";
import {
  getTaskById,
  deleteTask as modelDeleteTask,
  getAllTasks,
  updateTaskContent as modelUpdateTaskContent,
} from "../../models/taskModel.js";
import { TaskStatus, RelatedFileType } from "../../types/index.js";
import {
  getDeleteTaskPrompt,
  getUpdateTaskContentPrompt,
  getSplitTasksPrompt,
} from "../../prompts/index.js";
import { deleteTaskSchema, updateTaskContentSchema, splitTasksSchema } from "./schemas.js";

import { validateProjectContext } from "../../utils/projectValidation.js";
import { getStepById } from "../../models/workflowModel.js";
import { batchCreateOrUpdateTasks, getTasksByProject } from "../../models/taskModel.js";
import { renderTaskToolMessage } from "./messageTemplates.js";

export async function deleteTask({
  taskId,
  projectId,
  deleteAll,
  confirm,
}: z.infer<typeof deleteTaskSchema>) {
  // Validate Project Context (Strict Mode)
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  // 1. Bulk Deletion Mode
  if (deleteAll) {
    if (!confirm) {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage(
              "taskToolMessages/modification/deleteAllConfirmRequired.md"
            ),
          },
        ],
        isError: true,
      };
    }

    const allTasks = await getAllTasks(projectValidation.projectId);
    let deleteCount = 0;

    for (const t of allTasks) {
      // In project context, allTasks should be filtered by project, but strict check again just in case
      if (t.projectId === projectValidation.projectId) {
        await modelDeleteTask(t.id);
        deleteCount++;
      }
    }

    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/modification/deleteAllSuccess.md", {
            deleteCount,
            projectId: projectValidation.projectId,
          }),
        },
      ],
    };
  }

  // 2. Single Task Deletion Mode
  if (!taskId) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/modification/deleteTaskIdRequired.md"),
        },
      ],
      isError: true,
    };
  }

  const task = await getTaskById(taskId);

  if (!task) {
    return {
      content: [
        {
          type: "text" as const,
          text: getDeleteTaskPrompt({ taskId }),
        },
      ],
      isError: true,
    };
  }

  if (task.projectId !== projectValidation.projectId) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/common/projectMismatch.md", {
            taskName: task.name,
            taskId,
            taskProjectId: task.projectId,
            activeProjectId: projectValidation.projectId,
          }),
        },
      ],
      isError: true,
    };
  }

  if (task.status === TaskStatus.COMPLETED) {
    return {
      content: [
        {
          type: "text" as const,
          text: getDeleteTaskPrompt({ taskId, task, isTaskCompleted: true }),
        },
      ],
      isError: true,
    };
  }

  const result = await modelDeleteTask(taskId);

  return {
    content: [
      {
        type: "text" as const,
        text: getDeleteTaskPrompt({
          taskId,
          task,
          success: result.success,
          message: result.message,
        }),
      },
    ],
    isError: !result.success,
  };
}

export async function updateTaskContent({
  taskId,
  name,
  description,
  notes,
  relatedFiles,
  dependencies,
  implementationGuide,
  verificationCriteria,
  projectId,
}: z.infer<typeof updateTaskContentSchema>) {
  // Validate Project Context (Strict Mode)
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  if (relatedFiles) {
    for (const file of relatedFiles) {
      if (
        (file.lineStart && !file.lineEnd) ||
        (!file.lineStart && file.lineEnd) ||
        (file.lineStart && file.lineEnd && file.lineStart > file.lineEnd)
      ) {
        return {
          content: [
            {
              type: "text" as const,
              text: getUpdateTaskContentPrompt({
                taskId,
                validationError:
                  "Invalid line number settings: must set both start and end lines, and the start line must be less than the end line",
              }),
            },
          ],
        };
      }
    }
  }

  if (
    !(
      name ||
      description ||
      notes ||
      dependencies ||
      implementationGuide ||
      verificationCriteria ||
      relatedFiles
    )
  ) {
    return {
      content: [
        {
          type: "text" as const,
          text: getUpdateTaskContentPrompt({
            taskId,
            emptyUpdate: true,
          }),
        },
      ],
    };
  }

  // Get the task to check if it exists
  const task = await getTaskById(taskId);

  if (!task) {
    return {
      content: [
        {
          type: "text" as const,
          text: getUpdateTaskContentPrompt({
            taskId,
          }),
        },
      ],
      isError: true,
    };
  }

  if (task.projectId !== projectValidation.projectId) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/common/projectMismatch.md", {
            taskName: task.name,
            taskId,
            taskProjectId: task.projectId,
            activeProjectId: projectValidation.projectId,
          }),
        },
      ],
      isError: true,
    };
  }

  // Record the task and content to be updated
  let updateSummary = `Preparing to update task: ${task.name} (ID: ${task.id})`;
  if (name) updateSummary += `, new name: ${name}`;
  if (description) updateSummary += `, update description`;
  if (notes) updateSummary += `, update notes`;
  if (relatedFiles) updateSummary += `, update related files (${relatedFiles.length})`;
  if (dependencies) updateSummary += `, update dependencies (${dependencies.length})`;
  if (implementationGuide) updateSummary += `, update implementation guide`;
  if (verificationCriteria) updateSummary += `, update verification criteria`;

  // Helper function to map schema strings to RelatedFileType
  const mapFileType = (type: string): RelatedFileType => {
    switch (type) {
      case "create":
        return RelatedFileType.CREATE;
      case "modify":
        return RelatedFileType.TO_MODIFY;
      case "reference":
        return RelatedFileType.REFERENCE;
      case "dependency":
        return RelatedFileType.DEPENDENCY;
      case "test":
        return RelatedFileType.TEST;
      case "document":
        return RelatedFileType.DOCUMENT;
      default:
        return RelatedFileType.OTHER;
    }
  };

  // Execute the update operation
  const result = await modelUpdateTaskContent(taskId, {
    name,
    description,
    notes,
    relatedFiles: relatedFiles?.map((f) => ({
      ...f,
      type: mapFileType(f.type),
    })),
    dependencies,
    implementationGuide,
    verificationCriteria,
  });

  // Compute which fields changed
  const changedFields: string[] = [];
  if (name && name !== task.name) changedFields.push("name");
  if (description && description !== task.description) changedFields.push("description");
  if (notes !== undefined && notes !== task.notes) changedFields.push("notes");
  if (implementationGuide !== undefined && implementationGuide !== task.implementationGuide)
    changedFields.push("implementationGuide");
  if (verificationCriteria !== undefined && verificationCriteria !== task.verificationCriteria)
    changedFields.push("verificationCriteria");
  if (relatedFiles !== undefined) changedFields.push("relatedFiles");
  if (dependencies !== undefined) changedFields.push("dependencies");

  return {
    content: [
      {
        type: "text" as const,
        text: getUpdateTaskContentPrompt({
          taskId,
          task,
          success: result.success,
          message: result.message,
          updatedTask: result.task,
          changedFields,
        }),
      },
    ],
    isError: !result.success,
  };
}

export async function splitTasks({
  projectId,
  tasks,
  updateMode,
  inputStepId,
}: z.infer<typeof splitTasksSchema>) {
  // Validate Project Context (Strict Mode)
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  let contextGlobalAnalysis = "";
  let sourceStep: Awaited<ReturnType<typeof getStepById>> | null = null;

  // IF inputStepId is provided, we fetch the REFLECT/SPECIFICATION step content to use as "Global Analysis"
  if (inputStepId) {
    sourceStep = await getStepById(inputStepId);

    if (!sourceStep) {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage(
              "taskToolMessages/modification/syncTasksInputStepNotFound.md",
              { inputStepId }
            ),
          },
        ],
        isError: true,
      };
    }

    if (sourceStep.projectId !== projectValidation.projectId) {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage(
              "taskToolMessages/modification/syncTasksInputStepProjectMismatch.md",
              {
                inputStepId,
                stepProjectId: sourceStep.projectId,
                activeProjectId: projectValidation.projectId,
              }
            ),
          },
        ],
        isError: true,
      };
    }

    // content may be { analysis: "..." } or roadmap payload
    try {
      const parsed = JSON.parse(sourceStep.content);
      if (parsed.analysis) {
        contextGlobalAnalysis = parsed.analysis;
      } else if (parsed.roadmap) {
        contextGlobalAnalysis = parsed.roadmap;
      }
    } catch (e) {
      contextGlobalAnalysis = sourceStep.content; // Fallback if regular string
    }
  }

  // Snapshot counts before sync to compute stats
  const existingTasksBeforeSync = await getTasksByProject(projectValidation.projectId!);
  const existingCountBefore = existingTasksBeforeSync.length;

  // Execute batch create/update
  const processedTasks = await batchCreateOrUpdateTasks(
    tasks.map((t) => ({
      ...t,
      relatedFiles: t.relatedFiles?.map((f) => ({
        ...f,
        type:
          f.type === "create"
            ? RelatedFileType.CREATE
            : f.type === "modify"
              ? RelatedFileType.TO_MODIFY
              : f.type === "reference"
                ? RelatedFileType.REFERENCE
                : f.type === "dependency"
                  ? RelatedFileType.DEPENDENCY
                  : f.type === "test"
                    ? RelatedFileType.TEST
                    : f.type === "document"
                      ? RelatedFileType.DOCUMENT
                      : RelatedFileType.OTHER,
      })),
    })),
    updateMode,
    contextGlobalAnalysis, // Pass the analysis result to be stored in tasks
    projectValidation.projectId,
    inputStepId // Pass the Idea Phase Step ID to link tasks back to the plan
  );

  // Compute sync stats
  const inputCount = tasks.length;
  let created = 0;
  const updated = 0;
  let deleted = 0;

  // Phase 1 Group 5.6 — `split_tasks` is now clearAllTasks-only. The
  // non-destructive branches (`append`, `overwrite`, `selective`) were
  // removed; use `task_edit(action='create')` instead.
  if (updateMode === "clearAllTasks") {
    deleted = existingCountBefore;
    created = inputCount;
  }

  // Use prompt generator to get the final prompt
  const prompt = getSplitTasksPrompt({
    tasks: processedTasks,
    updateMode,
    syncStats: { created, updated, deleted },
  });

  return {
    content: [
      {
        type: "text" as const,
        text: prompt,
      },
    ],
  };
}
