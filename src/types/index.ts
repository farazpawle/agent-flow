// Task status enumeration: defines the current stage of a task in the workflow
export enum TaskStatus {
  PENDING = "Pending", // Tasks that have been created but not yet started
  IN_PROGRESS = "In Progress", // Tasks currently being executed
  COMPLETED = "Completed", // Tasks that have been successfully completed and verified
  BLOCKED = "Blocked", // Tasks that cannot be executed temporarily due to dependencies
}

// Task dependency: defines prerequisite relationships between tasks
export interface TaskDependency {
  taskId: string; // Unique identifier of the prerequisite task that must be completed before the current task
}

// Project: defines a project that contains related tasks
export interface Project {
  id: string; // Unique identifier of the project
  name: string; // Human-readable project name
  description?: string; // Description for agent identification across sessions
  path?: string; // Workspace path associated with this project
  techStack?: string[]; // Technologies used in this project
  taskCount?: number; // Number of tasks in this project
  createdAt: Date; // Timestamp when the project was created
  updatedAt: Date; // Timestamp when the project was last updated
}

// Related file type: defines the relationship type between files and tasks
export enum RelatedFileType {
  TO_MODIFY = "TO_MODIFY", // Files that need to be modified in the task
  REFERENCE = "REFERENCE", // Reference materials or related documents for the task
  CREATE = "CREATE", // Files that need to be created in the task
  DEPENDENCY = "DEPENDENCY", // Component or library files that the task depends on
  TEST = "TEST", // Test files related to the task
  DOCUMENT = "DOCUMENT", // Documentation files
  OTHER = "OTHER", // Other types of related files
}

// Related file: defines information about files related to a task
export interface RelatedFile {
  path: string; // File path, can be relative to the project root directory or an absolute path
  type: RelatedFileType; // Type of relationship between the file and the task
  description?: string; // Supplementary description of the file, explaining its specific relationship or purpose to the task
}

// Task interface: defines the complete data structure of a task
export interface Task {
  id: string; // Unique identifier of the task
  name: string; // Concise and clear task name
  description: string; // Detailed task description, including implementation points and acceptance criteria
  notes?: string; // Supplementary notes, special processing requirements, or implementation suggestions (optional)
  status: TaskStatus; // Current execution status of the task
  dependencies: TaskDependency[]; // List of prerequisite dependencies for the task

  // Context Fields
  problemStatement?: string; // The "Why": Problem context
  technicalPlan?: string; // The "How": Technical approach (from Idea Phase analysis/review)
  finalOutcome?: string; // The "What": Final result
  lessonsLearned?: string; // The "Advice": Key learnings for future reference

  createdAt: Date; // Timestamp when the task was created
  updatedAt: Date; // Timestamp when the task was last updated
  completedAt?: Date; // Timestamp when the task was completed (only applicable to completed tasks)
  summary?: string; // Task completion summary, concisely describing implementation results and important decisions (only applicable to completed tasks)
  relatedFiles?: RelatedFile[]; // List of files related to the task (optional)

  // Additional field: save specific implementation guidelines
  implementationGuide?: string; // Specific implementation methods, steps, and suggestions

  // Additional field: save verification standards and testing methods
  verificationCriteria?: string; // Clear verification standards, test points, and acceptance conditions
  verificationStatus?: string; // Verification status (e.g. 'passed') per workflow spec

  // Project association: links task to a specific project
  projectId?: string; // ID of the project this task belongs to

  // Task execution order: defines the sequence in which tasks should be executed
  executionOrder?: number; // 0-indexed integer, used to sort tasks in UI and agent execution

  // Optimistic concurrency (Phase 1 Group 1.3). Source of truth is the `tasks.version`
  // DB column; bumped by `incrementTaskVersion`. Returned by every task read so the
  // caller can echo it back as `expectedVersion` on the next mutating tool call.
  version?: number;

  // Wave 1 §10.C — multi-agent lock. Source of truth is the dedicated
  // `claimed_by` / `claimed_at` / `claim_expires_at` columns (NOT the JSON
  // blob). Set by `claim`/`start`/`heartbeat`, cleared by `release`/
  // `finalize`/`block`/`archive` or by read-time recovery when expired.
  claimedBy?: string;
  claimedAt?: Date;
  claimExpiresAt?: Date;

  // Wave 1 §10.D — task groups + parent/child hierarchy. Source of truth
  // is the dedicated `group_id` / `parent_task_id` columns (NOT the JSON
  // blob) so DAG queries can join cheaply.
  groupId?: string;
  parentTaskId?: string;
}

