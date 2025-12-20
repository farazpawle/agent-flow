import { z } from "zod";
import { getAllProjects, getProjectById, getOrCreateProjectFromPath, updateProject, getCurrentProject, setCurrentProjectId, } from "../models/projectModel.js";
// ==================== CREATE PROJECT TOOL ====================
export const createProjectSchema = z.object({
    project_name: z
        .string()
        .describe("Human-readable project name"),
    project_description: z
        .string()
        .describe("Description of the project for agent identification across sessions. Be specific about what this project does."),
    tech_stack: z
        .array(z.string())
        .optional()
        .describe("Technologies used in the project (e.g., ['React', 'TypeScript', 'Node.js', 'PostgreSQL'])"),
    workspace_path: z
        .string()
        .optional()
        .describe("Workspace path for this project. If not provided, uses current working directory."),
});
/**
 * Create or update a project with description and metadata
 * This tool is used to create projects that agents can identify across sessions
 */
export async function createProject(params) {
    try {
        // Get workspace path
        const workspacePath = params.workspace_path || process.env.WORKSPACE_PATH || process.cwd();
        // Get or create project from workspace
        let project = await getOrCreateProjectFromPath(workspacePath);
        // Update project with provided information
        project = await updateProject(project.id, {
            name: params.project_name,
            description: params.project_description,
            techStack: params.tech_stack || [],
        }) || project;
        // Set as current project for the session
        setCurrentProjectId(project.id);
        // Return project details
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        project: {
                            id: project.id,
                            name: project.name,
                            description: project.description,
                            path: project.path,
                            techStack: project.techStack || [],
                        },
                        message: `Project "${project.name}" created/updated successfully`,
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        success: false,
                        error: `Failed to create project: ${errorMessage}`,
                    }, null, 2),
                },
            ],
        };
    }
}
// ==================== LIST PROJECTS TOOL ====================
export const listProjectsSchema = z.object({
    include_task_count: z
        .boolean()
        .optional()
        .default(true)
        .describe("Include the number of tasks per project (default: true)"),
});
/**
 * List all available projects with descriptions
 * Agent uses this to identify which project to work on across sessions
 */
export async function listProjects(params) {
    try {
        const projects = await getAllProjects(params.include_task_count);
        if (projects.length === 0) {
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            projects: [],
                            message: "No projects found. Use create_project to create a project.",
                        }, null, 2),
                    },
                ],
            };
        }
        // Format projects for agent consumption
        const formattedProjects = projects.map(p => ({
            id: p.id,
            name: p.name,
            description: p.description || "No description",
            path: p.path,
            techStack: p.techStack || [],
            taskCount: p.taskCount || 0,
            lastActivity: p.updatedAt.toISOString(),
        }));
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        projects: formattedProjects,
                        count: formattedProjects.length,
                        hint: "Read project descriptions to identify which project you're working on. Use project_id when creating tasks.",
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
            content: [
                {
                    type: "text",
                    text: `Error listing projects: ${errorMessage}`,
                },
            ],
        };
    }
}
// ==================== GET PROJECT CONTEXT TOOL ====================
export const getProjectContextSchema = z.object({
    workspace_path: z
        .string()
        .optional()
        .describe("Override workspace path detection (optional, uses current working directory if not provided)"),
    project_id: z
        .string()
        .optional()
        .describe("Get a specific project by ID instead of auto-detecting from workspace"),
});
/**
 * Get project context for the current workspace or specific project
 * Agent uses this at session start to understand current project
 */
export async function getProjectContext(params) {
    try {
        let project = null;
        let isNew = false;
        if (params.project_id) {
            // Get specific project by ID
            project = await getProjectById(params.project_id);
            if (!project) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                error: `Project not found: ${params.project_id}`,
                                hint: "Use list_projects to see available projects",
                            }, null, 2),
                        },
                    ],
                };
            }
        }
        else {
            // Auto-detect from workspace
            const workspacePath = params.workspace_path || process.env.WORKSPACE_PATH || process.cwd();
            const existingProject = await getCurrentProject();
            if (existingProject && existingProject.path === workspacePath) {
                project = existingProject;
            }
            else {
                // Get or create project from workspace
                project = await getOrCreateProjectFromPath(workspacePath);
                isNew = !existingProject;
            }
        }
        // Set as current project for the session
        setCurrentProjectId(project.id);
        return {
            content: [
                {
                    type: "text",
                    text: JSON.stringify({
                        project: {
                            id: project.id,
                            name: project.name,
                            description: project.description || "No description set",
                            path: project.path,
                            techStack: project.techStack || [],
                            taskCount: project.taskCount || 0,
                        },
                        isNew,
                        message: isNew
                            ? `Created new project: ${project.name}`
                            : `Found existing project: ${project.name}`,
                        hint: "This project is now active. Tasks will be assigned to this project.",
                    }, null, 2),
                },
            ],
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        return {
            content: [
                {
                    type: "text",
                    text: `Error getting project context: ${errorMessage}`,
                },
            ],
        };
    }
}
//# sourceMappingURL=projectTools.js.map