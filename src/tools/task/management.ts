
import { z } from "zod";
import {
    getAllTasks,
    batchCreateOrUpdateTasks,
    clearAllTasks as modelClearAllTasks,
    searchTasksWithCommand,
    reorderTasks as modelReorderTasks,
} from "../../models/taskModel.js";
import { TaskStatus, Task, RelatedFileType } from "../../types/index.js";
import {
    getListTasksPrompt,
    getQueryTaskPrompt,
    getTaskDetailPrompt,
} from "../../prompts/index.js";
import {
    listTasksSchema,
    queryTaskSchema,
    getTaskDetailSchema,
    reorderTasksSchema,
} from "./schemas.js";
import { validateProjectContext } from "../../utils/projectValidation.js";

// List tasks tool
// List tasks tool
export async function listTasks({ status, projectId }: z.infer<typeof listTasksSchema>) {
    // Validate Project Context (Strict Mode)
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text" as const, text: projectValidation.error! }],
            isError: true,
        };
    }

    // Filter by Project ID
    const tasks = await getAllTasks(projectValidation.projectId);
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

// Reorder tasks tool
export async function reorderTasksTool({ projectId, taskIds }: z.infer<typeof reorderTasksSchema>) {
    // Validate project context
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text" as const, text: projectValidation.error! }],
            isError: true,
        };
    }

    try {
        const updatedTasks = await modelReorderTasks(projectValidation.projectId!, taskIds);

        return {
            content: [
                {
                    type: "text" as const,
                    text: `## Task Reorder Successful\n\nSuccessfully reordered ${updatedTasks.length} tasks. The system has adjusted the order to respect dependencies where necessary.`,
                },
            ],
        };
    } catch (error) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: `## Reorder Failed\n\nError reordering tasks: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
}
