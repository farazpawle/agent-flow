/**
 * Task Tool Schemas
 * Centralized Zod schemas for all task-related tools
 */

import { z } from "zod";

// =============================================================================
// Planning Schemas
// =============================================================================

export const planIdeaSchema = z
  .object({
    stage: z
      .enum(["plan", "analyze", "review"])
      .optional()
      .default("plan")
      .describe(
        "Planning stage selector: plan (initial idea), analyze (technical analysis), review (critique/refine)."
      ),
    description: z
      .string()
      .min(10, {
        message:
          "Please provide a more descriptive thought (at least 10 chars) so I can plan the idea effectively.",
      })
      .optional()
      .describe(
        "Description of the idea or problem statement to brainstorm (required in stage='plan')."
      ),
    projectId: z
      .string()
      .optional()
      .describe("Project ID context for this idea. Required for strict project alignment."),
    requirements: z.string().optional().describe("Optional additional requirements or constraints"),
    focus: z
      .enum(["logic", "vibe", "debug", "security", "performance", "accessibility"])
      .optional()
      .default("logic")
      .describe(
        "Focus mode for brainstorming: logic (technical), vibe (creative/UI), debug (root cause), security (auth/safety), performance (speed), accessibility (WCAG)"
      ),
    inputStepId: z
      .string()
      .optional()
      .describe(
        "For stage='analyze' or stage='review': the previous workflow step ID to continue from."
      ),
    analysis: z
      .string()
      .optional()
      .describe(
        "For stage='review': critique/refinement notes. If omitted, self-review mode is used."
      ),
  })
  // @superrefine-allowed: legacy planIdea — slated for removal in Group 10 (workflow_run replaces it).
  .superRefine((data, ctx) => {
    if (data.stage === "plan") {
      if (!data.description) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["description"],
          message: "description is required when stage='plan'.",
        });
      }
    }

    if (data.stage === "analyze" || data.stage === "review") {
      if (!data.inputStepId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["inputStepId"],
          message: "inputStepId is required when stage='analyze' or stage='review'.",
        });
      }
    }
  });

// =============================================================================
// Management Schemas
// =============================================================================

export const splitTasksSchema = z.object({
  // Phase 1 Group 5.6 — non-destructive paths (append, overwrite,
  // selective) are removed; agents must use `task_edit(action=create)`
  // for those flows. Only the destructive `clearAllTasks` path remains,
  // and Group 6 removes that too in favour of
  // `task_delete(action=clear_all_for_project, mode=execute)`.
  updateMode: z
    .enum(["clearAllTasks"])
    .describe(
      "Destructive bulk replacement. Use `task_edit(action=create)` for non-destructive batches and `task_delete(action=clear_all_for_project, mode=execute)` once Group 6 ships."
    ),
  inputStepId: z
    .string()
    .optional()
    .describe(
      "Optional ID of the plan_idea(stage='review') step to use its analysis as global context for all tasks."
    ),
  projectId: z
    .string()
    .optional()
    .describe("Project ID to associate these tasks with. Required for strict project alignment."),
  tasks: z
    .array(
      z.object({
        name: z
          .string()
          .max(100, {
            message: "Task name too long, please limit to 100 characters",
          })
          .describe("Task name, should be concise and able to clearly identify task content"),
        description: z
          .string()
          .min(10, {
            message:
              "Task description cannot be less than 10 characters, please provide a more detailed description to ensure clear task objectives",
          })
          .describe(
            "Detailed task description, should clearly specify implementation steps and acceptance criteria"
          ),
        problemStatement: z
          .string()
          .optional()
          .describe("The specific problem this task solves (Context for future retrieval)."),
        dependencies: z
          .array(z.string())
          .optional()
          .describe(
            "List of tasks this task depends on, can use task ID or task name as reference (optional)"
          ),
        notes: z
          .string()
          .optional()
          .describe(
            "Supplementary notes, special processing requirements or implementation suggestions (optional)"
          ),
        relatedFiles: z
          .array(
            z.object({
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
            })
          )
          .optional()
          .describe(
            "List of files related to the task, used to record code files, reference materials, files to be created, etc. related to the task (optional)"
          ),
        implementationGuide: z
          .string()
          .optional()
          .describe(
            "Implementation guide for this specific task, including code examples, configuration details, etc."
          ),
        verificationCriteria: z
          .string()
          .optional()
          .describe("Verification criteria and inspection methods for this specific task"),
        category: z
          .enum([
            "feature",
            "bugfix",
            "refactor",
            "test",
            "docs",
            "config",
            "frontend",
            "backend",
            "database",
            "devops",
            "design",
            "research",
          ])
          .optional()
          .describe("Task category for organization and filtering"),
        priority: z
          .enum(["critical", "high", "medium", "low"])
          .optional()
          .default("medium")
          .describe(
            "Task priority: critical (blocking), high (important), medium (normal), low (nice-to-have)"
          ),
      })
    )
    .min(1, {
      message: "Please provide at least one task",
    })
    .describe(
      "Structured task list, each task should be atomic and have a clear completion standard, avoid overly simple tasks, simple modifications can be integrated with other tasks, avoid too many tasks"
    ),
  globalAnalysisResult: z
    .string()
    .optional()
    .describe(
      "Global analysis result from review/reflection/roadmap, applicable to common parts of all tasks"
    ),
});

