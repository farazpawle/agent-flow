import { Project } from "./projectModel.js";
import { Task } from "../types/index.js";
import { WorkflowStep } from "./workflowModel.js";
import { Client } from "./clientModel.js";

/**
 * Interface for database adapters
 * Abstracts specific database implementations (SQLite, Supabase, etc.)
 */
export interface DatabaseAdapter {
    /**
     * Initialize the database connection and schema
     */
    init(): Promise<void>;

    /**
     * Close the database connection
     */
    close(): Promise<void>;

    // --- Task Operations ---
    /**
     * Get all tasks, optionally filtered by project ID
     */
    getAllTasks(projectId?: string): Promise<Task[]>;

    /**
     * Get task by ID
     */
    getTask(id: string): Promise<Task | null>;

    /**
     * Save a task (create or update)
     */
    saveTask(task: Task): Promise<void>;

    /**
     * Delete a task
     */
    deleteTask(id: string): Promise<void>;

    /**
     * Batch save tasks
     */
    saveTasks(tasks: Task[]): Promise<void>;

    // --- Project Operations ---
    /**
     * Create or update a project
     */
    createProject(project: Project): Promise<void>;

    /**
     * Get project by ID
     */
    getProject(id: string): Promise<Project | null>;

    /**
     * Get all projects
     */
    getAllProjects(): Promise<Project[]>;

    /**
     * Delete project
     */
    deleteProject(id: string): Promise<void>;

    // --- Workflow Step Operations ---
    /**
     * Save a workflow step
     */
    createWorkflowStep(step: WorkflowStep): Promise<void>;

    /**
     * Get workflow step by ID
     */
    getWorkflowStep(id: string): Promise<WorkflowStep | null>;

    /**
     * Get workflow steps for a project
     */
    getWorkflowSteps(projectId: string): Promise<WorkflowStep[]>;

    // --- Client Operations ---
    /**
     * Register or update a client
     */
    registerClient(client: Client): Promise<void>;

    /**
     * Get all clients
     */
    getAllClients(activeOnly?: boolean): Promise<Client[]>;

    /**
     * Get client by ID
     */
    getClient(id: string): Promise<Client | null>;

    /**
     * Delete a client
     */
    deleteClient(id: string): Promise<void>;

    /**
     * Update client activity/heartbeat
     */
    updateClientHeartbeat(id: string): Promise<void>;

    /**
     * Mark client as inactive based on timeout
     * Returns count of affected rows
     */
    cleanupStaleClients(timeoutMs: number): Promise<number>;

    /**
     * Mark all clients as inactive (e.g. on server start)
     */
    markAllClientsInactive(): Promise<void>;

    /**
     * Delete all inactive clients
     */
    deleteInactiveClients(): Promise<number>;
}
