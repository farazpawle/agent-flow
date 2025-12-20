import sqlite3 from 'sqlite3';
import { Task } from '../types/index.js';
export declare class Database {
    private db;
    private initialized;
    private dbPath;
    constructor(customDbPath?: string);
    init(): Promise<void>;
    getDb(): sqlite3.Database;
    close(): Promise<void>;
    getAllTasks(): Promise<Task[]>;
    getTask(id: string): Promise<Task | null>;
    saveTask(task: Task): Promise<void>;
    deleteTask(id: string): Promise<void>;
    saveTasks(tasks: Task[]): Promise<void>;
}
export declare const db: Database;
