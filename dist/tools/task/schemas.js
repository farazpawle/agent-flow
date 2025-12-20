/**
 * Task Tool Schemas
 * Centralized Zod schemas for all task-related tools
 */
import { z } from "zod";
// =============================================================================
// Planning Schemas
// =============================================================================
export const planTaskSchema = z.object({
    description: z
        .string()
        .min(10, {
        message: "Task description cannot be less than 10 characters, please provide a more detailed description to ensure clear task objectives",
    })
        .describe("Complete task description, should specify the task objectives and expected outcomes"),
    requirements: z
        .string()
        .optional()
        .describe("Optional additional requirements"),
    existingTasksReference: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether to reference existing task list to avoid duplicate task creation, default is false"),
    focus: z
        .enum(["logic", "vibe", "debug", "security", "performance", "accessibility"])
        .optional()
        .default("logic")
        .describe("Focus mode for planning: logic (technical/backend), vibe (creative/UI), debug (error investigation), security (auth/encryption), performance (optimization), accessibility (WCAG)"),
});
export const analyzeTaskSchema = z.object({
    summary: z
        .string()
        .min(10, {
        message: "Task summary cannot be less than 10 characters, please provide a more detailed description to ensure clear task objectives",
    })
        .describe("Summary of the task to analyze"),
    initialConcept: z
        .string()
        .min(20, {
        message: "Initial concept cannot be less than 20 characters, please provide a more detailed description to ensure clear task objectives",
    })
        .describe("Initial solution concept or technical direction, providing complete implementation ideas as much as possible"),
    previousAnalysis: z
        .string()
        .optional()
        .describe("Analysis results from previous iterations, used for continuous improvement of solutions (only required for reanalysis)"),
});
export const reflectTaskSchema = z.object({
    summary: z
        .string()
        .min(10, {
        message: "Task summary cannot be less than 10 characters, please provide a more detailed description to ensure clear task objectives",
    })
        .describe("Summary of the task to reflect on"),
    analysis: z
        .string()
        .min(50, {
        message: "Analysis content cannot be less than 50 characters, please provide more complete analysis",
    })
        .describe("Complete analysis result from analyze_task, should include technical approach and key decisions"),
});
// =============================================================================
// Management Schemas
// =============================================================================
export const splitTasksSchema = z.object({
    updateMode: z
        .enum(["append", "overwrite", "selective", "clearAllTasks"])
        .describe("Task update mode: 'append'=add to existing tasks, 'overwrite'=replace all unfinished tasks, 'selective'=update specific tasks by name, 'clearAllTasks'=clear all tasks and create new"),
    tasks: z
        .array(z.object({
        name: z
            .string()
            .max(100, {
            message: "Task name too long, please limit to 100 characters",
        })
            .describe("Task name, should be concise and able to clearly identify task content"),
        description: z
            .string()
            .min(10, {
            message: "Task description cannot be less than 10 characters, please provide a more detailed description to ensure clear task objectives",
        })
            .describe("Detailed task description, should clearly specify implementation steps and acceptance criteria"),
        dependencies: z
            .array(z.string())
            .optional()
            .describe("List of tasks this task depends on, can use task ID or task name as reference (optional)"),
        notes: z
            .string()
            .optional()
            .describe("Supplementary notes, special processing requirements or implementation suggestions (optional)"),
        relatedFiles: z
            .array(z.object({
            path: z
                .string()
                .min(1, {
                message: "File path cannot be empty",
            })
                .describe("Absolute path or relative to project root path"),
            type: z
                .enum(["create", "modify", "reference", "dependency", "test", "document", "other"])
                .describe("File relation type"),
            description: z.string().optional().describe("Brief description of file's relevance"),
            lineStart: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Starting line of the relevant code block (optional)"),
            lineEnd: z
                .number()
                .int()
                .positive()
                .optional()
                .describe("Ending line of the relevant code block (optional)"),
        }))
            .optional()
            .describe("List of files related to the task, used to record code files, reference materials, files to be created, etc. related to the task (optional)"),
        implementationGuide: z
            .string()
            .optional()
            .describe("Implementation guide for this specific task, including code examples, configuration details, etc."),
        verificationCriteria: z
            .string()
            .optional()
            .describe("Verification criteria and inspection methods for this specific task"),
        category: z
            .enum(["feature", "bugfix", "refactor", "test", "docs", "config", "frontend", "backend", "database", "devops", "design", "research"])
            .optional()
            .describe("Task category for organization and filtering"),
        priority: z
            .enum(["critical", "high", "medium", "low"])
            .optional()
            .default("medium")
            .describe("Task priority: critical (blocking), high (important), medium (normal), low (nice-to-have)"),
    }))
        .min(1, {
        message: "Please provide at least one task",
    })
        .describe("Structured task list, each task should be atomic and have a clear completion standard, avoid overly simple tasks, simple modifications can be integrated with other tasks, avoid too many tasks"),
    globalAnalysisResult: z
        .string()
        .optional()
        .describe("Global analysis result: complete analysis result from reflect_task, applicable to the common parts of all tasks"),
});
export const listTasksSchema = z.object({
    status: z
        .enum(["all", "pending", "in_progress", "completed"])
        .describe("Task status to list, can choose 'all' to list all tasks, or specify specific status"),
});
export const queryTaskSchema = z.object({
    query: z
        .string()
        .min(1, {
        message: "Query content cannot be empty, please provide task ID or search keywords",
    })
        .describe("Query content, can be task ID or search keywords"),
    isId: z
        .boolean()
        .optional()
        .default(false)
        .describe("Whether the query content is task ID, if true, will perform exact match by ID"),
    page: z
        .number()
        .int()
        .positive()
        .optional()
        .default(1)
        .describe("Page number, default is page 1"),
    pageSize: z
        .number()
        .int()
        .positive()
        .min(1)
        .max(20)
        .optional()
        .default(5)
        .describe("Number of tasks to display per page, default is 5, maximum 20"),
});
export const getTaskDetailSchema = z.object({
    taskId: z
        .string()
        .min(1, {
        message: "Task ID cannot be empty, please provide a valid task ID",
    })
        .describe("Task ID to view details"),
});
// =============================================================================
// Execution Schemas
// =============================================================================
export const executeTaskSchema = z.object({
    taskId: z
        .string()
        .uuid({
        message: "Task ID must be a valid UUID format",
    })
        .describe("Unique identifier of the task to execute, must be an existing task ID in the system"),
    focus: z
        .enum(["logic", "vibe", "debug", "security", "performance", "accessibility"])
        .optional()
        .describe("Focus mode for execution: logic (technical/backend), vibe (creative/UI), debug (error investigation), security (auth/encryption), performance (optimization), accessibility (WCAG)"),
});
export const verifyTaskSchema = z.object({
    taskId: z
        .string()
        .uuid({ message: "Invalid task ID format, please provide a valid UUID format" })
        .describe("Unique identifier of the task to verify"),
    focus: z
        .enum(["logic", "vibe", "debug", "security", "performance", "accessibility"])
        .optional()
        .describe("Focus mode for verification: logic (test correctness), vibe (check aesthetics/UX), debug (verify fix), security (check vulnerabilities), performance (benchmark), accessibility (WCAG audit)"),
});
export const completeTaskSchema = z.object({
    taskId: z
        .string()
        .uuid({ message: "Invalid task ID format, please provide a valid UUID format" })
        .describe("ID of the task to be marked as completed, must be a verified task ID "),
    summary: z
        .string()
        .min(10, {
        message: "Summary cannot be less than 10 characters, please provide a clear summary of what was accomplished",
    })
        .optional()
        .describe("Task completion summary, concise description of implementation results and important decisions (optional, will be automatically generated if not provided)"),
});
// =============================================================================
// CRUD Schemas
// =============================================================================
export const deleteTaskSchema = z.object({
    taskId: z
        .string()
        .uuid({ message: "Invalid task ID format, please provide a valid UUID format" })
        .describe("Unique identifier of the task to delete, must be an existing unfinished task ID in the system"),
});
export const clearAllTasksSchema = z.object({
    confirm: z
        .boolean()
        .refine((val) => val === true, {
        message: "Must clearly confirm the clear operation, please set the confirm parameter to true to confirm this dangerous operation",
    })
        .describe("Confirm to delete all unfinished tasks (this operation is irreversible)"),
});
export const updateTaskContentSchema = z.object({
    taskId: z
        .string()
        .uuid({ message: "Invalid task ID format, please provide a valid UUID format" })
        .describe("ID of the task to update"),
    name: z.string().optional().describe("New name for the task (optional)"),
    description: z.string().optional().describe("New description for the task (optional)"),
    notes: z.string().optional().describe("New supplementary notes for the task (optional)"),
    dependencies: z
        .array(z.string())
        .optional()
        .describe("New dependency relationships for the task (optional)"),
    relatedFiles: z
        .array(z.object({
        path: z
            .string()
            .min(1, { message: "File path cannot be empty, please provide a valid file path" })
            .describe("Absolute path or relative to project root path"),
        type: z
            .enum(["create", "modify", "reference", "dependency", "test", "document", "other"])
            .describe("File relation type"),
        description: z.string().optional().describe("Brief description of file's relevance"),
        lineStart: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Starting line of the relevant code block (optional)"),
        lineEnd: z
            .number()
            .int()
            .positive()
            .optional()
            .describe("Ending line of the relevant code block (optional)"),
    }))
        .optional()
        .describe("List of files related to the task (optional)"),
    implementationGuide: z
        .string()
        .optional()
        .describe("New implementation guide for the task (optional)"),
    verificationCriteria: z
        .string()
        .optional()
        .describe("New verification criteria for the task (optional)"),
});
//# sourceMappingURL=schemas.js.map