export const listTasksSchema = z.object({
  status: z
    .enum(["all", "pending", "in_progress", "completed"])
    .describe(
      "Task status to list, can choose 'all' to list all tasks, or specify specific status"
    ),
  projectId: z
    .string()
    .optional()
    .describe("Project ID to filter tasks. Required for strict project alignment."),
});

export const findTaskSchema = z.object({
  query: z
    .string()
    .min(1, {
      message:
        "Query cannot be empty. Provide a task UUID (for exact lookup) or keywords (for search).",
    })
    .describe(
      "Task UUID for exact detail lookup, or keywords to search across task names and descriptions."
    ),
  isId: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      "Set true to do an exact UUID lookup and return full task detail. Set false (default) for keyword search."
    ),
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1)
    .describe("Page number for keyword search results (default 1)."),
  pageSize: z
    .number()
    .int()
    .positive()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Number of results per page for keyword search (default 5, max 20)."),
  projectId: z
    .string()
    .optional()
    .describe("Project ID to scope keyword search results. Not required for UUID lookup."),
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
    .describe(
      "Unique identifier of the task to execute, must be an existing task ID in the system"
    ),
  projectId: z
    .string()
    .optional()
    .describe("Project ID context for this execution. Required for strict project alignment."),
  focus: z
    .enum(["logic", "vibe", "debug", "security", "performance", "accessibility"])
    .optional()
    .describe(
      "Focus mode for execution: logic (technical/backend), vibe (creative/UI), debug (error investigation), security (auth/encryption), performance (optimization), accessibility (WCAG)"
    ),
});

export const verifyTaskSchema = z.object({
  taskId: z
    .string()
    .uuid({ message: "Invalid task ID format, please provide a valid UUID format" })
    .describe("Unique identifier of the task to verify"),
  projectId: z
    .string()
    .optional()
    .describe("Project ID context for this verification. Required for strict project alignment."),
  focus: z
    .enum(["logic", "vibe", "debug", "security", "performance", "accessibility"])
    .optional()
    .describe(
      "Focus mode for verification: logic (test correctness), vibe (check aesthetics/UX), debug (verify fix), security (check vulnerabilities), performance (benchmark), accessibility (WCAG audit)"
    ),
});

export const completeTaskSchema = z.object({
  taskId: z
    .string()
    .uuid({ message: "Invalid task ID format, please provide a valid UUID format" })
    .describe("ID of the task to be marked as completed, must be a verified task ID "),
  projectId: z
    .string()
    .optional()
    .describe("Project ID context for this completion. Required for strict project alignment."),
  summary: z
    .string()
    .min(10, {
      message:
        "Summary cannot be less than 10 characters, please provide a clear summary of what was accomplished",
    })
    .optional()
    .describe(
      "Task completion summary, concise description of implementation results and important decisions. Saved as finalOutcome."
    ),
  lessonsLearned: z
    .string()
    .optional()
    .describe("Key lessons learned, gotchas, or advice for future tasks (context retrieval)."),
});

// =============================================================================
// CRUD Schemas
// =============================================================================

export const deleteTaskSchema = z.object({
  taskId: z
    .string()
    .uuid({ message: "Invalid task ID format, please provide a valid UUID format" })
    .optional()
    .describe("Unique identifier of the task to delete. Required unless deleteAll is true."),
  projectId: z
    .string()
    .optional()
    .describe("Project ID context for this deletion. Required for strict project alignment."),
  deleteAll: z
    .boolean()
    .optional()
    .describe("Set to true to delete all tasks in the project. Requires confirm=true."),
  confirm: z.boolean().optional().describe("Confirm deletion (required if deleteAll is true)."),
});

export const reorderTasksSchema = z.object({
  projectId: z.string().optional().describe("Project ID context by which to scope the reorder."),
  taskIds: z
    .array(z.string())
    .min(2, { message: "Please provide at least 2 task IDs to define an order." })
    .describe(
      "Ordered list of Task IDs. The server will attempt to respect this order while strictly enforcing dependency constraints (topological sort takes precedence)."
    ),
});

export const updateTaskContentSchema = z.object({
  taskId: z
    .string()
    .uuid({ message: "Invalid task ID format, please provide a valid UUID format" })
    .describe("ID of the task to update"),
  projectId: z
    .string()
    .optional()
    .describe("Project ID context for this update. Required for strict project alignment."),
  name: z.string().optional().describe("New name for the task (optional)"),
  description: z.string().optional().describe("New description for the task (optional)"),
  notes: z.string().optional().describe("New supplementary notes for the task (optional)"),
  dependencies: z
    .array(z.string())
    .optional()
    .describe("New dependency relationships for the task (optional)"),
  relatedFiles: z
    .array(
      z.object({
        path: z
          .string()
          .min(1, { message: "File path cannot be empty, please provide a valid file path" })
          .describe("Absolute path or relative to project root path"),
        type: z
          .enum(["create", "modify", "reference", "dependency", "test", "document", "other"])
          .describe("File relation type"),
        description: z.string().optional().describe("Brief description of file's relevance"),
      })
    )
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
  problemStatement: z
    .string()
    .optional()
    .describe("The specific problem this task solves (Context for future retrieval)."),
  technicalPlan: z
    .string()
    .optional()
    .describe("The technical plan/design for this task (Context for future retrieval)."),
  finalOutcome: z
    .string()
    .optional()
    .describe("The final outcome/result of the task (Context for future retrieval)."),
  lessonsLearned: z
    .string()
    .optional()
    .describe("Key lessons learned or advice (Context for future retrieval)."),
});
