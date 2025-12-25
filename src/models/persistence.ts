/**
 * Task Persistence Layer
 * Handles write batching, archiving, and search indexing
 */

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

// CRITICAL: Load .env BEFORE accessing process.env
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");
dotenv.config({ path: path.join(PROJECT_ROOT, ".env") });

import fs from "fs/promises";
import fsSync from "fs";
import MiniSearch from "minisearch";
import { Task, TaskStatus } from "../types/index.js";

// Directory paths - NOW process.env.DATA_DIR is correctly loaded
const DATA_DIR = process.env.DATA_DIR || path.join(PROJECT_ROOT, "data");
const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
const ARCHIVE_DIR = path.join(DATA_DIR, "archive");
const MEMORY_DIR = path.join(DATA_DIR, "memory");

// Configuration
const ARCHIVE_AFTER_DAYS = parseInt(process.env.ARCHIVE_AFTER_DAYS || "30", 10);
const WRITE_DEBOUNCE_MS = 100;

/**
 * Search Index using MiniSearch
 * Provides fuzzy full-text search without shell commands
 */
class SearchIndex {
    private index: MiniSearch<Task>;
    private initialized = false;

    constructor() {
        this.index = new MiniSearch({
            fields: ["name", "description", "notes", "implementationGuide", "summary", "problemStatement", "technicalPlan", "finalOutcome", "lessonsLearned"],
            storeFields: ["id", "name", "status"],
            searchOptions: {
                fuzzy: 0.2,
                prefix: true,
                boost: { name: 2, description: 1.5, problemStatement: 1.2, technicalPlan: 1.2, finalOutcome: 1.2, lessonsLearned: 1.5 }
            }
        });
    }

    /**
     * Initialize or rebuild the search index from tasks
     */
    rebuild(tasks: Task[]): void {
        this.index.removeAll();
        // Convert Task objects to indexable format
        const indexableTasks = tasks.map(task => ({
            ...task,
            id: task.id,
            name: task.name,
            description: task.description,
            notes: task.notes || "",
            implementationGuide: task.implementationGuide || "",
            summary: task.summary || "",
            problemStatement: task.problemStatement || "",
            technicalPlan: task.technicalPlan || "",
            finalOutcome: task.finalOutcome || "",
            lessonsLearned: task.lessonsLearned || ""
        }));
        this.index.addAll(indexableTasks);
        this.initialized = true;
    }

    /**
     * Add a single task to the index
     */
    add(task: Task): void {
        // Remove if exists, then add
        try {
            this.index.discard(task.id);
        } catch {
            // Task wasn't in index, that's fine
        }
        this.index.add({
            ...task,
            id: task.id,
            name: task.name,
            description: task.description,
            notes: task.notes || "",
            implementationGuide: task.implementationGuide || "",
            summary: task.summary || "",
            problemStatement: task.problemStatement || "",
            technicalPlan: task.technicalPlan || "",
            finalOutcome: task.finalOutcome || "",
            lessonsLearned: task.lessonsLearned || ""
        });
    }

    /**
     * Remove a task from the index
     */
    remove(taskId: string): void {
        try {
            this.index.discard(taskId);
        } catch {
            // Task wasn't in index
        }
    }

    /**
     * Search tasks by query string
     * Returns task IDs matching the query
     */
    search(query: string): string[] {
        if (!query.trim()) return [];

        const results = this.index.search(query);
        return results.map(r => r.id);
    }

    /**
     * Check if index is initialized
     */
    isReady(): boolean {
        return this.initialized;
    }
}

/**
 * Write Batcher
 * Debounces file writes to prevent excessive I/O
 */
class WriteBatcher {
    private pendingData: { tasks: Task[] } | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private writing = false;
    private filePath: string;

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    /**
     * Schedule a write operation (debounced)
     */
    schedule(tasks: Task[]): void {
        this.pendingData = { tasks };

        if (!this.timer && !this.writing) {
            this.timer = setTimeout(() => this.flush(), WRITE_DEBOUNCE_MS);
        }
    }

    /**
     * Force immediate flush of pending writes
     */
    async flush(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        if (this.pendingData && !this.writing) {
            this.writing = true;
            try {
                await fs.writeFile(
                    this.filePath,
                    JSON.stringify(this.pendingData, null, 2),
                    "utf-8"
                );
            } finally {
                this.writing = false;
                this.pendingData = null;
            }
        }
    }

    /**
     * Check if there are pending writes
     */
    hasPending(): boolean {
        return this.pendingData !== null;
    }
}

// Singleton instances
let searchIndex: SearchIndex | null = null;
let writeBatcher: WriteBatcher | null = null;

/**
 * Get or create the search index singleton
 */
