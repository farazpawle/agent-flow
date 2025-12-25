import { getTaskById, updateTaskStatus, canExecuteTask, assessTaskComplexity, updateTask, } from "../../models/taskModel.js";
import { TaskStatus } from "../../types/index.js";
import { generateTaskSummary } from "../../utils/summaryExtractor.js";
import { loadTaskRelatedFiles } from "../../utils/fileLoader.js";
import { getExecuteTaskPrompt, getVerifyTaskPrompt, getCompleteTaskPrompt, } from "../../prompts/index.js";
import { validateProjectContext } from "../../utils/projectValidation.js";
// Execute task tool
export async function executeTask({ taskId, projectId, focus, }) {
    // Validate Project Context (Strict Mode)
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text", text: projectValidation.error }],
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
                        type: "text",
                        text: `Task with ID \`${taskId}\` not found. Please confirm if the ID is correct.`,
                    },
                ],
            };
        }
        // Verify Task belongs to the verified project context
        if (task.projectId !== projectValidation.projectId) {
            return {
                content: [
                    {
                        type: "text",
                        text: `Task "${task.name}" (ID: ${taskId}) belongs to project "${task.projectId}", but you are operating in project "${projectValidation.projectId}". Please switch projects or check the task ID.`,
                    },
                ],
                isError: true,
            };
        }
        // Check if the task can be executed (all dependencies are completed)
        const executionCheck = await canExecuteTask(taskId);
        if (!executionCheck.canExecute) {
            const blockedByTasksText = executionCheck.blockedBy && executionCheck.blockedBy.length > 0
                ? `Blocked by the following unfinished dependency tasks: ${executionCheck.blockedBy.join(", ")}`
                : "Unable to determine blocking reason";
            return {
                content: [
                    {
                        type: "text",
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
                        type: "text",
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
                        type: "text",
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
        const dependencyTasks = [];
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
            }
            catch (error) {
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
                    type: "text",
                    text: prompt,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error occurred when executing task: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
}
// Verify task tool
export async function verifyTask({ taskId, projectId, focus }) {
    // Validate Project Context (Strict Mode)
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text", text: projectValidation.error }],
            isError: true,
        };
    }
    const task = await getTaskById(taskId);
    if (!task) {
        return {
            content: [
                {
                    type: "text",
                    text: `## System Error\n\nTask with ID \`${taskId}\` not found. Please use the "list_tasks" tool to confirm a valid task ID before trying again.`,
                },
            ],
            isError: true,
        };
    }
    if (task.projectId !== projectValidation.projectId) {
        return {
            content: [
                {
                    type: "text",
                    text: `Task "${task.name}" (ID: ${taskId}) belongs to project "${task.projectId}", but you are operating in project "${projectValidation.projectId}". Please switch projects or check the task ID.`,
                },
            ],
            isError: true,
        };
    }
    if (task.status !== TaskStatus.IN_PROGRESS) {
        return {
            content: [
                {
                    type: "text",
                    text: `## Status Error\n\nTask "${task.name}" (ID: \`${task.id}\`) current status is "${task.status}", not in progress state, cannot be verified.\n\nOnly tasks in "in progress" state can be verified. Please use the "execute_task" tool to start task execution first.`,
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
    await updateTask(taskId, { verificationStatus: "passed" });
    return {
        content: [
            {
                type: "text",
                text: prompt,
            },
        ],
    };
}
// Complete task tool
export async function completeTask({ taskId, summary, lessonsLearned, projectId, }) {
    // Validate Project Context (Strict Mode)
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text", text: projectValidation.error }],
            isError: true,
        };
    }
    const task = await getTaskById(taskId);
    if (!task) {
        return {
            content: [
                {
                    type: "text",
                    text: `## System Error\n\nTask with ID \`${taskId}\` not found. Please use the "list_tasks" tool to confirm a valid task ID before trying again.`,
                },
            ],
            isError: true,
        };
    }
    if (task.projectId !== projectValidation.projectId) {
        return {
            content: [
                {
                    type: "text",
                    text: `Task "${task.name}" (ID: ${taskId}) belongs to project "${task.projectId}", but you are operating in project "${projectValidation.projectId}". Please switch projects or check the task ID.`,
                },
            ],
            isError: true,
        };
    }
    if (task.status !== TaskStatus.IN_PROGRESS) {
        return {
            content: [
                {
                    type: "text",
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
    // Update task status, summary, finalOutcome, and lessonsLearned
    await updateTask(taskId, {
        status: TaskStatus.COMPLETED,
        completedAt: new Date(),
        summary: taskSummary,
        finalOutcome: taskSummary, // Map summary to finalOutcome for context consistency
        lessonsLearned: lessonsLearned // Save lessons learned
    });
    // Use prompt generator to get the final prompt
    const prompt = getCompleteTaskPrompt({
        task,
        completionTime: new Date().toISOString(),
    });
    return {
        content: [
            {
                type: "text",
                text: prompt,
            },
        ],
    };
}
//# sourceMappingURL=execution.js.map