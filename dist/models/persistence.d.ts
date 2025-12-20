/**
 * Task Persistence Layer
 * Handles write batching, archiving, and search indexing
 */
import { Task } from "../types/index.js";
declare const DATA_DIR: string;
declare const TASKS_FILE: string;
declare const ARCHIVE_DIR: string;
declare const MEMORY_DIR: string;
declare const ARCHIVE_AFTER_DAYS: number;
/**
 * Search Index using MiniSearch
 * Provides fuzzy full-text search without shell commands
 */
declare class SearchIndex {
    private index;
    private initialized;
    constructor();
    /**
     * Initialize or rebuild the search index from tasks
     */
    rebuild(tasks: Task[]): void;
    /**
     * Add a single task to the index
     */
    add(task: Task): void;
    /**
     * Remove a task from the index
     */
    remove(taskId: string): void;
    /**
     * Search tasks by query string
     * Returns task IDs matching the query
     */
    search(query: string): string[];
    /**
     * Check if index is initialized
     */
    isReady(): boolean;
}
/**
 * Write Batcher
 * Debounces file writes to prevent excessive I/O
 */
declare class WriteBatcher {
    private pendingData;
    private timer;
    private writing;
    private filePath;
    constructor(filePath: string);
    /**
     * Schedule a write operation (debounced)
     */
    schedule(tasks: Task[]): void;
    /**
     * Force immediate flush of pending writes
     */
    flush(): Promise<void>;
    /**
     * Check if there are pending writes
     */
    hasPending(): boolean;
}
/**
 * Get or create the search index singleton
 */
export declare function getSearchIndex(): SearchIndex;
/**
 * Get or create the write batcher singleton
 */
export declare function getWriteBatcher(): WriteBatcher;
/**
 * Ensure all required directories exist
 */
export declare function ensureDirectories(): Promise<void>;
/**
 * Archive old completed tasks
 * Moves tasks completed more than ARCHIVE_AFTER_DAYS ago to archive files
 */
export declare function archiveOldTasks(tasks: Task[]): Promise<{
    archivedCount: number;
    remainingTasks: Task[];
}>;
/**
 * Read archived tasks from a specific month
 */
export declare function readArchivedTasks(monthKey: string): Promise<Task[]>;
/**
 * List available archive files
 */
export declare function listArchiveFiles(): Promise<string[]>;
/**
 * Search across all archives (for query_task with include_archived)
 */
export declare function searchArchives(query: string): Promise<Task[]>;
export { DATA_DIR, TASKS_FILE, ARCHIVE_DIR, MEMORY_DIR, ARCHIVE_AFTER_DAYS };
