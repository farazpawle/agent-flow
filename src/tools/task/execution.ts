import { z } from "zod";
import {
  getTaskById,
  canExecuteTask,
  assessTaskComplexity,
  updateTask,
} from "../../models/taskModel.js";
import { TaskStatus, Task } from "../../types/index.js";
import { generateTaskSummary } from "../../utils/summaryExtractor.js";
import { loadTaskRelatedFiles } from "../../utils/fileLoader.js";
import {
  getExecuteTaskPrompt,
  getVerifyTaskPrompt,
  getCompleteTaskPrompt,
} from "../../prompts/index.js";
import { executeTaskSchema, verifyTaskSchema, completeTaskSchema } from "./schemas.js";
import { validateProjectContext } from "../../utils/projectValidation.js";
import { renderTaskToolMessage } from "./messageTemplates.js";

// Execute task tool
export async function executeTask({ taskId, projectId, focus }: z.infer<typeof executeTaskSchema>) {
  // Validate Project Context (Strict Mode)
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  try {
    // Check if the task exists
    const task = await getTaskById(taskId);
    if (!task) {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage("taskToolMessages/execution/executeTaskNotFound.md", {
              taskId,
            }),
          },
        ],
      };
    }

    // Verify Task belongs to the verified project context
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

    // Check if the task can be executed (all dependencies are completed)
    const executionCheck = await canExecuteTask(taskId);
    if (!executionCheck.canExecute) {
      const blockedByTasksText =
        executionCheck.blockedBy && executionCheck.blockedBy.length > 0
          ? renderTaskToolMessage(
              "taskToolMessages/execution/executeTaskBlockedByDependencies.md",
              { blockedTaskIds: executionCheck.blockedBy.join(", ") }
            )
          : renderTaskToolMessage("taskToolMessages/execution/executeTaskBlockedUnknownReason.md");

      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage("taskToolMessages/execution/executeTaskBlocked.md", {
              taskName: task.name,
              taskId,
              blockedByTasksText,
            }),
          },
        ],
      };
    }

    // If the task is already marked as "in progress", prompt the user
    if (task.status === TaskStatus.IN_PROGRESS) {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage(
              "taskToolMessages/execution/executeTaskAlreadyInProgress.md",
              {
                taskName: task.name,
                taskId,
              }
            ),
          },
        ],
      };
    }

    // If the task is already marked as "completed", prompt the user
    if (task.status === TaskStatus.COMPLETED) {
      return {
        content: [
          {
            type: "text" as const,
            text: renderTaskToolMessage(
              "taskToolMessages/execution/executeTaskAlreadyCompleted.md",
              {
                taskName: task.name,
                taskId,
              }
            ),
          },
        ],
      };
    }

    // Update task status to "in progress" and reset any stale verification state.
    // This enforces a fresh verify -> complete cycle for every new execution run.
    await updateTask(taskId, {
      status: TaskStatus.IN_PROGRESS,
      completedAt: undefined,
      verificationStatus: undefined,
    });

    // Assess task complexity
    const complexityResult = await assessTaskComplexity(taskId);

    // Convert complexity result to appropriate format
    const complexityAssessment = complexityResult
      ? {
          level: complexityResult.level,
          metrics: {
            descriptionLength: complexityResult.metrics.descriptionLength,
            dependenciesCount: complexityResult.metrics.dependenciesCount,
          },
          recommendations: complexityResult.recommendations,
        }
      : undefined;

    // Get dependency tasks, for displaying completion summary
    const dependencyTasks: Task[] = [];
    if (task.dependencies && task.dependencies.length > 0) {
      for (const dep of task.dependencies) {
        const depTask = await getTaskById(dep.taskId);
        if (depTask) {
          dependencyTasks.push(depTask);
        }
      }
    }

    // Load task-related file content
    let relatedFilesSummary = "";
    if (task.relatedFiles && task.relatedFiles.length > 0) {
      try {
        const relatedFilesResult = await loadTaskRelatedFiles(task.relatedFiles);
        relatedFilesSummary =
          typeof relatedFilesResult === "string"
            ? relatedFilesResult
            : relatedFilesResult.summary || "";
      } catch (error) {
        relatedFilesSummary = renderTaskToolMessage(
          "taskToolMessages/execution/relatedFilesLoadError.md"
        );
      }
    }

    // Use prompt generator to get the final prompt
    const prompt = getExecuteTaskPrompt({
      task,
      complexityAssessment,
      relatedFilesSummary,
      dependencyTasks,
    });

    return {
      content: [
        {
          type: "text" as const,
          text: prompt,
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/execution/executeTaskFailed.md", {
            error: error instanceof Error ? error.message : String(error),
          }),
        },
      ],
      isError: true,
    };
  }
}

