import { getTaskById, deleteTask as modelDeleteTask, getAllTasks, updateTaskContent as modelUpdateTaskContent, } from "../../models/taskModel.js";
import { TaskStatus, RelatedFileType } from "../../types/index.js";
import { getDeleteTaskPrompt, getUpdateTaskContentPrompt, } from "../../prompts/index.js";
import { validateProjectContext } from "../../utils/projectValidation.js";
import { getStepById } from "../../models/workflowModel.js";
import { getSplitTasksPrompt } from "../../prompts/index.js";
import { batchCreateOrUpdateTasks } from "../../models/taskModel.js";
export async function deleteTask({ taskId, projectId, deleteAll, confirm }) {
    // Validate Project Context (Strict Mode)
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text", text: projectValidation.error }],
            isError: true,
        };
    }
    // 1. Bulk Deletion Mode
    if (deleteAll) {
        if (!confirm) {
            return {
                content: [
                    {
                        type: "text",
                        text: "To delete all tasks, you must set 'confirm' to true.",
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
                    type: "text",
                    text: `Successfully deleted ${deleteCount} tasks from project "${projectValidation.projectId}".`,
                },
            ],
        };
    }
    // 2. Single Task Deletion Mode
    if (!taskId) {
        return {
            content: [
                {
                    type: "text",
                    text: "TaskId is required unless deleteAll is set to true.",
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
                    type: "text",
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
                    type: "text",
                    text: `Task "${task.name}" (ID: ${taskId}) belongs to project "${task.projectId}", but you are operating in project "${projectValidation.projectId}". Please switch projects or check the task ID.`,
                },
            ],
            isError: true,
        };
    }
    if (task.status === TaskStatus.COMPLETED) {
        return {
            content: [
                {
                    type: "text",
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
                type: "text",
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
export async function updateTaskContent({ taskId, name, description, notes, relatedFiles, dependencies, implementationGuide, verificationCriteria, projectId, }) {
    // Validate Project Context (Strict Mode)
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text", text: projectValidation.error }],
            isError: true,
        };
    }
    if (relatedFiles) {
        for (const file of relatedFiles) {
            if ((file.lineStart && !file.lineEnd) ||
                (!file.lineStart && file.lineEnd) ||
                (file.lineStart && file.lineEnd && file.lineStart > file.lineEnd)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: getUpdateTaskContentPrompt({
                                taskId,
                                validationError: "Invalid line number settings: must set both start and end lines, and the start line must be less than the end line",
                            }),
                        },
                    ],
                };
            }
        }
    }
    if (!(name ||
        description ||
        notes ||
        dependencies ||
        implementationGuide ||
        verificationCriteria ||
        relatedFiles)) {
        return {
            content: [
                {
                    type: "text",
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
                    type: "text",
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
                    type: "text",
                    text: `Task "${task.name}" (ID: ${taskId}) belongs to project "${task.projectId}", but you are operating in project "${projectValidation.projectId}". Please switch projects or check the task ID.`,
                },
            ],
            isError: true,
        };
    }
    // Record the task and content to be updated
    let updateSummary = `Preparing to update task: ${task.name} (ID: ${task.id})`;
    if (name)
        updateSummary += `, new name: ${name}`;
    if (description)
        updateSummary += `, update description`;
    if (notes)
        updateSummary += `, update notes`;
    if (relatedFiles)
        updateSummary += `, update related files (${relatedFiles.length})`;
    if (dependencies)
        updateSummary += `, update dependencies (${dependencies.length})`;
    if (implementationGuide)
        updateSummary += `, update implementation guide`;
    if (verificationCriteria)
        updateSummary += `, update verification criteria`;
    // Helper function to map schema strings to RelatedFileType
    const mapFileType = (type) => {
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
                type: "text",
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
export async function splitTasks({ projectId, tasks, updateMode, inputStepId }) {
    // Validate Project Context (Strict Mode)
    const projectValidation = await validateProjectContext(projectId);
    if (!projectValidation.isValid) {
        return {
            content: [{ type: "text", text: projectValidation.error }],
            isError: true,
        };
    }
    let contextGlobalAnalysis = "";
    // IF inputStepId is provided, we fetch the REFLECT step content to use as "Global Analysis"
    if (inputStepId) {
        const step = await getStepById(inputStepId);
        if (step && step.projectId === projectValidation.projectId) {
            // content is { analysis: "..." }
            try {
                const parsed = JSON.parse(step.content);
                if (parsed.analysis) {
                    contextGlobalAnalysis = parsed.analysis;
                }
            }
            catch (e) {
                contextGlobalAnalysis = step.content; // Fallback if regular string
            }
        }
    }
    // Execute batch create/update
    const processedTasks = await batchCreateOrUpdateTasks(tasks.map(t => ({
        ...t,
        relatedFiles: t.relatedFiles?.map(f => ({
            ...f,
            type: (f.type === "create" ? RelatedFileType.CREATE :
                f.type === "modify" ? RelatedFileType.TO_MODIFY :
                    f.type === "reference" ? RelatedFileType.REFERENCE :
                        f.type === "dependency" ? RelatedFileType.DEPENDENCY :
                            f.type === "test" ? RelatedFileType.TEST :
                                f.type === "document" ? RelatedFileType.DOCUMENT :
                                    RelatedFileType.OTHER)
        }))
    })), updateMode, contextGlobalAnalysis, // Pass the analysis result to be stored in tasks
    projectValidation.projectId, inputStepId // Pass the Idea Phase Step ID to link tasks back to the plan
    );
    // Use prompt generator to get the final prompt
    const prompt = getSplitTasksPrompt({
        tasks: processedTasks,
        updateMode,
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
//# sourceMappingURL=modification.js.map