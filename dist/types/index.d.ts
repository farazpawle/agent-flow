export declare enum TaskStatus {
    PENDING = "Pending",// Tasks that have been created but not yet started
    IN_PROGRESS = "In Progress",// Tasks currently being executed
    COMPLETED = "Completed",// Tasks that have been successfully completed and verified
    BLOCKED = "Blocked"
}
export interface TaskDependency {
    taskId: string;
}
export interface Project {
    id: string;
    name: string;
    description?: string;
    path?: string;
    techStack?: string[];
    taskCount?: number;
    createdAt: Date;
    updatedAt: Date;
}
export declare enum RelatedFileType {
    TO_MODIFY = "TO_MODIFY",// Files that need to be modified in the task
    REFERENCE = "REFERENCE",// Reference materials or related documents for the task
    CREATE = "CREATE",// Files that need to be created in the task
    DEPENDENCY = "DEPENDENCY",// Component or library files that the task depends on
    TEST = "TEST",// Test files related to the task
    DOCUMENT = "DOCUMENT",// Documentation files
    OTHER = "OTHER"
}
export interface RelatedFile {
    path: string;
    type: RelatedFileType;
    description?: string;
    lineStart?: number;
    lineEnd?: number;
}
export interface ConversationMessage {
    timestamp: Date;
    role: 'user' | 'assistant';
    content: string;
    toolName?: string;
}
export interface Task {
    id: string;
    name: string;
    description: string;
    notes?: string;
    status: TaskStatus;
    dependencies: TaskDependency[];
    createdAt: Date;
    updatedAt: Date;
    completedAt?: Date;
    summary?: string;
    relatedFiles?: RelatedFile[];
    analysisResult?: string;
    implementationGuide?: string;
    verificationCriteria?: string;
    conversationHistory?: ConversationMessage[];
    projectId?: string;
}
export interface PlanTaskArgs {
    description: string;
    requirements?: string;
}
export interface AnalyzeTaskArgs {
    summary: string;
    initialConcept: string;
    previousAnalysis?: string;
}
export interface ReflectTaskArgs {
    summary: string;
    analysis: string;
}
export interface SplitTasksArgs {
    /**
     * Task update mode (required):
     * - "append": Preserve all existing tasks and add the provided tasks
     * - "overwrite": Preserve completed tasks, but delete all incomplete tasks, then add the provided tasks
     * - "selective": Preserve all existing tasks not provided by name, update tasks with matching names
     * - "clearAllTasks": Clear all tasks and create a backup
     */
    updateMode: "append" | "overwrite" | "selective" | "clearAllTasks";
    globalAnalysisResult?: string;
    tasks: Array<{
        name: string;
        description: string;
        notes?: string;
        dependencies?: string[];
        relatedFiles?: RelatedFile[];
        implementationGuide?: string;
        verificationCriteria?: string;
    }>;
}
export interface ExecuteTaskArgs {
    taskId: string;
}
export interface VerifyTaskArgs {
    taskId: string;
}
export interface CompleteTaskArgs {
    taskId: string;
    summary?: string;
}
export declare enum TaskComplexityLevel {
    LOW = "Low Complexity",// Simple and straightforward tasks that usually do not require special handling
    MEDIUM = "Medium Complexity",// Tasks with some complexity but still manageable
    HIGH = "High Complexity",// Complex and time-consuming tasks that require special attention
    VERY_HIGH = "Very High Complexity"
}
export declare const TaskComplexityThresholds: {
    DESCRIPTION_LENGTH: {
        MEDIUM: number;
        HIGH: number;
        VERY_HIGH: number;
    };
    DEPENDENCIES_COUNT: {
        MEDIUM: number;
        HIGH: number;
        VERY_HIGH: number;
    };
    NOTES_LENGTH: {
        MEDIUM: number;
        HIGH: number;
        VERY_HIGH: number;
    };
};
export interface TaskComplexityAssessment {
    level: TaskComplexityLevel;
    metrics: {
        descriptionLength: number;
        dependenciesCount: number;
        notesLength: number;
        hasNotes: boolean;
    };
    recommendations: string[];
}
export * from "./thoughtChain.js";