// Verify task tool
export async function verifyTask({ taskId, projectId, focus }: z.infer<typeof verifyTaskSchema>) {
  // Validate Project Context (Strict Mode)
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  const task = await getTaskById(taskId);

  if (!task) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/execution/verifyTaskNotFound.md", {
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

  if (task.status !== TaskStatus.IN_PROGRESS) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/execution/verifyTaskInvalidStatus.md", {
            taskName: task.name,
            taskId: task.id,
            taskStatus: task.status,
          }),
        },
      ],
      isError: true,
    };
  }

  // Use prompt generator to get the final prompt
  const prompt = getVerifyTaskPrompt({ task });

  // Update the task status to indicate verification has passed/is being tracked
  // Per TASK_WORKFLOW_EXPLAINED.md, the action is "UPDATE tasks... verification_status='passed'"
  // We assume calling this tool implies the agent is marking it as verified (or starting the process).
  // To support the strict workflow, we update the status field.
  await updateTask(taskId, { verificationStatus: "passed" } as any);

  return {
    content: [
      {
        type: "text" as const,
        text: prompt,
      },
    ],
  };
}

// Complete task tool
export async function completeTask({
  taskId,
  summary,
  lessonsLearned,
  projectId,
}: z.infer<typeof completeTaskSchema>) {
  // Validate Project Context (Strict Mode)
  const projectValidation = await validateProjectContext(projectId);
  if (!projectValidation.isValid) {
    return {
      content: [{ type: "text" as const, text: projectValidation.error! }],
      isError: true,
    };
  }

  const task = await getTaskById(taskId);

  if (!task) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/execution/completeTaskNotFound.md", {
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

  if (task.status !== TaskStatus.IN_PROGRESS) {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage("taskToolMessages/execution/completeTaskInvalidStatus.md", {
            taskName: task.name,
            taskId: task.id,
            taskStatus: task.status,
          }),
        },
      ],
      isError: true,
    };
  }

  if (task.verificationStatus !== "passed") {
    return {
      content: [
        {
          type: "text" as const,
          text: renderTaskToolMessage(
            "taskToolMessages/execution/completeTaskVerificationRequired.md",
            {
              taskName: task.name,
              taskId: task.id,
            }
          ),
        },
      ],
      isError: true,
    };
  }

  // Process summary information
  let taskSummary = summary;
  if (!taskSummary) {
    // Automatically generate summary
    taskSummary = generateTaskSummary(task.name, task.description);
  }

  // Update task status, summary, finalOutcome, and lessonsLearned
  await updateTask(taskId, {
    status: TaskStatus.COMPLETED,
    completedAt: new Date(),
    summary: taskSummary,
    finalOutcome: taskSummary, // Map summary to finalOutcome for context consistency
    lessonsLearned: lessonsLearned, // Save lessons learned
  });

  // Use prompt generator to get the final prompt
  const prompt = getCompleteTaskPrompt({
    task,
    summary: summary, // Pass the original user-provided summary (undefined if not given) for warning display
    completionTime: new Date().toISOString(),
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
