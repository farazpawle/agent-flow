import { z } from "zod";
export declare const createProjectSchema: z.ZodObject<{
    project_name: z.ZodString;
    project_description: z.ZodString;
    tech_stack: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    workspace_path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    project_name: string;
    project_description: string;
    tech_stack?: string[] | undefined;
    workspace_path?: string | undefined;
}, {
    project_name: string;
    project_description: string;
    tech_stack?: string[] | undefined;
    workspace_path?: string | undefined;
}>;
/**
 * Create or update a project with description and metadata
 * This tool is used to create projects that agents can identify across sessions
 */
export declare function createProject(params: z.infer<typeof createProjectSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare const listProjectsSchema: z.ZodObject<{
    include_task_count: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
}, "strip", z.ZodTypeAny, {
    include_task_count: boolean;
}, {
    include_task_count?: boolean | undefined;
}>;
/**
 * List all available projects with descriptions
 * Agent uses this to identify which project to work on across sessions
 */
export declare function listProjects(params: z.infer<typeof listProjectsSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare const getProjectContextSchema: z.ZodObject<{
    workspace_path: z.ZodOptional<z.ZodString>;
    project_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    workspace_path?: string | undefined;
    project_id?: string | undefined;
}, {
    workspace_path?: string | undefined;
    project_id?: string | undefined;
}>;
/**
 * Get project context for the current workspace or specific project
 * Agent uses this at session start to understand current project
 */
export declare function getProjectContext(params: z.infer<typeof getProjectContextSchema>): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
