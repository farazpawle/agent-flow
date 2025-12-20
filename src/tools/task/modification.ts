
import { z } from "zod";
import {
    getTaskById,
    deleteTask as modelDeleteTask,
    clearAllTasks as modelClearAllTasks,
    getAllTasks,
    updateTaskContent as modelUpdateTaskContent,
} from "../../models/taskModel.js";
import { TaskStatus, RelatedFileType } from "../../types/index.js";
import {
    getDeleteTaskPrompt,
    getClearAllTasksPrompt,
    getUpdateTaskContentPrompt,
} from "../../prompts/index.js";
import {
    deleteTaskSchema,
    clearAllTasksSchema,
    updateTaskContentSchema,
} from "./schemas.js";

export async function deleteTask({ taskId }: z.infer<typeof deleteTaskSchema>) {
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

export async function clearAllTasks({
    confirm,
}: z.infer<typeof clearAllTasksSchema>) {
    // Security check: If not confirmed, refuse operation
    if (!confirm) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: getClearAllTasksPrompt({ confirm: false }),
                },
            ],
        };
    }

    // Check if there are really tasks to clear
    const allTasks = await getAllTasks();
    if (allTasks.length === 0) {
        return {
            content: [
                {
                    type: "text" as const,
                    text: getClearAllTasksPrompt({ isEmpty: true }),
                },
            ],
        };
    }

    // Execute clear operation
    const result = await modelClearAllTasks();

    return {
        content: [
            {
                type: "text" as const,
                text: getClearAllTasksPrompt({
                    success: result.success,
                    message: result.message,
                    backupFile: result.backupFile,
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
}: z.infer<typeof updateTaskContentSchema>) {
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

    // Record the task and content to be updated
    let updateSummary = `Preparing to update task: ${task.name} (ID: ${task.id})`;
    if (name) updateSummary += `, new name: ${name}`;
    if (description) updateSummary += `, update description`;
    if (notes) updateSummary += `, update notes`;
    if (relatedFiles)
        updateSummary += `, update related files (${relatedFiles.length})`;
    if (dependencies)
        updateSummary += `, update dependencies (${dependencies.length})`;
    if (implementationGuide) updateSummary += `, update implementation guide`;
    if (verificationCriteria) updateSummary += `, update verification criteria`;

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

    // Execute the update operation
    const result = await modelUpdateTaskContent(taskId, {
        name,
        description,
        notes,
        relatedFiles: relatedFiles?.map(f => ({
            ...f,
            type: mapFileType(f.type)
        })),
        dependencies,
        implementationGuide,
        verificationCriteria,
    });

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
                }),
            },
        ],
        isError: !result.success,
    };
}
