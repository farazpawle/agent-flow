
import { z } from "zod";
import {
    getTaskById,
    updateTaskStatus,
    canExecuteTask,
    assessTaskComplexity,
    updateTaskSummary,
} from "../../models/taskModel.js";
import { TaskStatus, Task } from "../../types/index.js";
import { generateTaskSummary } from "../../utils/summaryExtractor.js";
import { loadTaskRelatedFiles } from "../../utils/fileLoader.js";
import {
    getExecuteTaskPrompt,
    getVerifyTaskPrompt,
    getCompleteTaskPrompt,
} from "../../prompts/index.js";
import {
    executeTaskSchema,
    verifyTaskSchema,
    completeTaskSchema,
} from "./schemas.js";

// Execute task tool
export async function executeTask({
    taskId,
}: z.infer<typeof executeTaskSchema>) {
    try {
        // Check if the task exists
        const task = await getTaskById(taskId);
        if (!task) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Task with ID \`${taskId}\` not found. Please confirm if the ID is correct.`,
                    },
                ],
            };
        }

        // Check if the task can be executed (all dependencies are completed)
        const executionCheck = await canExecuteTask(taskId);
        if (!executionCheck.canExecute) {
            const blockedByTasksText =
                executionCheck.blockedBy && executionCheck.blockedBy.length > 0
                    ? `Blocked by the following unfinished dependency tasks: ${executionCheck.blockedBy.join(", ")}`
                    : "Unable to determine blocking reason";

            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Task "${task.name}" (ID: \`${taskId}\`) cannot be executed at this time. ${blockedByTasksText}`,
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
                        text: `Task "${task.name}" (ID: \`${taskId}\`) is already in progress.`,
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
                        text: `Task "${task.name}" (ID: \`${taskId}\`) has been marked as completed. If you need to execute it again, please delete the task and recreate it first.`,
                    },
                ],
            };
        }

        // Update task status to "in progress"
        await updateTaskStatus(taskId, TaskStatus.IN_PROGRESS);

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
                const relatedFilesResult = await loadTaskRelatedFiles(
                    task.relatedFiles
                );
                relatedFilesSummary =
                    typeof relatedFilesResult === "string"
                        ? relatedFilesResult
                        : relatedFilesResult.summary || "";
            } catch (error) {
                relatedFilesSummary =
                    "Error loading related files, please check the files manually.";
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
                    text: `Error occurred when executing task: ${error instanceof Error ? error.message : String(error)
                        }`,
                },
            ],
            isError: true,
        };
    }
}

// Verify task tool
export async function verifyTask({ taskId }: z.infer<typeof verifyTaskSchema>) {
    const task = await getTaskById(taskId);

    if (!task) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `## System Error\n\nTask with ID \`${taskId}\` not found. Please use the "list_tasks" tool to confirm a valid task ID before trying again.`,
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
                    text: `## Status Error\n\nTask "${task.name}" (ID: \`${task.id}\`) current status is "${task.status}", not in progress state, cannot be verified.\n\nOnly tasks in "in progress" state can be verified. Please use the "execute_task" tool to start task execution first.`,
                },
            ],
            isError: true,
        };
    }

    // Use prompt generator to get the final prompt
    const prompt = getVerifyTaskPrompt({ task });

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
}: z.infer<typeof completeTaskSchema>) {
    const task = await getTaskById(taskId);

    if (!task) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `## System Error\n\nTask with ID \`${taskId}\` not found. Please use the "list_tasks" tool to confirm a valid task ID before trying again.`,
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
                    text: `## Status Error\n\nTask "${task.name}" (ID: \`${task.id}\`) current status is "${task.status}", not in progress state, cannot mark as completed.\n\nOnly tasks in "in progress" state can be marked as completed. Please use the "execute_task" tool to start task execution first.`,
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

    // Update task status to completed and add summary
    await updateTaskStatus(taskId, TaskStatus.COMPLETED);
    await updateTaskSummary(taskId, taskSummary);

    // Use prompt generator to get the final prompt
    const prompt = getCompleteTaskPrompt({
        task,
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
