/**
 * Task Tool Schemas
 * Centralized Zod schemas for all task-related tools
 */
import { z } from "zod";
export declare const planTaskSchema: z.ZodObject<{
    description: z.ZodString;
    requirements: z.ZodOptional<z.ZodString>;
    existingTasksReference: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    focus: z.ZodDefault<z.ZodOptional<z.ZodEnum<["logic", "vibe", "debug", "security", "performance", "accessibility"]>>>;
}, "strip", z.ZodTypeAny, {
    description: string;
    existingTasksReference: boolean;
    focus: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility";
    requirements?: string | undefined;
}, {
    description: string;
    requirements?: string | undefined;
    existingTasksReference?: boolean | undefined;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}>;
export declare const analyzeTaskSchema: z.ZodObject<{
    summary: z.ZodString;
    initialConcept: z.ZodString;
    previousAnalysis: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    summary: string;
    initialConcept: string;
    previousAnalysis?: string | undefined;
}, {
    summary: string;
    initialConcept: string;
    previousAnalysis?: string | undefined;
}>;
export declare const reflectTaskSchema: z.ZodObject<{
    summary: z.ZodString;
    analysis: z.ZodString;
}, "strip", z.ZodTypeAny, {
    summary: string;
    analysis: string;
}, {
    summary: string;
    analysis: string;
}>;
export declare const splitTasksSchema: z.ZodObject<{
    updateMode: z.ZodEnum<["append", "overwrite", "selective", "clearAllTasks"]>;
    tasks: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        description: z.ZodString;
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
    globalAnalysisResult?: string | undefined;
}, {
    updateMode: "append" | "overwrite" | "selective" | "clearAllTasks";
    tasks: {
        description: string;
        name: string;
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
    globalAnalysisResult?: string | undefined;
}>;
export declare const listTasksSchema: z.ZodObject<{
    status: z.ZodEnum<["all", "pending", "in_progress", "completed"]>;
}, "strip", z.ZodTypeAny, {
    status: "all" | "pending" | "in_progress" | "completed";
}, {
    status: "all" | "pending" | "in_progress" | "completed";
}>;
export declare const queryTaskSchema: z.ZodObject<{
    query: z.ZodString;
    isId: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    page: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    pageSize: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    query: string;
    isId: boolean;
    page: number;
    pageSize: number;
}, {
    query: string;
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
    focus: z.ZodOptional<z.ZodEnum<["logic", "vibe", "debug", "security", "performance", "accessibility"]>>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}, {
    taskId: string;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}>;
export declare const verifyTaskSchema: z.ZodObject<{
    taskId: z.ZodString;
    focus: z.ZodOptional<z.ZodEnum<["logic", "vibe", "debug", "security", "performance", "accessibility"]>>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}, {
    taskId: string;
    focus?: "logic" | "vibe" | "debug" | "security" | "performance" | "accessibility" | undefined;
}>;
export declare const completeTaskSchema: z.ZodObject<{
    taskId: z.ZodString;
    summary: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    taskId: string;
    summary?: string | undefined;
}, {
    taskId: string;
    summary?: string | undefined;
}>;
export declare const deleteTaskSchema: z.ZodObject<{
    taskId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    taskId: string;
}, {
    taskId: string;
}>;
export declare const clearAllTasksSchema: z.ZodObject<{
    confirm: z.ZodEffects<z.ZodBoolean, boolean, boolean>;
}, "strip", z.ZodTypeAny, {
    confirm: boolean;
}, {
    confirm: boolean;
}>;
export declare const updateTaskContentSchema: z.ZodObject<{
    taskId: z.ZodString;
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
}, "strip", z.ZodTypeAny, {
    taskId: string;
    description?: string | undefined;
    name?: string | undefined;
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
}, {
    taskId: string;
    description?: string | undefined;
    name?: string | undefined;
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
}>;
