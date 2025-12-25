
import { getProjectById, getProjectByPath, getProjectByGitUrl, Project } from "../models/projectModel.js";
import { getGitRemoteUrl } from "./gitUtils.js";

interface ValidationResult {
    isValid: boolean;
    projectId?: string;
    error?: string;
    project?: Project;
}

/**
 * Validates project context for Strict Mode.
 * Enforces that a project_id is provided.
 * If missing, attempts to find a matching project via Git or Path and returns a helpful error message.
 */
export async function validateProjectContext(providedProjectId?: string): Promise<ValidationResult> {
    // 1. If ID provided, verify format and existence
    if (providedProjectId) {
        // Enforce UUID or proj- format
        // UUID regex (approximate) or proj- prefix
        const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(providedProjectId);
        const isProj = providedProjectId.startsWith("proj-");

        if (!isUuid && !isProj) {
            return {
                isValid: false,
                error: `Invalid Project ID format: '${providedProjectId}'. Project IDs must start with 'proj-' (e.g., 'proj-1234abcd') or be a valid UUID. Please use 'list_projects' to find the correct ID.`
            };
        }

        const project = await getProjectById(providedProjectId);
        if (project) {
            return { isValid: true, projectId: project.id, project };
        }
        return {
            isValid: false,
            error: `Project with ID '${providedProjectId}' not found. Please verify the ID using 'list_projects'.`
        };
    }

    // 2. If ID missing, attempted Discovery (Smart Rejection)
    const cwd = process.env.WORKSPACE_PATH || process.cwd();

    // Try Git detection first (Strong Identity)
    const gitUrl = await getGitRemoteUrl(cwd);
    let foundProject: Project | null = null;
    let matchMethod = 'Path';

    if (gitUrl) {
        foundProject = await getProjectByGitUrl(gitUrl);
        matchMethod = 'Git Remote URL';
    }

    // If not found by Git, try Path (Weak Identity)
    if (!foundProject) {
        foundProject = await getProjectByPath(cwd);
    }

    if (foundProject) {
        // Scenario A: Found matching project
        return {
            isValid: false,
            error: `Missing 'project_id'. Found matching project via ${matchMethod}: '${foundProject.name}' (ID: ${foundProject.id}). Please retry the tool call with project_id='${foundProject.id}'.`
        };
    }

    // Scenario B: No match found
    return {
        isValid: false,
        error: `Missing 'project_id'. No project found for current path. Please call 'list_projects' to find one or 'create_project' to register this workspace.`
    };
}
