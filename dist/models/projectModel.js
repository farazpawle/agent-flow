/**
 * Project Model
 * Handles CRUD operations for projects
 * Projects organize tasks and provide context for agent identification
 */
import { db } from "./db.js";
import { createHash } from "crypto";
import { getGitRemoteUrl } from "../utils/gitUtils.js";
// Current project ID for this session
let currentProjectId = null;
/**
 * Generate a stable project ID from workspace path
 */
export function generateProjectId(workspacePath) {
    const normalizedPath = workspacePath.toLowerCase().replace(/\\/g, '/').replace(/\/$/, '');
    const hash = createHash('md5').update(normalizedPath).digest('hex').substring(0, 12);
    return `proj-${hash}`;
}
/**
 * Extract project name from workspace path
 */
export function extractProjectName(workspacePath) {
    const normalizedPath = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');
    const parts = normalizedPath.split('/');
    return parts[parts.length - 1] || 'Unnamed Project';
}
/**
 * Initialize projects table - DEPRECATED/REMOVED
 * Tables are now initialized centrally by the adapter
 */
export async function initProjectsTable() {
    // No-op, handled by db.init()
    return Promise.resolve();
}
/**
 * Create a new project
 */
export async function createProject(input) {
    // If gitRemoteUrl is provided, try to find existing project first
    if (input.gitRemoteUrl) {
        const existing = await getProjectByGitUrl(input.gitRemoteUrl);
        if (existing) {
            // If we have a path update, we might want to update the existing project's path
            if (input.path && input.path !== existing.path) {
                await updateProject(existing.id, { path: input.path });
                existing.path = input.path;
            }
            return existing;
        }
    }
    const id = input.path ? generateProjectId(input.path) : `proj-${Date.now()}`;
    const project = {
        id,
        name: input.name,
        description: input.description,
        path: input.path,
        gitRemoteUrl: input.gitRemoteUrl,
        techStack: input.techStack,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    await db.createProject(project);
    console.error(`[AgentFlow] Project created: ${project.name} (${project.id})`);
    return project;
}
/**
 * Get or create project from workspace path
 * This is the main auto-detection function
 */
export async function getOrCreateProjectFromPath(workspacePath) {
    // 1. Try to detect Git URL
    const gitUrl = await getGitRemoteUrl(workspacePath);
    if (gitUrl) {
        const existingByGit = await getProjectByGitUrl(gitUrl);
        if (existingByGit) {
            // Update path if changed (last active location)
            if (existingByGit.path !== workspacePath) {
                await updateProject(existingByGit.id, { path: workspacePath });
                existingByGit.path = workspacePath;
            }
            currentProjectId = existingByGit.id;
            return existingByGit;
        }
    }
    // 2. Fallback to Path lookup
    const existingProject = await getProjectByPath(workspacePath);
    if (existingProject) {
        // If we found it by path but it now has a git URL (and didn't before), update it?
        // Or if we found it by path, we just use it. 
        // If gitUrl was found but project has none, update it.
        if (gitUrl && !existingProject.gitRemoteUrl) {
            await updateProject(existingProject.id, { gitRemoteUrl: gitUrl });
            existingProject.gitRemoteUrl = gitUrl;
        }
        currentProjectId = existingProject.id;
        return existingProject;
    }
    // 3. Create new project
    const projectName = extractProjectName(workspacePath);
    const newProject = await createProject({
        name: projectName,
        path: workspacePath,
        gitRemoteUrl: gitUrl || undefined,
        description: `Project at ${workspacePath}`
    });
    currentProjectId = newProject.id;
    return newProject;
}
/**
 * Get all projects
 */
export async function getAllProjects(includeTaskCount = true) {
    return await db.getAllProjects();
}
/**
 * Get project by ID
 */
export async function getProjectById(id) {
    return await db.getProject(id);
}
/**
 * Get project by Git URL (Helper using in-memory filter for now)
 */
export async function getProjectByGitUrl(gitRemoteUrl) {
    const projects = await db.getAllProjects();
    return projects.find(p => p.gitRemoteUrl === gitRemoteUrl) || null;
}
/**
 * Get project by workspace path (Helper using in-memory filter for now)
 */
export async function getProjectByPath(workspacePath) {
    const projects = await db.getAllProjects();
    // In strict mode, we should favor projects that claim this path.
    // We sort by updatedAt DESC to find the most recent usage of this path if multiple match (unlikely with path unique but possible in legacy)
    const matches = projects.filter(p => p.path === workspacePath);
    return matches.length > 0 ? matches[0] : null;
}
/**
 * Update project
 */
export async function updateProject(id, updates) {
    const existing = await getProjectById(id);
    if (!existing)
        return null;
    const updated = {
        ...existing,
        name: updates.name ?? existing.name,
        description: updates.description ?? existing.description,
        path: updates.path ?? existing.path,
        gitRemoteUrl: updates.gitRemoteUrl ?? existing.gitRemoteUrl,
        techStack: updates.techStack ?? existing.techStack,
        updatedAt: new Date()
    };
    await db.createProject(updated); // Create acts as upsert
    return updated;
}
/**
 * Delete project
 */
export async function deleteProject(id) {
    return await db.deleteProject(id);
}
/**
 * Get current project ID
 */
export function getCurrentProjectId() {
    return currentProjectId;
}
/**
 * Set current project ID
 */
export function setCurrentProjectId(id) {
    currentProjectId = id;
}
/**
 * Get current project based on workspace environment
 */
export async function getCurrentProject() {
    // First check if we have a current project ID set
    if (currentProjectId) {
        return getProjectById(currentProjectId);
    }
    // Try to detect from workspace path
    const workspacePath = process.env.WORKSPACE_PATH || process.cwd();
    const project = await getProjectByPath(workspacePath);
    if (project) {
        currentProjectId = project.id;
    }
    return project;
}
//# sourceMappingURL=projectModel.js.map