import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { DatabaseAdapter } from './interfaces.js';
import { DATA_DIR } from './persistence.js';
import { Task } from '../types/index.js';
import { Project } from './projectModel.js';
import { Client } from './clientModel.js';
import { WorkflowStep, WorkflowStepType } from './workflowModel.js';

// Enable verbose mode for debugging
const sqlite = sqlite3.verbose();

export class SQLiteAdapter implements DatabaseAdapter {
    private db: sqlite3.Database | null = null;
    private initialized: boolean = false;
    private dbPath: string;

    constructor(customDbPath?: string) {
        this.dbPath = customDbPath || path.join(DATA_DIR, 'tasks.db');
    }

    async init(): Promise<void> {
        if (this.initialized) return;

        console.log(`(AgentFlow) Initializing SQLite database at: ${this.dbPath}`);

        // Ensure data directory exists
        try {
            await fs.mkdir(path.dirname(this.dbPath), { recursive: true });
        } catch (error) {
            // Ignore if exists
        }

        return new Promise((resolve, reject) => {
            this.db = new sqlite.Database(this.dbPath, async (err) => {
                if (err) {
                    console.error('(AgentFlow) Failed to open database:', err);
                    reject(err);
                    return;
                }

                // Enable foreign keys
                this.db!.run('PRAGMA foreign_keys = ON');

                this.db!.serialize(() => {
                    // Create tasks table
                    this.db!.run(`
                        CREATE TABLE IF NOT EXISTS tasks (
                            id TEXT PRIMARY KEY,
                            name TEXT NOT NULL,
                            status TEXT NOT NULL,
                            created_at INTEGER NOT NULL,
                            updated_at INTEGER NOT NULL,
                            completed_at INTEGER,
                            client_id TEXT,
                            project_id TEXT,

                            content TEXT NOT NULL,
                            execution_order INTEGER DEFAULT 0
                        )
                    `);

                    // Create clients table
                    this.db!.run(`
                        CREATE TABLE IF NOT EXISTS clients (
                            id TEXT PRIMARY KEY,
                            name TEXT NOT NULL,
                            type TEXT NOT NULL,
                            workspace TEXT,
                            connected_at INTEGER NOT NULL,
                            last_activity_at INTEGER NOT NULL,
                            is_active INTEGER DEFAULT 1
                        )
                    `);

                    // Create projects table
                    this.db!.run(`
                        CREATE TABLE IF NOT EXISTS projects (
                            id TEXT PRIMARY KEY,
                            name TEXT NOT NULL,
                            description TEXT,
                            path TEXT,
                            git_remote_url TEXT UNIQUE,
                            tech_stack TEXT,
                            created_at INTEGER NOT NULL,
                            updated_at INTEGER NOT NULL
                        )
                    `);

                    // Create workflow_steps table
                    this.db!.run(`
                        CREATE TABLE IF NOT EXISTS workflow_steps (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL,
                            task_id TEXT,
                            step_type TEXT NOT NULL,
                            content TEXT NOT NULL,
                            previous_step_id TEXT,
                            created_at INTEGER NOT NULL,
                            FOREIGN KEY(project_id) REFERENCES projects(id)
                        )
                    `);

                    // Create indexes
                    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_workflow_project ON workflow_steps(project_id)`);
                    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_workflow_task ON workflow_steps(task_id)`);
                    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_workflow_type ON workflow_steps(step_type)`);
                    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_status ON tasks(status)`);
                    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_created_at ON tasks(created_at)`);
                    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_client_id ON tasks(client_id)`);
                    this.db!.run(`CREATE INDEX IF NOT EXISTS idx_project_id ON tasks(project_id)`);

                    // Migrations
                    // Add project_id to tasks if missing
                    this.db!.run(`ALTER TABLE tasks ADD COLUMN project_id TEXT`, (err) => { /* Ignore duplicate column error */ });
                    this.db!.run(`ALTER TABLE tasks ADD COLUMN client_id TEXT`, (err) => { /* Ignore duplicate column error */ });
                    this.db!.run(`ALTER TABLE tasks ADD COLUMN execution_order INTEGER DEFAULT 0`, (err) => { /* Ignore duplicate column error */ });

                    // Migrations for projects table (handle legacy schema)
                    this.migrateProjectsTable().then(() => {
                        this.initialized = true;
                        console.log('(AgentFlow) SQLite Database initialized successfully');
                        resolve();
                    }).catch(reject);
                });
            });
        });
    }

    // Helper for table migration logic
    private async migrateProjectsTable(): Promise<void> {
        return new Promise((resolve) => {
            this.db!.all("PRAGMA table_info(projects)", (err, rows: any[]) => {
                if (err) {
                    console.error('(AgentFlow) Failed to check projects table info:', err);
                    resolve(); // Continue anyway?
                    return;
                }
                const hasGitUrl = rows && rows.some(r => r.name === 'git_remote_url');
                if (!hasGitUrl) {
                    console.error('(DB) Migrating projects table schema...');
                    this.db!.serialize(() => {
                        this.db!.run('BEGIN TRANSACTION');
                        this.db!.run('ALTER TABLE projects RENAME TO projects_old');
                        this.db!.run(`
                            CREATE TABLE projects (
                                id TEXT PRIMARY KEY,
                                name TEXT NOT NULL,
                                description TEXT,
                                path TEXT,
                                git_remote_url TEXT UNIQUE,
                                tech_stack TEXT,
                                created_at INTEGER NOT NULL,
                                updated_at INTEGER NOT NULL
                            )
                        `);
                        this.db!.run(`
                            INSERT INTO projects (id, name, description, path, tech_stack, created_at, updated_at)
                            SELECT id, name, description, path, tech_stack, created_at, updated_at
                            FROM projects_old
                        `);
                        this.db!.run('DROP TABLE projects_old');
                        this.db!.run('COMMIT', (err) => {
                            if (err) console.error('(DB) Migration failed:', err);
                            else console.error('(DB) Projects table migration completed.');
                            resolve();
                        });
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    async close(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) reject(err);
                    else {
                        this.db = null;
                        this.initialized = false;
                        resolve();
                    }
                });
            } else {
                resolve();
            }
        });
    }

    private getDb(): sqlite3.Database {
        if (!this.db) throw new Error('Database not initialized');
        return this.db;
    }

    // --- Task Operations ---

    async getAllTasks(projectId?: string): Promise<Task[]> {
        return new Promise((resolve, reject) => {
            let query = 'SELECT content, execution_order FROM tasks';
            const params: any[] = [];
            if (projectId) {
                query += ' WHERE project_id = ?';
                params.push(projectId);
            }
            query += ' ORDER BY execution_order ASC, created_at ASC';

            this.getDb().all(query, params, (err, rows) => {
                if (err) reject(err);
                else {
                    try {
                        const tasks = rows.map((row: any) => {
                            const t = JSON.parse(row.content);
                            return {
                                ...t,
                                executionOrder: row.execution_order, // Ensure column value takes precedence
                                createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
                                updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
                                completedAt: t.completedAt ? new Date(t.completedAt) : undefined
                            };
                        });
                        resolve(tasks);
                    } catch (parseError) {
                        reject(parseError);
                    }
                }
            });
        });
    }

    async getTask(id: string): Promise<Task | null> {
        return new Promise((resolve, reject) => {
            this.getDb().get('SELECT content, execution_order FROM tasks WHERE id = ?', [id], (err, row: any) => {
                if (err) reject(err);
                else if (!row) resolve(null);
                else {
                    try {
                        const t = JSON.parse(row.content);
                        const task = {
                            ...t,
                            executionOrder: row.execution_order, // Ensure column value takes precedence
                            createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
                            updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
                            completedAt: t.completedAt ? new Date(t.completedAt) : undefined
                        };
                        resolve(task);
                    } catch (parseError) {
                        reject(parseError);
                    }
                }
            });
        });
    }

    async saveTask(task: Task): Promise<void> {
        return new Promise((resolve, reject) => {
            const stmt = this.getDb().prepare(`
                INSERT OR REPLACE INTO tasks (
                    id, name, status, created_at, updated_at, completed_at, client_id, project_id, content, execution_order
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const createdAt = task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();
            const updatedAt = task.updatedAt instanceof Date ? task.updatedAt.getTime() : new Date(task.updatedAt).getTime();
            const completedAt = task.completedAt
                ? (task.completedAt instanceof Date ? task.completedAt.getTime() : new Date(task.completedAt).getTime())
                : null;

            stmt.run(
                task.id,
                task.name,
                task.status,
                createdAt,
                updatedAt,
                completedAt,
                (task as any).clientId ?? null,
                task.projectId ?? null,
                JSON.stringify(task),
                (task.executionOrder || 0),
                (err: Error | null) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
            stmt.finalize();
        });
    }

    async deleteTask(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.getDb().run('DELETE FROM tasks WHERE id = ?', [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    }

    async saveTasks(tasks: Task[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const db = this.getDb();
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO tasks (
                        id, name, status, created_at, updated_at, completed_at, client_id, project_id, content, execution_order
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

                let errorOccurred = false;
                for (const task of tasks) {
                    const createdAt = task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();
                    const updatedAt = task.updatedAt instanceof Date ? task.updatedAt.getTime() : new Date(task.updatedAt).getTime();
                    const completedAt = task.completedAt
                        ? (task.completedAt instanceof Date ? task.completedAt.getTime() : new Date(task.completedAt).getTime())
                        : null;
                    stmt.run(
                        task.id, task.name, task.status, createdAt, updatedAt, completedAt,
                        (task as any).clientId ?? null, task.projectId ?? null, JSON.stringify(task), (task.executionOrder || 0),
                        (err: Error | null) => { if (err) { errorOccurred = true; console.error('(AgentFlow) Error saving task:', err); } }
                    );
                }
                stmt.finalize((err) => {
                    if (err || errorOccurred) {
                        db.run('ROLLBACK');
                        reject(err || new Error('Bulk save failed'));
                    } else {
                        db.run('COMMIT', (err) => {
                            if (err) reject(err); else resolve();
                        });
                    }
                });
            });
        });
    }

    // --- Project Operations ---

    async createProject(project: Project): Promise<void> {
        return new Promise((resolve, reject) => {
            this.getDb().run(`
                INSERT OR REPLACE INTO projects (
                    id, name, description, path, git_remote_url, tech_stack, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                project.id,
                project.name,
                project.description || null,
                project.path || null,
                project.gitRemoteUrl || null,
                project.techStack ? JSON.stringify(project.techStack) : null,
                project.createdAt.getTime(),
                project.updatedAt.getTime()
            ], function (err) {
                if (err) {
                    console.error("[AgentFlow] Failed to create project:", err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    async getProject(id: string): Promise<Project | null> {
        return new Promise((resolve, reject) => {
            this.getDb().get(`
                SELECT p.*, COUNT(t.id) as task_count 
                FROM projects p
                LEFT JOIN tasks t ON t.project_id = p.id
                WHERE p.id = ?
                GROUP BY p.id
            `, [id], (err, row: any) => {
                if (err) reject(err);
                else if (!row) resolve(null);
                else resolve(this.mapProjectRow(row));
            });
        });
    }

    async getAllProjects(): Promise<Project[]> {
        return new Promise((resolve, reject) => {
            this.getDb().all(`
                SELECT p.*, COUNT(t.id) as task_count 
                FROM projects p
                LEFT JOIN tasks t ON t.project_id = p.id
                GROUP BY p.id
                ORDER BY p.updated_at DESC
            `, (err, rows: any[]) => {
                if (err) {
                    if (err.message?.includes('no such table')) resolve([]);
                    else reject(err);
                } else {
                    const projects = rows?.map(row => this.mapProjectRow(row)) || [];
                    resolve(projects);
                }
            });
        });
    }

    async deleteProject(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.getDb().run(`DELETE FROM projects WHERE id = ?`, [id], (err) => {
                if (err) reject(err); else resolve();
            });
        });
    }

    private mapProjectRow(row: any): Project {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            path: row.path,
            gitRemoteUrl: row.git_remote_url,
            techStack: row.tech_stack ? JSON.parse(row.tech_stack) : [],
            taskCount: row.task_count || 0,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }

    // --- Workflow Step Operations ---

    async createWorkflowStep(step: WorkflowStep): Promise<void> {
        return new Promise((resolve, reject) => {
            const stmt = this.getDb().prepare(`
                INSERT INTO workflow_steps (
                    id, project_id, task_id, step_type, content, previous_step_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
                step.id, step.projectId, step.taskId || null, step.stepType,
                step.content, step.previousStepId || null, step.createdAt.getTime(),
                (err: Error | null) => {
                    if (err) reject(err); else resolve();
                }
            );
            stmt.finalize();
        });
    }

    async getWorkflowStep(id: string): Promise<WorkflowStep | null> {
        return new Promise((resolve, reject) => {
            this.getDb().get("SELECT * FROM workflow_steps WHERE id = ?", [id], (err, row: any) => {
                if (err) reject(err);
                else if (!row) resolve(null);
                else {
                    resolve({
                        id: row.id,
                        projectId: row.project_id,
                        taskId: row.task_id,
                        stepType: row.step_type as WorkflowStepType,
                        content: row.content,
                        previousStepId: row.previous_step_id,
                        createdAt: new Date(row.created_at)
                    });
                }
            });
        });
    }

    async getWorkflowSteps(projectId: string): Promise<WorkflowStep[]> {
        return new Promise((resolve, reject) => {
            this.getDb().all(
                "SELECT * FROM workflow_steps WHERE project_id = ? ORDER BY created_at ASC",
                [projectId],
                (err, rows: any[]) => {
                    if (err) reject(err);
                    else {
                        const steps = rows.map((row: any) => ({
                            id: row.id,
                            projectId: row.project_id,
                            taskId: row.task_id,
                            stepType: row.step_type as WorkflowStepType,
                            content: row.content,
                            previousStepId: row.previous_step_id,
                            createdAt: new Date(row.created_at)
                        }));
                        resolve(steps);
                    }
                }
            );
        });
    }

    // --- Client Operations ---

    async registerClient(client: Client): Promise<void> {
        return new Promise((resolve, reject) => {
            this.getDb().run(`
                INSERT OR REPLACE INTO clients (
                    id, name, type, workspace, connected_at, last_activity_at, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [
                client.id, client.name, client.type, client.workspace,
                client.connectedAt.getTime(), client.lastActivityAt.getTime(),
                client.isActive ? 1 : 0
            ], (err) => {
                if (err) reject(err); else resolve();
            });
        });
    }

    async getAllClients(activeOnly: boolean = true): Promise<Client[]> {
        return new Promise((resolve, reject) => {
            const whereClause = activeOnly ? 'WHERE is_active = 1' : '';
            this.getDb().all(`
                SELECT * FROM clients ${whereClause} ORDER BY last_activity_at DESC
            `, (err, rows: any[]) => {
                if (err) {
                    if (err.message?.includes('no such table')) resolve([]);
                    else reject(err);
                } else {
                    const clients = rows?.map(row => ({
                        id: row.id,
                        name: row.name,
                        type: row.type as Client["type"],
                        workspace: row.workspace,
                        connectedAt: new Date(row.connected_at),
                        lastActivityAt: new Date(row.last_activity_at),
                        isActive: row.is_active === 1
                    })) || [];
                    resolve(clients);
                }
            });
        });
    }

    async getClient(id: string): Promise<Client | null> {
        return new Promise((resolve, reject) => {
            this.getDb().get(`SELECT * FROM clients WHERE id = ?`, [id], (err, row: any) => {
                if (err) reject(err);
                else if (!row) resolve(null);
                else {
                    resolve({
                        id: row.id, name: row.name, type: row.type as Client["type"], workspace: row.workspace,
                        connectedAt: new Date(row.connected_at), lastActivityAt: new Date(row.last_activity_at),
                        isActive: row.is_active === 1
                    });
                }
            });
        });
    }

    async updateClientHeartbeat(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.getDb().run(`UPDATE clients SET last_activity_at = ?, is_active = 1 WHERE id = ?`, [Date.now(), id], (err) => {
                if (err) reject(err); else resolve();
            });
        });
    }

    async cleanupStaleClients(timeoutMs: number): Promise<number> {
        const cutoff = Date.now() - timeoutMs;
        return new Promise((resolve, reject) => {
            this.getDb().run(`UPDATE clients SET is_active = 0 WHERE is_active = 1 AND last_activity_at < ?`, [cutoff], function (err) {
                if (err) reject(err); else resolve(this.changes || 0);
            });
        });
    }

    async markAllClientsInactive(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.getDb().run(`UPDATE clients SET is_active = 0`, (err) => {
                if (err) reject(err); else resolve();
            });
        });
    }
    async deleteClient(id: string): Promise<void> {
        return new Promise((resolve, reject) => {
            this.getDb().run(`DELETE FROM clients WHERE id = ?`, [id], (err) => {
                if (err) reject(err); else resolve();
            });
        });
    }

    async deleteInactiveClients(): Promise<number> {
        return new Promise((resolve, reject) => {
            this.getDb().run(`DELETE FROM clients WHERE is_active = 0`, function (err) {
                if (err) reject(err); else resolve(this.changes || 0);
            });
        });
    }
}
