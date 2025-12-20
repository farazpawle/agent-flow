/**
 * Project Model
 * Handles CRUD operations for projects
 * Projects organize tasks and provide context for agent identification
 */
import { db as database } from "./db.js";
import { createHash } from "crypto";
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
 * Initialize projects table
 */
export async function initProjectsTable() {
    return new Promise((resolve, reject) => {
        database.getDb().serialize(() => {
            // Create projects table
            database.getDb().run(`
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    description TEXT,
                    path TEXT UNIQUE,
                    tech_stack TEXT,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                )
            `, (err) => {
                if (err) {
                    console.error("[CoT] Failed to create projects table:", err);
                    reject(err);
                    return;
                }
            });
            // Add project_id column to tasks if not exists
            database.getDb().run(`ALTER TABLE tasks ADD COLUMN project_id TEXT`, (err) => {
                // Ignore error if column already exists
            });
            // Create index on project_id
            database.getDb().run(`CREATE INDEX IF NOT EXISTS idx_project_id ON tasks(project_id)`, (err) => {
                // Ignore if exists
            });
            resolve();
        });
    });
}
/**
 * Create a new project
 */
export async function createProject(input) {
    const id = input.path ? generateProjectId(input.path) : `proj-${Date.now()}`;
    const project = {
        id,
        name: input.name,
        description: input.description,
        path: input.path,
        techStack: input.techStack,
        createdAt: new Date(),
        updatedAt: new Date()
    };
    return new Promise((resolve, reject) => {
        database.getDb().run(`
            INSERT OR REPLACE INTO projects (
                id, name, description, path, tech_stack, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            project.id,
            project.name,
            project.description || null,
            project.path || null,
            project.techStack ? JSON.stringify(project.techStack) : null,
            project.createdAt.getTime(),
            project.updatedAt.getTime()
        ], function (err) {
            if (err) {
                console.error("[CoT] Failed to create project:", err);
                reject(err);
            }
            else {
                console.error(`[CoT] Project created: ${project.name} (${project.id})`);
                resolve(project);
            }
        });
    });
}
/**
 * Get or create project from workspace path
 * This is the main auto-detection function
 */
export async function getOrCreateProjectFromPath(workspacePath) {
    const existingProject = await getProjectByPath(workspacePath);
    if (existingProject) {
        currentProjectId = existingProject.id;
        return existingProject;
    }
    // Create new project from workspace path
    const projectName = extractProjectName(workspacePath);
    const newProject = await createProject({
        name: projectName,
        path: workspacePath,
        description: `Project at ${workspacePath}`
    });
    currentProjectId = newProject.id;
    return newProject;
}
/**
 * Get all projects
 */
export async function getAllProjects(includeTaskCount = true) {
    return new Promise((resolve, reject) => {
        let query = `SELECT * FROM projects ORDER BY updated_at DESC`;
        if (includeTaskCount) {
            query = `
                SELECT p.*, COUNT(t.id) as task_count 
                FROM projects p
                LEFT JOIN tasks t ON t.project_id = p.id
                GROUP BY p.id
                ORDER BY p.updated_at DESC
            `;
        }
        database.getDb().all(query, (err, rows) => {
            if (err) {
                if (err.message?.includes('no such table')) {
                    resolve([]);
                    return;
                }
                reject(err);
            }
            else {
                const projects = rows?.map(row => ({
                    id: row.id,
                    name: row.name,
                    description: row.description,
                    path: row.path,
                    techStack: row.tech_stack ? JSON.parse(row.tech_stack) : [],
                    taskCount: row.task_count || 0,
                    createdAt: new Date(row.created_at),
                    updatedAt: new Date(row.updated_at)
                })) || [];
                resolve(projects);
            }
        });
    });
}
/**
 * Get project by ID
 */
export async function getProjectById(id) {
    return new Promise((resolve, reject) => {
        database.getDb().get(`
            SELECT p.*, COUNT(t.id) as task_count 
            FROM projects p
            LEFT JOIN tasks t ON t.project_id = p.id
            WHERE p.id = ?
            GROUP BY p.id
        `, [id], (err, row) => {
            if (err) {
                if (err.message?.includes('no such table')) {
                    resolve(null);
                    return;
                }
                reject(err);
            }
            else if (!row) {
                resolve(null);
            }
            else {
                resolve({
                    id: row.id,
                    name: row.name,
                    description: row.description,
                    path: row.path,
                    techStack: row.tech_stack ? JSON.parse(row.tech_stack) : [],
                    taskCount: row.task_count || 0,
                    createdAt: new Date(row.created_at),
                    updatedAt: new Date(row.updated_at)
                });
            }
        });
    });
}
/**
 * Get project by workspace path
 */
export async function getProjectByPath(workspacePath) {
    const projectId = generateProjectId(workspacePath);
    return getProjectById(projectId);
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
        techStack: updates.techStack ?? existing.techStack,
        updatedAt: new Date()
    };
    return new Promise((resolve, reject) => {
        database.getDb().run(`
            UPDATE projects SET 
                name = ?, description = ?, tech_stack = ?, updated_at = ?
            WHERE id = ?
        `, [
            updated.name,
            updated.description || null,
            updated.techStack ? JSON.stringify(updated.techStack) : null,
            updated.updatedAt.getTime(),
            id
        ], function (err) {
            if (err) {
                reject(err);
            }
            else {
                resolve(updated);
            }
        });
    });
}
/**
 * Delete project
 */
export async function deleteProject(id) {
    return new Promise((resolve, reject) => {
        database.getDb().run(`DELETE FROM projects WHERE id = ?`, [id], (err) => {
            if (err)
                reject(err);
            else
                resolve();
        });
    });
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