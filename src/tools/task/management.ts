
import { z } from "zod";
import {
    getAllTasks,
    batchCreateOrUpdateTasks,
    clearAllTasks as modelClearAllTasks,
    searchTasksWithCommand,
} from "../../models/taskModel.js";
import { TaskStatus, Task, RelatedFileType } from "../../types/index.js";
import {
    getSplitTasksPrompt,
    getListTasksPrompt,
    getQueryTaskPrompt,
    getTaskDetailPrompt,
} from "../../prompts/index.js";
import {
    splitTasksSchema,
    listTasksSchema,
    queryTaskSchema,
    getTaskDetailSchema,
} from "./schemas.js";

// Task splitting tool
export async function splitTasks({
    updateMode,
    tasks,
    globalAnalysisResult,
}: z.infer<typeof splitTasksSchema>) {
    try {
        // Check if there are duplicate names in the tasks
        const nameSet = new Set();
        for (const task of tasks) {
            if (nameSet.has(task.name)) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: "Duplicate task names exist in the tasks parameter, please ensure that each task name is unique",
                        },
                    ],
                };
            }
            nameSet.add(task.name);
        }

        // Process tasks based on different update modes
        let message = "";
        let actionSuccess = true;
        let backupFile = null;
        let createdTasks: Task[] = [];
        let allTasks: Task[] = [];

        // Helper function to map schema strings to RelatedFileType
        const mapFileType = (type: string): RelatedFileType => {
            switch (type) {
                case "create": return RelatedFileType.CREATE;
                case "modify": return RelatedFileType.TO_MODIFY;
                case "reference": return RelatedFileType.REFERENCE;
                case "dependency": return RelatedFileType.DEPENDENCY;
                case "test": return RelatedFileType.TEST;
                case "document": return RelatedFileType.DOCUMENT;
                default: return RelatedFileType.OTHER;
            }
        };

        // Convert task data to the format required for batchCreateOrUpdateTasks
        const convertedTasks = tasks.map((task) => ({
            name: task.name,
            description: task.description,
            notes: task.notes,
            dependencies: task.dependencies,
            implementationGuide: task.implementationGuide,
            verificationCriteria: task.verificationCriteria,
            relatedFiles: task.relatedFiles?.map((file) => ({
                path: file.path,
                type: mapFileType(file.type),
                description: file.description,
                lineStart: file.lineStart,
                lineEnd: file.lineEnd,
            })),
        }));

        // Process clearAllTasks mode
        if (updateMode === "clearAllTasks") {
            const clearResult = await modelClearAllTasks();

            if (clearResult.success) {
                message = clearResult.message;
                backupFile = clearResult.backupFile;

                try {
                    // Clear tasks and then create new tasks
                    createdTasks = await batchCreateOrUpdateTasks(
                        convertedTasks,
                        "append",
                        globalAnalysisResult
                    );
                    message += `\nSuccessfully created ${createdTasks.length} new tasks.`;
                } catch (error) {
                    actionSuccess = false;
                    message += `\nError occurred when creating new tasks: ${error instanceof Error ? error.message : String(error)
                        }`;
                }
            } else {
                actionSuccess = false;
                message = clearResult.message;
            }
        } else {
            // For other modes, directly use batchCreateOrUpdateTasks
            try {
                createdTasks = await batchCreateOrUpdateTasks(
                    convertedTasks,
                    updateMode,
                    globalAnalysisResult
                );

                // Generate messages based on different update modes
                switch (updateMode) {
                    case "append":
                        message = `Successfully appended ${createdTasks.length} new tasks.`;
                        break;
                    case "overwrite":
                        message = `Successfully cleared unfinished tasks and created ${createdTasks.length} new tasks.`;
                        break;
                    case "selective":
                        message = `Successfully selectively updated/created ${createdTasks.length} tasks.`;
                        break;
                }
            } catch (error) {
                actionSuccess = false;
                message = `Task creation failed: ${error instanceof Error ? error.message : String(error)
                    }`;
            }
        }

        // Get all tasks for displaying dependency relationships
        try {
            allTasks = await getAllTasks();
        } catch (error) {
            allTasks = [...createdTasks]; // If retrieval fails, use just created tasks
        }

        // Use prompt generator to get the final prompt
        const prompt = getSplitTasksPrompt({
            updateMode,
            createdTasks,
            allTasks,
        });

        return {
            content: [
                {
                    type: "text" as const,
                    text: prompt,
                },
            ],
            ephemeral: {
                taskCreationResult: {
                    success: actionSuccess,
                    message,
                    backupFilePath: backupFile || undefined,
                },
            },
        };
    } catch (error) {
        return {
            content: [
                {
                    type: "text" as const,
                    text:
                        "Error occurred when executing task splitting: " +
                        (error instanceof Error ? error.message : String(error)),
                },
            ],
        };
    }
}