export function getSearchIndex(): SearchIndex {
    if (!searchIndex) {
        searchIndex = new SearchIndex();
    }
    return searchIndex;
}

/**
 * Get or create the write batcher singleton
 */
export function getWriteBatcher(): WriteBatcher {
    if (!writeBatcher) {
        writeBatcher = new WriteBatcher(TASKS_FILE);
    }
    return writeBatcher;
}

/**
 * Ensure all required directories exist
 */
export async function ensureDirectories(): Promise<void> {
    const dirs = [DATA_DIR, ARCHIVE_DIR, MEMORY_DIR];

    for (const dir of dirs) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
        }
    }

    // Ensure tasks file exists
    try {
        await fs.access(TASKS_FILE);
    } catch {
        await fs.writeFile(TASKS_FILE, JSON.stringify({ tasks: [] }));
    }
}

/**
 * Archive old completed tasks
 * Moves tasks completed more than ARCHIVE_AFTER_DAYS ago to archive files
 */
export async function archiveOldTasks(tasks: Task[]): Promise<{
    archivedCount: number;
    remainingTasks: Task[];
}> {
    const now = new Date();
    const cutoffDate = new Date(now.getTime() - ARCHIVE_AFTER_DAYS * 24 * 60 * 60 * 1000);

    const toArchive: Task[] = [];
    const remaining: Task[] = [];

    for (const task of tasks) {
        if (
            task.status === TaskStatus.COMPLETED &&
            task.completedAt &&
            new Date(task.completedAt) < cutoffDate
        ) {
            toArchive.push(task);
        } else {
            remaining.push(task);
        }
    }

    if (toArchive.length > 0) {
        // Group by month
        const byMonth = new Map<string, Task[]>();

        for (const task of toArchive) {
            const date = task.completedAt ? new Date(task.completedAt) : new Date();
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

            if (!byMonth.has(monthKey)) {
                byMonth.set(monthKey, []);
            }
            byMonth.get(monthKey)!.push(task);
        }

        // Write to archive files
        for (const [monthKey, monthTasks] of byMonth) {
            const archiveFile = path.join(ARCHIVE_DIR, `${monthKey}.json`);

            let existingTasks: Task[] = [];
            try {
                const data = await fs.readFile(archiveFile, "utf-8");
                existingTasks = JSON.parse(data).tasks || [];
            } catch {
                // File doesn't exist, that's fine
            }

            // Merge and deduplicate
            const taskMap = new Map<string, Task>();
            for (const t of existingTasks) taskMap.set(t.id, t);
            for (const t of monthTasks) taskMap.set(t.id, t);

            await fs.writeFile(
                archiveFile,
                JSON.stringify({ tasks: Array.from(taskMap.values()) }, null, 2),
                "utf-8"
            );
        }
    }

    return {
        archivedCount: toArchive.length,
        remainingTasks: remaining
    };
}

/**
 * Read archived tasks from a specific month
 */
export async function readArchivedTasks(monthKey: string): Promise<Task[]> {
    const archiveFile = path.join(ARCHIVE_DIR, `${monthKey}.json`);

    try {
        const data = await fs.readFile(archiveFile, "utf-8");
        const tasks = JSON.parse(data).tasks || [];
        return tasks.map((task: any) => ({
            ...task,
            createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
            updatedAt: task.updatedAt ? new Date(task.updatedAt) : new Date(),
            completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
        }));
    } catch {
        return [];
    }
}

/**
 * List available archive files
 */
export async function listArchiveFiles(): Promise<string[]> {
    try {
        const files = await fs.readdir(ARCHIVE_DIR);
        return files
            .filter(f => f.endsWith(".json"))
            .map(f => f.replace(".json", ""))
            .sort()
            .reverse(); // Most recent first
    } catch {
        return [];
    }
}

/**
 * Search across all archives (for query_task with include_archived)
 */
export async function searchArchives(query: string): Promise<Task[]> {
    const archiveFiles = await listArchiveFiles();
    const results: Task[] = [];
    const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 0);

    for (const monthKey of archiveFiles.slice(0, 12)) { // Limit to last 12 months
        const tasks = await readArchivedTasks(monthKey);

        for (const task of tasks) {
            const matches = keywords.every(keyword => {
                const searchText = [
                    task.name,
                    task.description,
                    task.notes || "",
                    task.summary || ""
                ].join(" ").toLowerCase();
                return searchText.includes(keyword);
            });

            if (matches) {
                results.push(task);
            }
        }
    }

    return results;
}

// Export directory constants
export { DATA_DIR, TASKS_FILE, ARCHIVE_DIR, MEMORY_DIR, ARCHIVE_AFTER_DAYS };
