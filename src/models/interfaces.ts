import { Project } from "./projectModel.js";
import { Task } from "../types/index.js";
import { WorkflowStep } from "./workflowModel.js";
import { Client } from "./clientModel.js";

// ---------------------------------------------------------------------------
// Phase 1 entities (Group 1 — schema reshape).
// Kept here so the adapter contract and the row shapes live side-by-side.
// Dedicated model files can pick these up once the tool layer is built.
// ---------------------------------------------------------------------------

/**
 * Append-only artifact attached to a task. Drives findings, evidence,
 * commits, PRs, test/build logs and references for the new
 * `artifact_record` tool surface.
 */
export interface TaskFinding {
  id: string;
  /**
   * Denormalized project FK. Resolved from `taskId` at write time when
   * the caller does not supply it (see adapter `createFinding`).
   */
  projectId: string;
  taskId: string;
  kind: string; // e.g. "finding", "evidence", "commit", "pull_request", "test_log", "build_log", "reference"
  type?: string; // sub-classification within kind (e.g. "success", "failure", "decision")
  content: unknown; // arbitrary payload (stringified to JSON in SQLite, JSONB in Supabase)
  metadata?: Record<string, unknown>;
  createdAt: Date;
  /** Client id (or other caller identifier) that wrote the record. */
  createdBy?: string;
}

/** Input shape for createFinding — projectId is optional and resolved if absent. */
export interface TaskFindingInput {
  id?: string;
  projectId?: string;
  taskId: string;
  kind: string;
  type?: string;
  content: unknown;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  createdBy?: string;
}

export interface ListFindingsFilter {
  taskId?: string;
  projectId?: string;
  kind?: string;
  type?: string;
  sinceMs?: number;
  limit?: number;
}

/** Roll-up of one or more findings into a project-level "lesson". */
export interface LessonSummary {
  id: string;
  projectId: string;
  topic: string;
  summary: string;
  sourceFindingIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface LessonSummaryInput {
  id?: string;
  projectId: string;
  topic: string;
  summary: string;
  sourceFindingIds?: string[];
}

export interface ListLessonsFilter {
  projectId: string;
  topic?: string;
  limit?: number;
}

/** Per-client "active project" pointer used by `project_view(action=active)`. */
export interface ClientActiveProject {
  clientId: string;
  projectId: string;
  setAt: Date;
}

/**
 * Single-row settings record. Provider/model/strategy/workflow_mode are
 * the user-facing overrides for the LLM layer (Phase 2). Stored in DB so
 * the GUI Settings panel can mutate without a restart. API keys are never
 * persisted — they remain env-only.
 */
export interface LlmSettings {
  provider?: string;
  model?: string;
  selectionStrategy?: string;
  workflowMode?: string;
  updatedAt: Date;
}

export type LlmSettingsInput = Partial<Omit<LlmSettings, "updatedAt">>;

/** Result of an optimistic version bump on `tasks.version`. */
export type IncrementTaskVersionResult =
  | { ok: true; newVersion: number }
  | { ok: false; currentVersion: number | null };

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

  /**
   * Delete all workflow steps for a project
   * Returns number of deleted rows
   */
  deleteWorkflowStepsByProject(projectId: string): Promise<number>;

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

  // --- Task version (optimistic concurrency, Group 1.3 / Group 3) ---
  /**
   * Atomically bump `tasks.version` if and only if the current row
   * version matches `expectedVersion`. Used as the primitive for the
   * `withVersionCheck` helper added in Group 3.
   */
  incrementTaskVersion(
    taskId: string,
    expectedVersion: number
  ): Promise<IncrementTaskVersionResult>;

  /**
   * Run `fn` inside a database-level transaction (Group 3.2).
   *
   * - SQLite: opens `BEGIN IMMEDIATE`; on `fn` resolve → `COMMIT`,
   *   on throw → `ROLLBACK`. Provides true cross-row atomicity.
   * - Supabase: best-effort wrapper that just executes `fn`. The
   *   service-role REST API has no client-driven transaction handle;
   *   callers using Supabase get OCC-via-CAS, not strict atomicity.
   *
   * The semantics callers may rely on uniformly: either every write
   * inside `fn` is visible, or the helper throws and they should
   * treat the batch as failed.
   */
  runInTransaction<T>(fn: () => Promise<T>): Promise<T>;

  // --- Findings (append-only) ---
  /**
   * Insert a finding row. If `projectId` is not supplied the adapter
   * MUST resolve it from the parent task before writing — see Group 1.8.
   */
  createFinding(input: TaskFindingInput): Promise<TaskFinding>;

  /**
   * List findings filtered by task/project/kind/type. Ordered newest first.
   */
  listFindings(filter: ListFindingsFilter): Promise<TaskFinding[]>;

  /**
   * Delete findings older than `cutoffMs` (epoch ms). Returns rows removed.
   * Backs the `FINDINGS_RETENTION_DAYS` nightly job (Group 1.9).
   */
  deleteFindingsOlderThan(cutoffMs: number): Promise<number>;

  // --- Lesson summaries ---
  createLessonSummary(input: LessonSummaryInput): Promise<LessonSummary>;
  listLessonSummaries(filter: ListLessonsFilter): Promise<LessonSummary[]>;

  // --- Per-client active project pointer ---
  getActiveProjectForClient(clientId: string): Promise<ClientActiveProject | null>;
  setActiveProjectForClient(clientId: string, projectId: string): Promise<ClientActiveProject>;

  // --- LLM settings (single row) ---
  getLlmSettings(): Promise<LlmSettings | null>;
  setLlmSettings(input: LlmSettingsInput): Promise<LlmSettings>;

  // --- Destructive audit log (Group 6.3) ---
  /**
   * Append-only tamper-evident audit row written before every
   * `project_delete(execute)` / `task_delete(execute)` call. Lives in
   * its own table (`destructive_audits`) with NO foreign-key cascade,
   * so the record outlives the project/task it was about.
   */
  appendDestructiveAudit(row: DestructiveAuditRow): Promise<void>;

  /** Read recent audit rows, newest first. */
  listDestructiveAudits(filter?: DestructiveAuditFilter): Promise<DestructiveAuditRow[]>;
}

// --- Destructive audit row shape ---

export interface DestructiveAuditRow {
  id: string;
  tool: string; // e.g. "project_delete"
  projectId: string; // may be "(orphan)" for orphan tasks
  reason: string;
  affectedIds: string[];
  invokedBy: string; // "direct" or the wrapping tool (e.g. "workflow_run")
  metadata?: Record<string, unknown>;
  correlationId?: string;
  createdAt: Date;
}

export interface DestructiveAuditFilter {
  projectId?: string;
  tool?: string;
  limit?: number;
}
