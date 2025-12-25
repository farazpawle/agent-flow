/**
 * Project Model
 * Handles CRUD operations for projects
 * Projects organize tasks and provide context for agent identification
 */
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
/**
 * Generate a stable project ID from workspace path
 */
export declare function generateProjectId(workspacePath: string): string;
/**
 * Extract project name from workspace path
 */
export declare function extractProjectName(workspacePath: string): string;
/**
 * Initialize projects table - DEPRECATED/REMOVED
 * Tables are now initialized centrally by the adapter
 */
export declare function initProjectsTable(): Promise<void>;
/**
 * Create a new project
 */
export declare function createProject(input: ProjectInput): Promise<Project>;
/**
 * Get or create project from workspace path
 * This is the main auto-detection function
 */
export declare function getOrCreateProjectFromPath(workspacePath: string): Promise<Project>;
/**
 * Get all projects
 */
export declare function getAllProjects(includeTaskCount?: boolean): Promise<Project[]>;
/**
 * Get project by ID
 */
export declare function getProjectById(id: string): Promise<Project | null>;
/**
 * Get project by Git URL (Helper using in-memory filter for now)
 */
export declare function getProjectByGitUrl(gitRemoteUrl: string): Promise<Project | null>;
/**
 * Get project by workspace path (Helper using in-memory filter for now)
 */
export declare function getProjectByPath(workspacePath: string): Promise<Project | null>;
/**
 * Update project
 */
export declare function updateProject(id: string, updates: Partial<ProjectInput>): Promise<Project | null>;
/**
 * Delete project
 */
export declare function deleteProject(id: string): Promise<void>;
/**
 * Get current project ID
 */
export declare function getCurrentProjectId(): string | null;
/**
 * Set current project ID
 */
export declare function setCurrentProjectId(id: string | null): void;
/**
 * Get current project based on workspace environment
 */
export declare function getCurrentProject(): Promise<Project | null>;
