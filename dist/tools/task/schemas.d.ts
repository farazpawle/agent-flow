/**
 * Task Tool Schemas
 * Centralized Zod schemas for all task-related tools
 */
import { z } from "zod";
export declare const planIdeaSchema: z.ZodObject<{
    description: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    requirements: z.ZodOptional<z.ZodString>;
    focus: z.ZodDefault<z.ZodOptional<z.ZodEnum<["logic", "vibe", "debug", "security", "performance", "accessibility"]>>>;
}, "strip", z.ZodTypeAny, {
    description: string;
    focus: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility";
    projectId?: string | undefined;
    requirements?: string | undefined;
}, {
    description: string;
    projectId?: string | undefined;
    requirements?: string | undefined;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}>;
export declare const analyzeIdeaSchema: z.ZodObject<{
    inputStepId: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    inputStepId: string;
    projectId?: string | undefined;
}, {
    inputStepId: string;
    projectId?: string | undefined;
}>;
export declare const reflectIdeaSchema: z.ZodObject<{
    inputStepId: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    analysis: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    inputStepId: string;
    projectId?: string | undefined;
    analysis?: string | undefined;
}, {
    inputStepId: string;
    projectId?: string | undefined;
    analysis?: string | undefined;
}>;
export declare const splitTasksSchema: z.ZodObject<{
    updateMode: z.ZodEnum<["append", "overwrite", "selective", "clearAllTasks"]>;
    inputStepId: z.ZodOptional<z.ZodString>;
    projectId: z.ZodOptional<z.ZodString>;
    tasks: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
        problemStatement: z.ZodOptional<z.ZodString>;
        dependencies: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        notes: z.ZodOptional<z.ZodString>;
        relatedFiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
            path: z.ZodString;
            type: z.ZodEnum<["create", "modify", "reference", "dependency", "test", "document", "other"]>;
            description: z.ZodOptional<z.ZodString>;
            lineStart: z.ZodOptional<z.ZodNumber>;
            lineEnd: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            path: string;
            type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
            description?: string | undefined;
            lineStart?: number | undefined;
            lineEnd?: number | undefined;
        }, {
            path: string;
            type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
            description?: string | undefined;
            lineStart?: number | undefined;
            lineEnd?: number | undefined;
        }>, "many">>;
        implementationGuide: z.ZodOptional<z.ZodString>;
        verificationCriteria: z.ZodOptional<z.ZodString>;
        category: z.ZodOptional<z.ZodEnum<["feature", "bugfix", "refactor", "test", "docs", "config", "frontend", "backend", "database", "devops", "design", "research"]>>;
        priority: z.ZodDefault<z.ZodOptional<z.ZodEnum<["critical", "high", "medium", "low"]>>>;
    }, "strip", z.ZodTypeAny, {
        description: string;
        name: string;
        priority: "critical" | "high" | "medium" | "low";
        problemStatement?: string | undefined;
        dependencies?: string[] | undefined;
        notes?: string | undefined;
        relatedFiles?: {
            path: string;
            type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
            description?: string | undefined;
            lineStart?: number | undefined;
            lineEnd?: number | undefined;
        }[] | undefined;
        implementationGuide?: string | undefined;
        verificationCriteria?: string | undefined;
        category?: "test" | "feature" | "bugfix" | "refactor" | "docs" | "config" | "frontend" | "backend" | "database" | "devops" | "design" | "research" | undefined;
    }, {
        description: string;
        name: string;
        problemStatement?: string | undefined;
        dependencies?: string[] | undefined;
        notes?: string | undefined;
        relatedFiles?: {
            path: string;
            type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
            description?: string | undefined;
            lineStart?: number | undefined;
            lineEnd?: number | undefined;
        }[] | undefined;
        implementationGuide?: string | undefined;
        verificationCriteria?: string | undefined;
        category?: "test" | "feature" | "bugfix" | "refactor" | "docs" | "config" | "frontend" | "backend" | "database" | "devops" | "design" | "research" | undefined;
        priority?: "critical" | "high" | "medium" | "low" | undefined;
    }>, "many">;
    globalAnalysisResult: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    updateMode: "append" | "overwrite" | "selective" | "clearAllTasks";
    tasks: {
        description: string;
        name: string;
        priority: "critical" | "high" | "medium" | "low";
        problemStatement?: string | undefined;
        dependencies?: string[] | undefined;
        notes?: string | undefined;
        relatedFiles?: {
            path: string;
            type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
            description?: string | undefined;
            lineStart?: number | undefined;
            lineEnd?: number | undefined;
        }[] | undefined;
        implementationGuide?: string | undefined;
        verificationCriteria?: string | undefined;
        category?: "test" | "feature" | "bugfix" | "refactor" | "docs" | "config" | "frontend" | "backend" | "database" | "devops" | "design" | "research" | undefined;
    }[];
    projectId?: string | undefined;
    inputStepId?: string | undefined;
    globalAnalysisResult?: string | undefined;
}, {
    updateMode: "append" | "overwrite" | "selective" | "clearAllTasks";
    tasks: {
        description: string;
        name: string;
        problemStatement?: string | undefined;
        dependencies?: string[] | undefined;
        notes?: string | undefined;
        relatedFiles?: {
            path: string;
            type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
            description?: string | undefined;
            lineStart?: number | undefined;
            lineEnd?: number | undefined;
        }[] | undefined;
        implementationGuide?: string | undefined;
        verificationCriteria?: string | undefined;
        category?: "test" | "feature" | "bugfix" | "refactor" | "docs" | "config" | "frontend" | "backend" | "database" | "devops" | "design" | "research" | undefined;
        priority?: "critical" | "high" | "medium" | "low" | undefined;
    }[];
    projectId?: string | undefined;
    inputStepId?: string | undefined;
    globalAnalysisResult?: string | undefined;
}>;
export declare const listTasksSchema: z.ZodObject<{
    status: z.ZodEnum<["all", "pending", "in_progress", "completed"]>;
    projectId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "all" | "pending" | "in_progress" | "completed";
    projectId?: string | undefined;
}, {
    status: "all" | "pending" | "in_progress" | "completed";
    projectId?: string | undefined;
}>;
export declare const queryTaskSchema: z.ZodObject<{
    query: z.ZodString;
    isId: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    page: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    pageSize: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    projectId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    query: string;
    isId: boolean;
    page: number;
    pageSize: number;
    projectId?: string | undefined;
}, {
    query: string;
    projectId?: string | undefined;
    isId?: boolean | undefined;
    page?: number | undefined;
    pageSize?: number | undefined;
}>;
export declare const getTaskDetailSchema: z.ZodObject<{
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    taskId: string;
}, {
    taskId: string;
}>;
export declare const executeTaskSchema: z.ZodObject<{
    taskId: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    focus: z.ZodOptional<z.ZodEnum<["logic", "vibe", "debug", "security", "performance", "accessibility"]>>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    projectId?: string | undefined;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}, {
    taskId: string;
    projectId?: string | undefined;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}>;
