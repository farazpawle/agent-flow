/**
 * Project Model
 * Handles CRUD operations for projects
 * Projects organize tasks and provide context for agent identification
 */

import { db } from "./db.js";
import { createHash } from "crypto";
import { getGitRemoteUrl } from "../utils/gitUtils.js";

export interface Project {
  id: string;
  name: string;
  description?: string;
  path?: string;
  gitRemoteUrl?: string;
  techStack?: string[];
  taskCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectInput {
  name: string;
  description?: string;
  path?: string;
  gitRemoteUrl?: string;
  techStack?: string[];
}

export interface DeleteProjectResult {
  projectId: string;
  projectName: string;
  deletedTaskCount: number;
  deletedWorkflowStepCount: number;
}

// Current project ID for this session
let currentProjectId: string | null = null;

/**
 * Generate a stable project ID from workspace path
 */
export function generateProjectId(workspacePath: string): string {
  const normalizedPath = workspacePath.toLowerCase().replace(/\\/g, "/").replace(/\/$/, "");
  const hash = createHash("md5").update(normalizedPath).digest("hex").substring(0, 12);
  return `proj-${hash}`;
}

/**
 * Extract project name from workspace path
 */
export function extractProjectName(workspacePath: string): string {
  const normalizedPath = workspacePath.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalizedPath.split("/");
  return parts[parts.length - 1] || "Unnamed Project";
}

/**
 * Initialize projects table - DEPRECATED/REMOVED
 * Tables are now initialized centrally by the adapter
 */
export async function initProjectsTable(): Promise<void> {
  // No-op, handled by db.init()
  return Promise.resolve();
}

/**
 * Create a new project
 */
export async function createProject(input: ProjectInput): Promise<Project> {
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

  const project: Project = {
    id,
    name: input.name,
    description: input.description,
    path: input.path,
    gitRemoteUrl: input.gitRemoteUrl,
    techStack: input.techStack,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.createProject(project);
  console.error(`[AgentFlow] Project created: ${project.name} (${project.id})`);
  return project;
}

/**
 * Get or create project from workspace path
 * This is the main auto-detection function
 */
export async function getOrCreateProjectFromPath(workspacePath: string): Promise<Project> {
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
    description: `Project at ${workspacePath}`,
  });

  currentProjectId = newProject.id;
  return newProject;
}

/**
 * Get all projects
 */
export async function getAllProjects(includeTaskCount: boolean = true): Promise<Project[]> {
  return await db.getAllProjects();
}

/**
 * Get project by ID
 */
export async function getProjectById(id: string): Promise<Project | null> {
  return await db.getProject(id);
}

/**
 * Get project by Git URL (Helper using in-memory filter for now)
 */
export async function getProjectByGitUrl(gitRemoteUrl: string): Promise<Project | null> {
  const projects = await db.getAllProjects();
  return projects.find((p) => p.gitRemoteUrl === gitRemoteUrl) || null;
}

/**
 * Get project by workspace path (Helper using in-memory filter for now)
 */
export async function getProjectByPath(workspacePath: string): Promise<Project | null> {
  const projects = await db.getAllProjects();
  // In strict mode, we should favor projects that claim this path.
  // We sort by updatedAt DESC to find the most recent usage of this path if multiple match (unlikely with path unique but possible in legacy)
  const matches = projects.filter((p) => p.path === workspacePath);
  return matches.length > 0 ? matches[0] : null;
}

/**
 * Update project
 */
export async function updateProject(
  id: string,
  updates: Partial<ProjectInput>
): Promise<Project | null> {
  const existing = await getProjectById(id);
  if (!existing) return null;

  const updated: Project = {
    ...existing,
    name: updates.name ?? existing.name,
    description: updates.description ?? existing.description,
    path: updates.path ?? existing.path,
    gitRemoteUrl: updates.gitRemoteUrl ?? existing.gitRemoteUrl,
    techStack: updates.techStack ?? existing.techStack,
    updatedAt: new Date(),
  };

  await db.createProject(updated); // Create acts as upsert
  return updated;
}

/**
 * Delete project
 */
export async function deleteProject(id: string): Promise<void> {
  return await db.deleteProject(id);
}

/**
 * Delete a project and all tasks under it using DB-level operations.
 * This intentionally bypasses task-level business restrictions used for
 * interactive single-task deletions (e.g., completed/dependent checks).
 */
export async function deleteProjectWithTasks(id: string): Promise<DeleteProjectResult> {
  const project = await getProjectById(id);
  if (!project) {
    throw new Error("Project not found");
  }

  console.error(
    `[AgentFlow] [DeleteProject] Starting deletion for project ${project.name} (${id})`
  );

  const projectTasks = await db.getAllTasks(id);
  let deletedTaskCount = 0;

  try {
    for (const task of projectTasks) {
      await db.deleteTask(task.id);
      deletedTaskCount++;
    }
  } catch (error) {
    console.error(
      `[AgentFlow] [DeleteProject] Failed while deleting tasks for project ${id} after ${deletedTaskCount} deletions`,
      error
    );
    throw error;
  }

  let deletedWorkflowStepCount = 0;
  try {
    deletedWorkflowStepCount = await db.deleteWorkflowStepsByProject(id);
  } catch (error) {
    console.error(
      `[AgentFlow] [DeleteProject] Failed while deleting workflow steps for project ${id}`,
      error
    );
    throw error;
  }

  try {
    await db.deleteProject(id);
  } catch (error) {
    console.error(
      `[AgentFlow] [DeleteProject] Failed while deleting project row for project ${id}`,
      error
    );
    throw error;
  }

  console.error(
    `[AgentFlow] [DeleteProject] Deletion complete for project ${id}. Tasks deleted: ${deletedTaskCount}, workflow steps deleted: ${deletedWorkflowStepCount}`
  );

  if (currentProjectId === id) {
    currentProjectId = null;
  }

  return {
    projectId: id,
    projectName: project.name,
    deletedTaskCount,
    deletedWorkflowStepCount,
  };
}

/**
 * Get current project ID
 */
export function getCurrentProjectId(): string | null {
  return currentProjectId;
}

/**
 * Set current project ID
 */
export function setCurrentProjectId(id: string | null): void {
  currentProjectId = id;
}

/**
 * Get current project based on workspace environment
 */
export async function getCurrentProject(): Promise<Project | null> {
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
