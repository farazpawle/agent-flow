import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs/promises';
import { DATA_DIR } from './persistence.js';
// Enable verbose mode for debugging
const sqlite = sqlite3.verbose();
export class Database {
    db = null;
    initialized = false;
    dbPath;
    constructor(customDbPath) {
        this.dbPath = customDbPath || path.join(DATA_DIR, 'tasks.db');
    }
    async init() {
        if (this.initialized)
            return;
        // Ensure data directory exists (should be handled by persistence, but checking doesn't hurt)
        try {
            await fs.mkdir(DATA_DIR, { recursive: true });
        }
        catch (error) {
            // Ignore if exists
        }
        return new Promise((resolve, reject) => {
            this.db = new sqlite.Database(this.dbPath, (err) => {
                if (err) {
                    console.error('Failed to open database:', err);
                    reject(err);
                    return;
                }
                this.db.serialize(() => {
                    // Create tasks table
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS tasks (
                            id TEXT PRIMARY KEY,
                            name TEXT NOT NULL,
                            status TEXT NOT NULL,
                            created_at INTEGER NOT NULL,
                            updated_at INTEGER NOT NULL,
                            completed_at INTEGER,
                            client_id TEXT,
                            project_id TEXT,
                            content TEXT NOT NULL
                        )
                    `);
                    // Create clients table
                    this.db.run(`
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
                    this.db.run(`
                        CREATE TABLE IF NOT EXISTS projects (
                            id TEXT PRIMARY KEY,
                            name TEXT NOT NULL,
                            description TEXT,
                            path TEXT UNIQUE,
                            tech_stack TEXT,
                            created_at INTEGER NOT NULL,
                            updated_at INTEGER NOT NULL
                        )
                    `);
                    // Create indexes
                    this.db.run(`CREATE INDEX IF NOT EXISTS idx_status ON tasks(status)`);
                    this.db.run(`CREATE INDEX IF NOT EXISTS idx_created_at ON tasks(created_at)`);
                    // Run migrations in sequence with proper error handling
                    // Add client_id column if it doesn't exist (for old databases)
                    this.db.run(`ALTER TABLE tasks ADD COLUMN client_id TEXT`, (err) => {
                        // Ignore SQLITE_ERROR: duplicate column name - that's expected
                    });
                    // Add project_id column if it doesn't exist (for old databases)
                    this.db.run(`ALTER TABLE tasks ADD COLUMN project_id TEXT`, (err) => {
                        // Ignore SQLITE_ERROR: duplicate column name - that's expected
                    });
                    // Create indexes after migrations - these run in serialize() order
                    this.db.run(`CREATE INDEX IF NOT EXISTS idx_client_id ON tasks(client_id)`, (err) => {
                        // Ignore if exists
                    });
                    this.db.run(`CREATE INDEX IF NOT EXISTS idx_project_id ON tasks(project_id)`, (err) => {
                        // This is the last statement - when it completes, we're done
                        this.initialized = true;
                        resolve();
                    });
                });
            });
        });
    }
    getDb() {
        if (!this.db)
            throw new Error('Database not initialized');
        return this.db;
    }
    async close() {
        return new Promise((resolve, reject) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err)
                        reject(err);
                    else {
                        this.db = null;
                        this.initialized = false;
                        resolve();
                    }
                });
            }
            else {
                resolve();
            }
        });
    }
    async getAllTasks() {
        return new Promise((resolve, reject) => {
            this.getDb().all('SELECT content FROM tasks ORDER BY created_at ASC', (err, rows) => {
                if (err)
                    reject(err);
                else {
                    try {
                        const tasks = rows.map((row) => JSON.parse(row.content));
                        resolve(tasks);
                    }
                    catch (parseError) {
                        reject(parseError);
                    }
                }
            });
        });
    }
    async getTask(id) {
        return new Promise((resolve, reject) => {
            this.getDb().get('SELECT content FROM tasks WHERE id = ?', [id], (err, row) => {
                if (err)
                    reject(err);
                else if (!row)
                    resolve(null);
                else {
                    try {
                        resolve(JSON.parse(row.content));
                    }
                    catch (parseError) {
                        reject(parseError);
                    }
                }
            });
        });
    }
    async saveTask(task) {
        return new Promise((resolve, reject) => {
            const stmt = this.getDb().prepare(`
                INSERT OR REPLACE INTO tasks (
                    id, name, status, created_at, updated_at, completed_at, content
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            const createdAt = task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();
            const updatedAt = task.updatedAt instanceof Date ? task.updatedAt.getTime() : new Date(task.updatedAt).getTime();
            const completedAt = task.completedAt
                ? (task.completedAt instanceof Date ? task.completedAt.getTime() : new Date(task.completedAt).getTime())
                : null;
            stmt.run(task.id, task.name, task.status, createdAt, updatedAt, completedAt, JSON.stringify(task), (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
            stmt.finalize();
        });
    }
    async deleteTask(id) {
        return new Promise((resolve, reject) => {
            this.getDb().run('DELETE FROM tasks WHERE id = ?', [id], (err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    // For bulk operations (migration)
    async saveTasks(tasks) {
        return new Promise((resolve, reject) => {
            const db = this.getDb();
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                const stmt = db.prepare(`
                    INSERT OR REPLACE INTO tasks (
                        id, name, status, created_at, updated_at, completed_at, content
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                let errorOccurred = false;
                for (const task of tasks) {
                    const createdAt = task.createdAt instanceof Date ? task.createdAt.getTime() : new Date(task.createdAt).getTime();
                    const updatedAt = task.updatedAt instanceof Date ? task.updatedAt.getTime() : new Date(task.updatedAt).getTime();
                    const completedAt = task.completedAt
                        ? (task.completedAt instanceof Date ? task.completedAt.getTime() : new Date(task.completedAt).getTime())
                        : null;
                    stmt.run(task.id, task.name, task.status, createdAt, updatedAt, completedAt, JSON.stringify(task), (err) => {
                        if (err) {
                            errorOccurred = true;
                            console.error('Error saving task:', err);
                        }
                    });
                }
                stmt.finalize((err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        reject(err);
                    }
                    else if (errorOccurred) {
                        db.run('ROLLBACK');
                        reject(new Error('Error occurred during bulk save'));
                    }
                    else {
                        db.run('COMMIT', (err) => {
                            if (err)
                                reject(err);
                            else
                                resolve();
                        });
                    }
                });
            });
        });
    }
}
// Singleton instance
export const db = new Database();
//# sourceMappingURL=db.js.map