// List tasks tool
export async function listTasks({ status }: z.infer<typeof listTasksSchema>) {
    const tasks = await getAllTasks();
    let filteredTasks = tasks;
    switch (status) {
        case "all":
            break;
        case "pending":
            filteredTasks = tasks.filter(
                (task) => task.status === TaskStatus.PENDING
            );
            break;
        case "in_progress":
            filteredTasks = tasks.filter(
                (task) => task.status === TaskStatus.IN_PROGRESS
            );
            break;
        case "completed":
            filteredTasks = tasks.filter(
                (task) => task.status === TaskStatus.COMPLETED
            );
            break;
    }

    if (filteredTasks.length === 0) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `## System Notification\n\nCurrently, there are no ${status === "all" ? "any" : `any ${status} `
                        }tasks in the system. Please query other status tasks or first use the "split_tasks" tool to create task structure, then proceed with subsequent operations.`,
                },
            ],
        };
    }

    const tasksByStatus = tasks.reduce((acc, task) => {
        if (!acc[task.status]) {
            acc[task.status] = [];
        }
        acc[task.status].push(task);
        return acc;
    }, {} as Record<string, typeof tasks>);

    // Use prompt generator to get the final prompt
    const prompt = getListTasksPrompt({
        status,
        tasks: tasksByStatus,
        allTasks: filteredTasks,
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

// Query task tool
export async function queryTask({
    query,
    isId = false,
    page = 1,
    pageSize = 3,
}: z.infer<typeof queryTaskSchema>) {
    try {
        // Use system command search function
        const results = await searchTasksWithCommand(query, isId, page, pageSize);

        // Use prompt generator to get the final prompt
        const prompt = getQueryTaskPrompt({
            query,
            isId,
            tasks: results.tasks,
            totalTasks: results.pagination.totalResults,
            page: results.pagination.currentPage,
            pageSize,
            totalPages: results.pagination.totalPages,
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
                    text: `## System Error\n\nError occurred when querying tasks: ${error instanceof Error ? error.message : String(error)
                        }`,
                },
            ],
            isError: true,
        };
    }
}

// Get complete task detail
export async function getTaskDetail({
    taskId,
}: z.infer<typeof getTaskDetailSchema>) {
    try {
        // Use searchTasksWithCommand instead of getTaskById to implement memory area task search
        // Set isId to true to search by ID; page number is 1, page size is 1
        const result = await searchTasksWithCommand(taskId, true, 1, 1);

        // Check if the task is found
        if (result.tasks.length === 0) {
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `## Error\n\nTask with ID \`${taskId}\` not found. Please confirm if the task ID is correct.`,
                    },
                ],
                isError: true,
            };
        }

        // Get the found task (the first and only one)
        const task = result.tasks[0];

        // Use prompt generator to get the final prompt
        const prompt = getTaskDetailPrompt({
            taskId,
            task,
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
        // Use prompt generator to get error message
        const errorPrompt = getTaskDetailPrompt({
            taskId,
            error: error instanceof Error ? error.message : String(error),
        });

        return {
            content: [
                {
                    type: "text" as const,
                    text: errorPrompt,
                },
            ],
            isError: true,
        };
    }
}