export declare const verifyTaskSchema: z.ZodObject<{
    taskId: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    focus: z.ZodOptional<z.ZodEnum<["logic", "vibe", "debug", "security", "performance", "accessibility"]>>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    projectId?: string | undefined;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}, {
    taskId: string;
    projectId?: string | undefined;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}>;
export declare const completeTaskSchema: z.ZodObject<{
    taskId: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    summary: z.ZodOptional<z.ZodString>;
    lessonsLearned: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    projectId?: string | undefined;
    summary?: string | undefined;
    lessonsLearned?: string | undefined;
}, {
    taskId: string;
    projectId?: string | undefined;
    summary?: string | undefined;
    lessonsLearned?: string | undefined;
}>;
export declare const deleteTaskSchema: z.ZodObject<{
    taskId: z.ZodOptional<z.ZodString>;
    projectId: z.ZodOptional<z.ZodString>;
    deleteAll: z.ZodOptional<z.ZodBoolean>;
    confirm: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    projectId?: string | undefined;
    taskId?: string | undefined;
    deleteAll?: boolean | undefined;
    confirm?: boolean | undefined;
}, {
    projectId?: string | undefined;
    taskId?: string | undefined;
    deleteAll?: boolean | undefined;
    confirm?: boolean | undefined;
}>;
export declare const reorderTasksSchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    taskIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    taskIds: string[];
    projectId?: string | undefined;
}, {
    taskIds: string[];
    projectId?: string | undefined;
}>;
export declare const updateTaskContentSchema: z.ZodObject<{
    taskId: z.ZodString;
    projectId: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    notes: z.ZodOptional<z.ZodString>;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    relatedFiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
        path: z.ZodString;
        type: z.ZodEnum<["create", "modify", "reference", "dependency", "test", "document", "other"]>;
        description: z.ZodOptional<z.ZodString>;
        lineStart: z.ZodOptional<z.ZodNumber>;
        lineEnd: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        path: string;
        type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
        description?: string | undefined;
        lineStart?: number | undefined;
        lineEnd?: number | undefined;
    }, {
        path: string;
        type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
        description?: string | undefined;
        lineStart?: number | undefined;
        lineEnd?: number | undefined;
    }>, "many">>;
    implementationGuide: z.ZodOptional<z.ZodString>;
    verificationCriteria: z.ZodOptional<z.ZodString>;
    problemStatement: z.ZodOptional<z.ZodString>;
    technicalPlan: z.ZodOptional<z.ZodString>;
    finalOutcome: z.ZodOptional<z.ZodString>;
    lessonsLearned: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    description?: string | undefined;
    projectId?: string | undefined;
    name?: string | undefined;
    problemStatement?: string | undefined;
    dependencies?: string[] | undefined;
    notes?: string | undefined;
    relatedFiles?: {
        path: string;
        type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
        description?: string | undefined;
        lineStart?: number | undefined;
        lineEnd?: number | undefined;
    }[] | undefined;
    implementationGuide?: string | undefined;
    verificationCriteria?: string | undefined;
    lessonsLearned?: string | undefined;
    technicalPlan?: string | undefined;
    finalOutcome?: string | undefined;
}, {
    taskId: string;
    description?: string | undefined;
    projectId?: string | undefined;
    name?: string | undefined;
    problemStatement?: string | undefined;
    dependencies?: string[] | undefined;
    notes?: string | undefined;
    relatedFiles?: {
        path: string;
        type: "create" | "modify" | "reference" | "dependency" | "test" | "document" | "other";
        description?: string | undefined;
        lineStart?: number | undefined;
        lineEnd?: number | undefined;
    }[] | undefined;
    implementationGuide?: string | undefined;
    verificationCriteria?: string | undefined;
    lessonsLearned?: string | undefined;
    technicalPlan?: string | undefined;
    finalOutcome?: string | undefined;
}>;