// Wave 1 §10.D — task group definition (one `task.md` ≈ one group). Tasks
// in the same group form a feature/epic cluster within a project.
export interface TaskGroup {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  /** Lifecycle status of the group itself: 'active' | 'completed' | 'archived'. */
  status: "active" | "completed" | "archived";
  /**
   * Self-referential parent (feature-hierarchy). A **Feature** is a group with
   * `parentGroupId === undefined`; a **section Group** points at its feature.
   * Strictly one level deep: a group whose parent already has a parent is invalid.
   */
  parentGroupId?: string;
  /** Ordinal of this group within its feature (drives derived `1, 2, …` numbering). */
  executionOrder?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TaskGroupInput {
  id?: string;
  projectId: string;
  name: string;
  description?: string;
  status?: "active" | "completed" | "archived";
  /** Feature id when creating a section group; omit/null for a feature. */
  parentGroupId?: string;
  /** Ordinal within the feature; defaults to 0. */
  executionOrder?: number;
}

// Parameters for planning a task: used to initialize the task planning phase
export interface PlanTaskArgs {
  description: string; // Comprehensive and detailed task problem description, should include task objectives, background, and expected outcomes
  requirements?: string; // Specific technical requirements, business constraints, or quality standards for the task (optional)
}

// Parameters for analyzing a problem: used for in-depth task analysis and proposing technical solutions
export interface AnalyzeTaskArgs {
  summary: string; // Structured task summary, including task objectives, scope, and key technical challenges
  initialConcept: string; // Initial solution concept, including technical solutions, architectural design, and implementation strategy
  previousAnalysis?: string; // Analysis results from previous iterations, used for continuous improvement of the solution (only required for reanalysis)
}

// Parameters for reflecting on a concept: used for critical evaluation of analysis results
export interface ReflectTaskArgs {
  summary: string; // Structured task summary, keeping consistent with the analysis phase to ensure continuity
  analysis: string; // Comprehensive and thorough technical analysis results, including all technical details, dependent components, and implementation plans
}

// Parameters for splitting tasks: used to break down large tasks into manageable smaller tasks
export interface SplitTasksArgs {
  /**
   * Task update mode (required):
   * - "append": Preserve all existing tasks and add the provided tasks
   * - "overwrite": Preserve completed tasks, but delete all incomplete tasks, then add the provided tasks
   * - "selective": Preserve all existing tasks not provided by name, update tasks with matching names
   * - "clearAllTasks": Clear all tasks and create a backup
   */
  updateMode: "append" | "overwrite" | "selective" | "clearAllTasks";

  tasks: Array<{
    name: string; // Concise and clear task name that should clearly express the task purpose
    description: string; // Detailed task description, including implementation points, technical details, and acceptance criteria
    notes?: string; // Supplementary notes, special processing requirements, or implementation suggestions (optional)
    dependencies?: string[]; // List of prerequisite task IDs that this task depends on, forming a directed acyclic dependency graph
    relatedFiles?: RelatedFile[]; // List of files related to the task (optional)

    // Additional field: task-specific implementation guidelines
    implementationGuide?: string; // Specific implementation methods and steps for this particular task

    // Additional field: task-specific verification standards
    verificationCriteria?: string; // Verification standards and testing methods for this particular task
  }>;
}

// Parameters for listing tasks (none)

// Parameters for executing a task: used to start executing a specific task
export interface ExecuteTaskArgs {
  taskId: string; // Unique identifier of the task to be executed, must be a valid task ID existing in the system
}

// Parameters for verifying a task: used to evaluate the completion quality of a task
export interface VerifyTaskArgs {
  taskId: string; // Unique identifier of the task to be verified, must be a valid task ID with "In Progress" status
}

// Parameters for completing a task: used to mark a task as completed
export interface CompleteTaskArgs {
  taskId: string; // Unique identifier of the task to be marked as completed, must be a valid task ID with "In Progress" status
  summary?: string; // Task completion summary, concisely describing implementation results and important decisions (optional, will be automatically generated if not provided)
}

// Task complexity level: defines the classification of task complexity
export enum TaskComplexityLevel {
  LOW = "Low Complexity", // Simple and straightforward tasks that usually do not require special handling
  MEDIUM = "Medium Complexity", // Tasks with some complexity but still manageable
  HIGH = "High Complexity", // Complex and time-consuming tasks that require special attention
  VERY_HIGH = "Very High Complexity", // Extremely complex tasks that are recommended to be broken down
}

// Task complexity thresholds: defines reference standards for task complexity assessment
export const TaskComplexityThresholds = {
  DESCRIPTION_LENGTH: {
    MEDIUM: 500, // Exceeding this word count is determined as medium complexity
    HIGH: 1000, // Exceeding this word count is determined as high complexity
    VERY_HIGH: 2000, // Exceeding this word count is determined as very high complexity
  },
  DEPENDENCIES_COUNT: {
    MEDIUM: 2, // Exceeding this number of dependencies is determined as medium complexity
    HIGH: 5, // Exceeding this number of dependencies is determined as high complexity
    VERY_HIGH: 10, // Exceeding this number of dependencies is determined as very high complexity
  },
  NOTES_LENGTH: {
    MEDIUM: 200, // Exceeding this word count is determined as medium complexity
    HIGH: 500, // Exceeding this word count is determined as high complexity
    VERY_HIGH: 1000, // Exceeding this word count is determined as very high complexity
  },
};

// Task complexity assessment result: records detailed results of task complexity analysis
export interface TaskComplexityAssessment {
  level: TaskComplexityLevel; // Overall complexity level
  metrics: {
    // Detailed data for each evaluation metric
    descriptionLength: number; // Length of description
    dependenciesCount: number; // Number of dependencies
    notesLength: number; // Length of notes
    hasNotes: boolean; // Whether notes are present
  };
  recommendations: string[]; // List of handling recommendations
}

// Thought chain data structure
export * from "./thoughtChain.js";
