import sqlite3 from "sqlite3";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import {
  ClaimTaskResult,
  ClientActiveProject,
  DatabaseAdapter,
  DestructiveAuditFilter,
  DestructiveAuditRow,
  ExtendClaimResult,
  IncrementTaskVersionResult,
  LessonSummary,
  LessonSummaryInput,
  ListFindingsFilter,
  ListLessonsFilter,
  LlmSettings,
  LlmSettingsInput,
  ProjectSkill,
  ProjectSkillInput,
  ProjectSkillReference,
  ProjectSkillReferenceInput,
  TaskFinding,
  TaskFindingInput,
} from "./interfaces.js";
import { DATA_DIR } from "./persistence.js";
import { Task, TaskGroup, TaskGroupInput } from "../types/index.js";
import { Project } from "./projectModel.js";
import { Client } from "./clientModel.js";
import { WorkflowStep, WorkflowStepType } from "./workflowModel.js";

// Enable verbose mode for debugging
const sqlite = sqlite3.verbose();

export class SQLiteAdapter implements DatabaseAdapter {
  private db: sqlite3.Database | null = null;
  private initialized: boolean = false;
  private dbPath: string;

  constructor(customDbPath?: string) {
    this.dbPath = customDbPath || path.join(DATA_DIR, "tasks.db");
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
          console.error("(AgentFlow) Failed to open database:", err);
          reject(err);
          return;
        }

        // Enable foreign keys
        this.db!.run("PRAGMA foreign_keys = ON");

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
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_workflow_project ON workflow_steps(project_id)`
          );
          this.db!.run(`CREATE INDEX IF NOT EXISTS idx_workflow_task ON workflow_steps(task_id)`);
          this.db!.run(`CREATE INDEX IF NOT EXISTS idx_workflow_type ON workflow_steps(step_type)`);
          this.db!.run(`CREATE INDEX IF NOT EXISTS idx_status ON tasks(status)`);
          this.db!.run(`CREATE INDEX IF NOT EXISTS idx_created_at ON tasks(created_at)`);
          this.db!.run(`CREATE INDEX IF NOT EXISTS idx_client_id ON tasks(client_id)`);
          this.db!.run(`CREATE INDEX IF NOT EXISTS idx_project_id ON tasks(project_id)`);

          // Migrations
          // Add project_id to tasks if missing
          this.db!.run(`ALTER TABLE tasks ADD COLUMN project_id TEXT`, (err) => {
            /* Ignore duplicate column error */
          });
          this.db!.run(`ALTER TABLE tasks ADD COLUMN client_id TEXT`, (err) => {
            /* Ignore duplicate column error */
          });
          this.db!.run(`ALTER TABLE tasks ADD COLUMN execution_order INTEGER DEFAULT 0`, (err) => {
            /* Ignore duplicate column error */
          });

          // Soft-delete columns (Tier 1.4 — production hardening)
          this.db!.run(`ALTER TABLE tasks ADD COLUMN deleted_at INTEGER`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE projects ADD COLUMN deleted_at INTEGER`, () => {
            /* idempotent */
          });

          // Workflow telemetry columns (Tier 2.2)
          this.db!.run(`ALTER TABLE workflow_steps ADD COLUMN tool_name TEXT`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE workflow_steps ADD COLUMN duration_ms INTEGER`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE workflow_steps ADD COLUMN input_tokens INTEGER`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE workflow_steps ADD COLUMN output_tokens INTEGER`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE workflow_steps ADD COLUMN outcome TEXT`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE workflow_steps ADD COLUMN error_code TEXT`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE workflow_steps ADD COLUMN correlation_id TEXT`, () => {
            /* idempotent */
          });

          // Phase 1 Group 1.3 — optimistic concurrency column on tasks.
          // SQLite's ALTER TABLE accepts NOT NULL with a constant DEFAULT,
          // which backfills existing rows in a single statement.
          this.db!.run(`ALTER TABLE tasks ADD COLUMN version INTEGER NOT NULL DEFAULT 1`, () => {
            /* idempotent */
          });

          // Wave 1 §10.C — multi-agent lock columns.
          // Nullable on purpose: existing rows are simply unclaimed.
          this.db!.run(`ALTER TABLE tasks ADD COLUMN claimed_by TEXT`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE tasks ADD COLUMN claimed_at INTEGER`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE tasks ADD COLUMN claim_expires_at INTEGER`, () => {
            /* idempotent */
          });
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_tasks_claim ON tasks(claimed_by, claim_expires_at)`
          );

          // Wave 1 §10.D — task groups + parent/child hierarchy.
          this.db!.run(`
                        CREATE TABLE IF NOT EXISTS task_groups (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL,
                            name TEXT NOT NULL,
                            description TEXT,
                            status TEXT NOT NULL DEFAULT 'active',
                            created_at INTEGER NOT NULL,
                            updated_at INTEGER NOT NULL,
                            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                        )
                    `);
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_task_groups_project ON task_groups(project_id)`
          );
          // Feature-hierarchy — self-referential parent + ordinal so a Feature
          // (parent_group_id IS NULL) can hold child section Groups, and group
          // ordinals are deterministic. SQLite cannot add a REFERENCES constraint
          // via ALTER TABLE, so the Feature→Group ON DELETE CASCADE is emulated
          // in `deleteGroup` (it removes child groups + nulls their tasks).
          this.db!.run(`ALTER TABLE task_groups ADD COLUMN parent_group_id TEXT`, () => {
            /* idempotent */
          });
          this.db!.run(
            `ALTER TABLE task_groups ADD COLUMN execution_order INTEGER DEFAULT 0`,
            () => {
              /* idempotent */
            }
          );
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_task_groups_parent ON task_groups(parent_group_id)`
          );
          // The FK is added via a NULLable column without REFERENCES because
          // SQLite cannot retroactively add a REFERENCES constraint via
          // ALTER TABLE. ON DELETE SET NULL semantics are emulated in the
          // model layer (`deleteGroup` first nulls dependent tasks).
          this.db!.run(`ALTER TABLE tasks ADD COLUMN group_id TEXT`, () => {
            /* idempotent */
          });
          this.db!.run(`ALTER TABLE tasks ADD COLUMN parent_task_id TEXT`, () => {
            /* idempotent */
          });
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_tasks_project_group ON tasks(project_id, group_id)`
          );
          this.db!.run(`CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id)`);

          // Phase 1 Group 1.1 — append-only findings/artifacts.
          this.db!.run(`
                        CREATE TABLE IF NOT EXISTS task_findings (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL,
                            task_id TEXT NOT NULL,
                            kind TEXT NOT NULL,
                            type TEXT,
                            content TEXT NOT NULL,
                            metadata TEXT,
                            created_at INTEGER NOT NULL,
                            created_by TEXT,
                            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                            FOREIGN KEY(task_id) REFERENCES tasks(id) ON DELETE CASCADE
                        )
                    `);
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_findings_task_created ON task_findings(task_id, created_at DESC)`
          );
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_findings_project_created ON task_findings(project_id, created_at DESC)`
          );
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_findings_task_kind ON task_findings(task_id, kind)`
          );
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_findings_project_kind_type ON task_findings(project_id, kind, type)`
          );

          // Phase 1 Group 1.2 — lesson summaries.
          this.db!.run(`
                        CREATE TABLE IF NOT EXISTS lesson_summaries (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL,
                            topic TEXT NOT NULL,
                            summary TEXT NOT NULL,
                            source_finding_ids TEXT,
                            created_at INTEGER NOT NULL,
                            updated_at INTEGER NOT NULL,
                            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                        )
                    `);
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_lesson_summaries_project_topic ON lesson_summaries(project_id, topic)`
          );

          // Phase 1 Group 1.4 — per-client active project pointer.
          this.db!.run(`
                        CREATE TABLE IF NOT EXISTS client_active_project (
                            client_id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL,
                            set_at INTEGER NOT NULL,
                            FOREIGN KEY(client_id) REFERENCES clients(id) ON DELETE CASCADE,
                            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                        )
                    `);

          // Phase 1 Group 1.5 — single-row LLM settings overlay.
          this.db!.run(`
                        CREATE TABLE IF NOT EXISTS llm_settings (
                            id INTEGER PRIMARY KEY CHECK (id = 1),
                            provider TEXT,
                            model TEXT,
                            selection_strategy TEXT,
                            workflow_mode TEXT,
                            updated_at INTEGER NOT NULL
                        )
                    `);

          // Phase 1 Group 6.3 — destructive audit log. NOT
          // foreign-keyed: rows must outlive the projects/tasks
          // they describe so tampering is detectable even after
          // a successful delete cascade.
          this.db!.run(`
                        CREATE TABLE IF NOT EXISTS destructive_audits (
                            id TEXT PRIMARY KEY,
                            tool TEXT NOT NULL,
                            project_id TEXT NOT NULL,
                            reason TEXT NOT NULL,
                            affected_ids TEXT NOT NULL,
                            invoked_by TEXT NOT NULL,
                            metadata TEXT,
                            correlation_id TEXT,
                            created_at INTEGER NOT NULL
                        )
                    `);
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_destructive_audits_project_created ON destructive_audits(project_id, created_at DESC)`
          );
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_destructive_audits_tool ON destructive_audits(tool, created_at DESC)`
          );

          // Wave 3 §10.E — Project Skill (one row per project) + overflow
          // references (per-topic blocks pulled out of `body` when oversized).
          this.db!.run(`
                        CREATE TABLE IF NOT EXISTS project_skills (
                            id TEXT PRIMARY KEY,
                            project_id TEXT NOT NULL UNIQUE,
                            frontmatter TEXT NOT NULL,
                            body TEXT NOT NULL,
                            compiled_at INTEGER NOT NULL,
                            token_count INTEGER NOT NULL DEFAULT 0,
                            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
                        )
                    `);
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_project_skills_project ON project_skills(project_id)`
          );
          this.db!.run(`
                        CREATE TABLE IF NOT EXISTS project_skill_references (
                            id TEXT PRIMARY KEY,
                            skill_id TEXT NOT NULL,
                            topic TEXT NOT NULL,
                            content TEXT NOT NULL,
                            source_finding_ids TEXT,
                            FOREIGN KEY(skill_id) REFERENCES project_skills(id) ON DELETE CASCADE
                        )
                    `);
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_project_skill_refs_skill ON project_skill_references(skill_id)`
          );
          this.db!.run(
            `CREATE INDEX IF NOT EXISTS idx_project_skill_refs_topic ON project_skill_references(skill_id, topic)`
          );

          this.migrateProjectsTable()
            .then(() => {
              this.initialized = true;
              console.log("(AgentFlow) SQLite Database initialized successfully");
              resolve();
            })
            .catch(reject);
        });
      });
    });
  }

  // Helper for table migration logic
  private async migrateProjectsTable(): Promise<void> {
    return new Promise((resolve) => {
      this.db!.all("PRAGMA table_info(projects)", (err, rows: any[]) => {
        if (err) {
          console.error("(AgentFlow) Failed to check projects table info:", err);
          resolve(); // Continue anyway?
          return;
        }
        const hasGitUrl = rows && rows.some((r) => r.name === "git_remote_url");
        if (!hasGitUrl) {
          console.error("(DB) Migrating projects table schema...");
          this.db!.serialize(() => {
            this.db!.run("BEGIN TRANSACTION");
            this.db!.run("ALTER TABLE projects RENAME TO projects_old");
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
            this.db!.run("DROP TABLE projects_old");
            this.db!.run("COMMIT", (err) => {
              if (err) console.error("(DB) Migration failed:", err);
              else console.error("(DB) Projects table migration completed.");
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
    if (!this.db) throw new Error("Database not initialized");
    return this.db;
  }

  // --- Task Operations ---

  async getAllTasks(projectId?: string): Promise<Task[]> {
    return new Promise((resolve, reject) => {
      let query =
        "SELECT content, execution_order, version, claimed_by, claimed_at, claim_expires_at, group_id, parent_task_id FROM tasks";
      const params: any[] = [];
      if (projectId) {
        query += " WHERE project_id = ?";
        params.push(projectId);
      }
      query += " ORDER BY execution_order ASC, created_at ASC";

      this.getDb().all(query, params, (err, rows) => {
        if (err) reject(err);
        else {
          try {
            const tasks = rows.map((row: any) => {
              const t = JSON.parse(row.content);
              return {
                ...t,
                executionOrder: row.execution_order, // Ensure column value takes precedence
                version: row.version, // Group 1.3 — OCC column is source of truth
                // Wave 1 §10.C — lock columns are the source of truth.
                claimedBy: row.claimed_by ?? undefined,
                claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
                claimExpiresAt: row.claim_expires_at ? new Date(row.claim_expires_at) : undefined,
                // Wave 1 §10.D — group/hierarchy columns are the source of truth.
                groupId: row.group_id ?? undefined,
                parentTaskId: row.parent_task_id ?? undefined,
                createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
                updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
                completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
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
      this.getDb().get(
        "SELECT content, execution_order, version, claimed_by, claimed_at, claim_expires_at, group_id, parent_task_id FROM tasks WHERE id = ?",
        [id],
        (err, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else {
            try {
              const t = JSON.parse(row.content);
              const task = {
                ...t,
                executionOrder: row.execution_order, // Ensure column value takes precedence
                version: row.version, // Group 1.3 — OCC column is source of truth
                // Wave 1 §10.C — lock columns are the source of truth.
                claimedBy: row.claimed_by ?? undefined,
                claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
                claimExpiresAt: row.claim_expires_at ? new Date(row.claim_expires_at) : undefined,
                // Wave 1 §10.D — group/hierarchy columns are the source of truth.
                groupId: row.group_id ?? undefined,
                parentTaskId: row.parent_task_id ?? undefined,
                createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
                updatedAt: t.updatedAt ? new Date(t.updatedAt) : new Date(),
                completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
              };
              resolve(task);
            } catch (parseError) {
              reject(parseError);
            }
          }
        }
      );
    });
  }

  async saveTask(task: Task): Promise<void> {
    return new Promise((resolve, reject) => {
      // UPSERT (INSERT … ON CONFLICT DO UPDATE) instead of
      // `INSERT OR REPLACE`. Critical because `task_findings`,
      // `client_active_project`, and `destructive_audits` carry
      // FKs into `tasks` with ON DELETE CASCADE; the old
      // `INSERT OR REPLACE` semantics delete the existing row
      // first, which would cascade-wipe every artifact attached
      // to the task on every save. UPSERT updates in place, so
      // dependent rows survive.
      //
      // `version` (Group 1.3) is explicitly written because
      // `incrementTaskVersion` bumps it on a separate UPDATE;
      // the subsequent saveTask must preserve the bumped value
      // or OCC silently regresses every bump.
      const stmt = this.getDb().prepare(`
                INSERT INTO tasks (
                    id, name, status, created_at, updated_at, completed_at,
                    client_id, project_id, content, execution_order, version,
                    claimed_by, claimed_at, claim_expires_at,
                    group_id, parent_task_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name             = excluded.name,
                    status           = excluded.status,
                    created_at       = excluded.created_at,
                    updated_at       = excluded.updated_at,
                    completed_at     = excluded.completed_at,
                    client_id        = excluded.client_id,
                    project_id       = excluded.project_id,
                    content          = excluded.content,
                    execution_order  = excluded.execution_order,
                    version          = excluded.version,
                    claimed_by       = excluded.claimed_by,
                    claimed_at       = excluded.claimed_at,
                    claim_expires_at = excluded.claim_expires_at,
                    group_id         = excluded.group_id,
                    parent_task_id   = excluded.parent_task_id
            `);
      const createdAt =
        task.createdAt instanceof Date
          ? task.createdAt.getTime()
          : new Date(task.createdAt).getTime();
      const updatedAt =
        task.updatedAt instanceof Date
          ? task.updatedAt.getTime()
          : new Date(task.updatedAt).getTime();
      const completedAt = task.completedAt
        ? task.completedAt instanceof Date
          ? task.completedAt.getTime()
          : new Date(task.completedAt).getTime()
        : null;
      const version = (task as Task & { version?: number }).version ?? 1;
      const claimedBy = task.claimedBy ?? null;
      const claimedAt = task.claimedAt
        ? task.claimedAt instanceof Date
          ? task.claimedAt.getTime()
          : new Date(task.claimedAt).getTime()
        : null;
      const claimExpiresAt = task.claimExpiresAt
        ? task.claimExpiresAt instanceof Date
          ? task.claimExpiresAt.getTime()
          : new Date(task.claimExpiresAt).getTime()
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
        task.executionOrder || 0,
        version,
        claimedBy,
        claimedAt,
        claimExpiresAt,
        task.groupId ?? null,
        task.parentTaskId ?? null,
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
      this.getDb().run("DELETE FROM tasks WHERE id = ?", [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async saveTasks(tasks: Task[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const db = this.getDb();
      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        const stmt = db.prepare(`
                    INSERT OR REPLACE INTO tasks (
                        id, name, status, created_at, updated_at, completed_at,
                        client_id, project_id, content, execution_order, version,
                        claimed_by, claimed_at, claim_expires_at,
                        group_id, parent_task_id
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `);

        let errorOccurred = false;
        for (const task of tasks) {
          const createdAt =
            task.createdAt instanceof Date
              ? task.createdAt.getTime()
              : new Date(task.createdAt).getTime();
          const updatedAt =
            task.updatedAt instanceof Date
              ? task.updatedAt.getTime()
              : new Date(task.updatedAt).getTime();
          const completedAt = task.completedAt
            ? task.completedAt instanceof Date
              ? task.completedAt.getTime()
              : new Date(task.completedAt).getTime()
            : null;
          const version = (task as Task & { version?: number }).version ?? 1;
          const claimedAt = task.claimedAt
            ? task.claimedAt instanceof Date
              ? task.claimedAt.getTime()
              : new Date(task.claimedAt).getTime()
            : null;
          const claimExpiresAt = task.claimExpiresAt
            ? task.claimExpiresAt instanceof Date
              ? task.claimExpiresAt.getTime()
              : new Date(task.claimExpiresAt).getTime()
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
            task.executionOrder || 0,
            version,
            task.claimedBy ?? null,
            claimedAt,
            claimExpiresAt,
            task.groupId ?? null,
            task.parentTaskId ?? null,
            (err: Error | null) => {
              if (err) {
                errorOccurred = true;
                console.error("(AgentFlow) Error saving task:", err);
              }
            }
          );
        }
        stmt.finalize((err) => {
          if (err || errorOccurred) {
            db.run("ROLLBACK");
            reject(err || new Error("Bulk save failed"));
          } else {
            db.run("COMMIT", (err) => {
              if (err) reject(err);
              else resolve();
            });
          }
        });
      });
    });
  }

  // --- Project Operations ---

  async createProject(project: Project): Promise<void> {
    return new Promise((resolve, reject) => {
      this.getDb().run(
        `
                INSERT OR REPLACE INTO projects (
                    id, name, description, path, git_remote_url, tech_stack, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `,
        [
          project.id,
          project.name,
          project.description || null,
          project.path || null,
          project.gitRemoteUrl || null,
          project.techStack ? JSON.stringify(project.techStack) : null,
          project.createdAt.getTime(),
          project.updatedAt.getTime(),
        ],
        function (err) {
          if (err) {
            console.error("[AgentFlow] Failed to create project:", err);
            reject(err);
          } else {
            resolve();
          }
        }
      );
    });
  }

  async getProject(id: string): Promise<Project | null> {
    return new Promise((resolve, reject) => {
      this.getDb().get(
        `
                SELECT p.*, COUNT(t.id) as task_count 
                FROM projects p
                LEFT JOIN tasks t ON t.project_id = p.id
                WHERE p.id = ?
                GROUP BY p.id
            `,
        [id],
        (err, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else resolve(this.mapProjectRow(row));
        }
      );
    });
  }

  async getAllProjects(): Promise<Project[]> {
    return new Promise((resolve, reject) => {
      this.getDb().all(
        `
                SELECT p.*, COUNT(t.id) as task_count 
                FROM projects p
                LEFT JOIN tasks t ON t.project_id = p.id
                GROUP BY p.id
                ORDER BY p.updated_at DESC
            `,
        (err, rows: any[]) => {
          if (err) {
            if (err.message?.includes("no such table")) resolve([]);
            else reject(err);
          } else {
            const projects = rows?.map((row) => this.mapProjectRow(row)) || [];
            resolve(projects);
          }
        }
      );
    });
  }

  async deleteProject(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.getDb().run(`DELETE FROM projects WHERE id = ?`, [id], (err) => {
        if (err) reject(err);
        else resolve();
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
      updatedAt: new Date(row.updated_at),
    };
  }

  // --- Workflow Step Operations ---

  async createWorkflowStep(step: WorkflowStep): Promise<void> {
    return new Promise((resolve, reject) => {
      const stmt = this.getDb().prepare(`
                INSERT INTO workflow_steps (
                    id, project_id, task_id, step_type, content, previous_step_id, created_at,
                    tool_name, duration_ms, input_tokens, output_tokens, outcome, error_code, correlation_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
      stmt.run(
        step.id,
        step.projectId,
        step.taskId || null,
        step.stepType,
        step.content,
        step.previousStepId || null,
        step.createdAt.getTime(),
        step.toolName ?? null,
        step.durationMs ?? null,
        step.inputTokens ?? null,
        step.outputTokens ?? null,
        step.outcome ?? null,
        step.errorCode ?? null,
        step.correlationId ?? null,
        (err: Error | null) => {
          if (err) reject(err);
          else resolve();
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
        else resolve(this.mapWorkflowStepRow(row));
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
          else resolve(rows.map((row: any) => this.mapWorkflowStepRow(row)));
        }
      );
    });
  }

  private mapWorkflowStepRow(row: any): WorkflowStep {
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id,
      stepType: row.step_type as WorkflowStepType,
      content: row.content,
      previousStepId: row.previous_step_id,
      createdAt: new Date(row.created_at),
      toolName: row.tool_name ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      inputTokens: row.input_tokens ?? undefined,
      outputTokens: row.output_tokens ?? undefined,
      outcome: (row.outcome as "success" | "error" | null) ?? undefined,
      errorCode: row.error_code ?? undefined,
      correlationId: row.correlation_id ?? undefined,
    };
  }

  async deleteWorkflowStepsByProject(projectId: string): Promise<number> {
    return new Promise((resolve, reject) => {
      this.getDb().run(
        "DELETE FROM workflow_steps WHERE project_id = ?",
        [projectId],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes || 0);
        }
      );
    });
  }

  // --- Client Operations ---

  async registerClient(client: Client): Promise<void> {
    return new Promise((resolve, reject) => {
      this.getDb().run(
        `
                INSERT OR REPLACE INTO clients (
                    id, name, type, workspace, connected_at, last_activity_at, is_active
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
        [
          client.id,
          client.name,
          client.type,
          client.workspace,
          client.connectedAt.getTime(),
          client.lastActivityAt.getTime(),
          client.isActive ? 1 : 0,
        ],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async getAllClients(activeOnly: boolean = true): Promise<Client[]> {
    return new Promise((resolve, reject) => {
      const whereClause = activeOnly ? "WHERE is_active = 1" : "";
      this.getDb().all(
        `
                SELECT * FROM clients ${whereClause} ORDER BY last_activity_at DESC
            `,
        (err, rows: any[]) => {
          if (err) {
            if (err.message?.includes("no such table")) resolve([]);
            else reject(err);
          } else {
            const clients =
              rows?.map((row) => ({
                id: row.id,
                name: row.name,
                type: row.type as Client["type"],
                workspace: row.workspace,
                connectedAt: new Date(row.connected_at),
                lastActivityAt: new Date(row.last_activity_at),
                isActive: row.is_active === 1,
              })) || [];
            resolve(clients);
          }
        }
      );
    });
  }

  async getClient(id: string): Promise<Client | null> {
    return new Promise((resolve, reject) => {
      this.getDb().get(`SELECT * FROM clients WHERE id = ?`, [id], (err, row: any) => {
        if (err) reject(err);
        else if (!row) resolve(null);
        else {
          resolve({
            id: row.id,
            name: row.name,
            type: row.type as Client["type"],
            workspace: row.workspace,
            connectedAt: new Date(row.connected_at),
            lastActivityAt: new Date(row.last_activity_at),
            isActive: row.is_active === 1,
          });
        }
      });
    });
  }

  async updateClientHeartbeat(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.getDb().run(
        `UPDATE clients SET last_activity_at = ?, is_active = 1 WHERE id = ?`,
        [Date.now(), id],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  async cleanupStaleClients(timeoutMs: number): Promise<number> {
    const cutoff = Date.now() - timeoutMs;
    return new Promise((resolve, reject) => {
      this.getDb().run(
        `UPDATE clients SET is_active = 0 WHERE is_active = 1 AND last_activity_at < ?`,
        [cutoff],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes || 0);
        }
      );
    });
  }

  async markAllClientsInactive(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.getDb().run(`UPDATE clients SET is_active = 0`, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  async deleteClient(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.getDb().run(`DELETE FROM clients WHERE id = ?`, [id], (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  async deleteInactiveClients(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.getDb().run(`DELETE FROM clients WHERE is_active = 0`, function (err) {
        if (err) reject(err);
        else resolve(this.changes || 0);
      });
    });
  }

  // --- Transactions (Group 3.2) ---

  /**
   * Wrap `fn` in a `BEGIN IMMEDIATE` / `COMMIT` pair so cross-row
   * mutations land atomically. On any throw → `ROLLBACK` and re-throw.
   *
   * Reentrancy: SQLite does not support nested transactions on the
   * default connection — calling `runInTransaction` from within an
   * already-active one would fail at the second `BEGIN`. Callers that
   * already hold a transaction must call `fn` directly.
   */
  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    const db = this.getDb();
    await new Promise<void>((resolve, reject) => {
      db.run("BEGIN IMMEDIATE", (err) => (err ? reject(err) : resolve()));
    });
    try {
      const value = await fn();
      await new Promise<void>((resolve, reject) => {
        db.run("COMMIT", (err) => (err ? reject(err) : resolve()));
      });
      return value;
    } catch (err) {
      await new Promise<void>((resolve) => {
        db.run("ROLLBACK", () => resolve());
      });
      throw err;
    }
  }

  // --- Task version (optimistic concurrency) ---

  async incrementTaskVersion(
    taskId: string,
    expectedVersion: number
  ): Promise<IncrementTaskVersionResult> {
    // No explicit BEGIN/COMMIT here: the single UPDATE statement is
    // atomic, and `db.serialize` keeps the follow-up SELECT in-line on
    // the same connection. Keeping this method transaction-free is
    // what lets `runInTransaction` (Group 3.2) call it without nesting.
    const db = this.getDb();
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(
          `UPDATE tasks SET version = version + 1 WHERE id = ? AND version = ?`,
          [taskId, expectedVersion],
          function (updateErr) {
            if (updateErr) {
              reject(updateErr);
              return;
            }

            if (this.changes === 1) {
              resolve({ ok: true, newVersion: expectedVersion + 1 });
              return;
            }

            db.get(
              `SELECT version FROM tasks WHERE id = ?`,
              [taskId],
              (selectErr, row: { version?: number } | undefined) => {
                if (selectErr) {
                  reject(selectErr);
                  return;
                }
                resolve({ ok: false, currentVersion: row?.version ?? null });
              }
            );
          }
        );
      });
    });
  }

  // --- Multi-agent lock (Wave 1 §10.C) ---

  /**
   * Atomically take or renew the lock on a task. The conditional WHERE
   * encodes the "lock-free or mine or expired" predicate so two competing
   * callers cannot both believe they got the claim.
   *
   * Bumps `tasks.version` by exactly one on success (since holding the
   * claim is observable state). Heartbeat-style re-claim by the same
   * client is treated as a renewal and also bumps version.
   */
  async claimTask(taskId: string, clientId: string, ttlMs: number): Promise<ClaimTaskResult> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const db = this.getDb();
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(
          `UPDATE tasks SET claimed_by = ?, claimed_at = ?, claim_expires_at = ?, version = version + 1
             WHERE id = ?
               AND (claimed_by IS NULL OR claimed_by = ? OR claim_expires_at IS NULL OR claim_expires_at < ?)`,
          [clientId, now, expiresAt, taskId, clientId, now],
          function (updateErr) {
            if (updateErr) {
              reject(updateErr);
              return;
            }
            if (this.changes === 1) {
              db.get(
                `SELECT version FROM tasks WHERE id = ?`,
                [taskId],
                (selErr, row: { version?: number } | undefined) => {
                  if (selErr) reject(selErr);
                  else
                    resolve({
                      ok: true,
                      newVersion: row?.version ?? 1,
                      claimedAt: new Date(now),
                      claimExpiresAt: new Date(expiresAt),
                    });
                }
              );
              return;
            }
            // No row matched → either the task does not exist or the lock is
            // held by another live client. Read the current claim state so
            // the caller can render a TASK_LOCKED CONFLICT body.
            db.get(
              `SELECT claimed_by, claimed_at, claim_expires_at FROM tasks WHERE id = ?`,
              [taskId],
              (
                selErr,
                row:
                  | {
                      claimed_by?: string | null;
                      claimed_at?: number | null;
                      claim_expires_at?: number | null;
                    }
                  | undefined
              ) => {
                if (selErr) {
                  reject(selErr);
                  return;
                }
                if (!row || !row.claimed_by) {
                  // Task gone — surface as a lock failure with a synthetic
                  // holder. The lifecycle layer translates a missing task
                  // into NotFoundError via loadOrThrow before calling here,
                  // so this branch should be unreachable in practice.
                  resolve({
                    ok: false,
                    heldBy: "(unknown)",
                    claimedAt: new Date(0),
                    claimExpiresAt: new Date(0),
                  });
                  return;
                }
                resolve({
                  ok: false,
                  heldBy: row.claimed_by,
                  claimedAt: row.claimed_at ? new Date(row.claimed_at) : new Date(0),
                  claimExpiresAt: row.claim_expires_at
                    ? new Date(row.claim_expires_at)
                    : new Date(0),
                });
              }
            );
          }
        );
      });
    });
  }

  /**
   * Heartbeat — push out `claim_expires_at` for a claim already held by
   * `clientId`. Returns `{ ok: false }` if the lock is not held by this
   * client (or has already expired); callers should re-claim in that case.
   * Bumps version on success.
   */
  async extendTaskClaim(
    taskId: string,
    clientId: string,
    ttlMs: number
  ): Promise<ExtendClaimResult> {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const db = this.getDb();
    return new Promise((resolve, reject) => {
      db.serialize(() => {
        db.run(
          `UPDATE tasks SET claim_expires_at = ?, version = version + 1
             WHERE id = ? AND claimed_by = ? AND claim_expires_at IS NOT NULL AND claim_expires_at >= ?`,
          [expiresAt, taskId, clientId, now],
          function (updateErr) {
            if (updateErr) {
              reject(updateErr);
              return;
            }
            if (this.changes !== 1) {
              resolve({ ok: false });
              return;
            }
            db.get(
              `SELECT version FROM tasks WHERE id = ?`,
              [taskId],
              (selErr, row: { version?: number } | undefined) => {
                if (selErr) reject(selErr);
                else
                  resolve({
                    ok: true,
                    newVersion: row?.version ?? 1,
                    claimExpiresAt: new Date(expiresAt),
                  });
              }
            );
          }
        );
      });
    });
  }

  /**
   * Clear claim columns unconditionally. Caller is responsible for any
   * accompanying state changes (status flip, version bump). Used by
   * `release` / `block` / `archive` / `finalize` and by Wave 2 read-time
   * recovery once it lands.
   */
  async clearTaskClaim(taskId: string): Promise<void> {
    const db = this.getDb();
    return new Promise((resolve, reject) => {
      db.run(
        `UPDATE tasks SET claimed_by = NULL, claimed_at = NULL, claim_expires_at = NULL WHERE id = ?`,
        [taskId],
        (err) => {
          if (err) reject(err);
          else resolve();
        }
      );
    });
  }

  // --- Task groups (Wave 1 §10.D) ---

  private mapGroupRow(row: any): TaskGroup {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description ?? undefined,
      status: (row.status ?? "active") as "active" | "completed" | "archived",
      parentGroupId: (row.parent_group_id as string | null) ?? undefined,
      executionOrder: (row.execution_order as number | null) ?? 0,
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
  }

  async createGroup(input: TaskGroupInput): Promise<TaskGroup> {
    const id = input.id ?? randomUUID();
    const now = Date.now();
    const status = input.status ?? "active";
    const parentGroupId = input.parentGroupId ?? null;
    const executionOrder = input.executionOrder ?? 0;
    return new Promise((resolve, reject) => {
      this.getDb().run(
        `INSERT INTO task_groups
           (id, project_id, name, description, status, parent_group_id, execution_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.projectId,
          input.name,
          input.description ?? null,
          status,
          parentGroupId,
          executionOrder,
          now,
          now,
        ],
        (err) => {
          if (err) reject(err);
          else
            resolve({
              id,
              projectId: input.projectId,
              name: input.name,
              description: input.description,
              status,
              parentGroupId: parentGroupId ?? undefined,
              executionOrder,
              createdAt: new Date(now),
              updatedAt: new Date(now),
            });
        }
      );
    });
  }

  async getGroup(id: string): Promise<TaskGroup | null> {
    return new Promise((resolve, reject) => {
      this.getDb().get(
        `SELECT id, project_id, name, description, status, parent_group_id, execution_order, created_at, updated_at
           FROM task_groups WHERE id = ?`,
        [id],
        (err, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else resolve(this.mapGroupRow(row));
        }
      );
    });
  }

  async listGroups(projectId: string): Promise<TaskGroup[]> {
    return new Promise((resolve, reject) => {
      this.getDb().all(
        `SELECT id, project_id, name, description, status, parent_group_id, execution_order, created_at, updated_at
           FROM task_groups
           WHERE project_id = ?
           ORDER BY execution_order ASC, created_at DESC`,
        [projectId],
        (err, rows: any[]) => {
          if (err) reject(err);
          else resolve((rows ?? []).map((r) => this.mapGroupRow(r)));
        }
      );
    });
  }

  async updateGroup(
    id: string,
    patch: Partial<Pick<TaskGroup, "name" | "description" | "status">>
  ): Promise<TaskGroup | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (patch.name !== undefined) {
      sets.push("name = ?");
      params.push(patch.name);
    }
    if (patch.description !== undefined) {
      sets.push("description = ?");
      params.push(patch.description);
    }
    if (patch.status !== undefined) {
      sets.push("status = ?");
      params.push(patch.status);
    }
    if (sets.length === 0) return this.getGroup(id);
    sets.push("updated_at = ?");
    params.push(Date.now());
    params.push(id);
    await new Promise<void>((resolve, reject) => {
      this.getDb().run(`UPDATE task_groups SET ${sets.join(", ")} WHERE id = ?`, params, (err) =>
        err ? reject(err) : resolve()
      );
    });
    return this.getGroup(id);
  }

  async deleteGroup(id: string): Promise<void> {
    // Emulate two FK cascades SQLite cannot express on an ALTER-added column:
    //   1. Feature→Group ON DELETE CASCADE — deleting a feature also deletes its
    //      child section groups (one level deep).
    //   2. tasks.group_id ON DELETE SET NULL — null the group_id of every task
    //      that pointed at this group OR any of its child groups.
    const db = this.getDb();
    await new Promise<void>((resolve, reject) => {
      db.run(
        `UPDATE tasks SET group_id = NULL
           WHERE group_id = ?
              OR group_id IN (SELECT id FROM task_groups WHERE parent_group_id = ?)`,
        [id, id],
        (err) => (err ? reject(err) : resolve())
      );
    });
    await new Promise<void>((resolve, reject) => {
      db.run(`DELETE FROM task_groups WHERE id = ? OR parent_group_id = ?`, [id, id], (err) =>
        err ? reject(err) : resolve()
      );
    });
  }

  async getGroupCounts(
    projectId: string
  ): Promise<Array<{ groupId: string | null; status: string; count: number }>> {
    return new Promise((resolve, reject) => {
      this.getDb().all(
        `SELECT group_id, status, COUNT(*) as count
           FROM tasks
           WHERE project_id = ?
           GROUP BY group_id, status`,
        [projectId],
        (err, rows: any[]) => {
          if (err) reject(err);
          else
            resolve(
              (rows ?? []).map((r) => ({
                groupId: (r.group_id as string | null) ?? null,
                status: r.status as string,
                count: r.count as number,
              }))
            );
        }
      );
    });
  }

  // --- Findings (Group 1.1 / 1.7 / 1.8) ---

  private resolveProjectIdForTask(taskId: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      this.getDb().get(
        `SELECT project_id FROM tasks WHERE id = ?`,
        [taskId],
        (err, row: { project_id?: string | null } | undefined) => {
          if (err) reject(err);
          else resolve(row?.project_id ?? null);
        }
      );
    });
  }

  async createFinding(input: TaskFindingInput): Promise<TaskFinding> {
    let projectId = input.projectId;
    if (!projectId) {
      const resolved = await this.resolveProjectIdForTask(input.taskId);
      if (!resolved) {
        throw new Error(
          `createFinding: cannot resolve project_id from taskId=${input.taskId} (task not found or has no project)`
        );
      }
      projectId = resolved;
    }

    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? new Date();
    const contentJson =
      typeof input.content === "string" ? input.content : JSON.stringify(input.content ?? null);
    const metadataJson = input.metadata !== undefined ? JSON.stringify(input.metadata) : null;

    await new Promise<void>((resolve, reject) => {
      this.getDb().run(
        `INSERT INTO task_findings (id, project_id, task_id, kind, type, content, metadata, created_at, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          projectId,
          input.taskId,
          input.kind,
          input.type ?? null,
          contentJson,
          metadataJson,
          createdAt.getTime(),
          input.createdBy ?? null,
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });

    return {
      id,
      projectId,
      taskId: input.taskId,
      kind: input.kind,
      type: input.type,
      content: input.content,
      metadata: input.metadata,
      createdAt,
      createdBy: input.createdBy,
    };
  }

  async listFindings(filter: ListFindingsFilter): Promise<TaskFinding[]> {
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter.taskId) {
      clauses.push(`task_id = ?`);
      params.push(filter.taskId);
    }
    if (filter.projectId) {
      clauses.push(`project_id = ?`);
      params.push(filter.projectId);
    }
    if (filter.kind) {
      clauses.push(`kind = ?`);
      params.push(filter.kind);
    }
    if (filter.type) {
      clauses.push(`type = ?`);
      params.push(filter.type);
    }
    if (filter.sinceMs) {
      clauses.push(`created_at >= ?`);
      params.push(filter.sinceMs);
    }

    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filter.limit && filter.limit > 0 ? `LIMIT ${Math.floor(filter.limit)}` : "";
    const sql = `SELECT * FROM task_findings ${where} ORDER BY created_at DESC ${limit}`;

    return new Promise((resolve, reject) => {
      this.getDb().all(sql, params, (err, rows: any[]) => {
        if (err) reject(err);
        else resolve((rows || []).map((row) => this.mapFindingRow(row)));
      });
    });
  }

  async deleteFindingsOlderThan(cutoffMs: number): Promise<number> {
    return new Promise((resolve, reject) => {
      this.getDb().run(
        `DELETE FROM task_findings WHERE created_at < ?`,
        [cutoffMs],
        function (err) {
          if (err) reject(err);
          else resolve(this.changes || 0);
        }
      );
    });
  }

  private mapFindingRow(row: any): TaskFinding {
    let content: unknown = row.content;
    if (typeof row.content === "string") {
      try {
        content = JSON.parse(row.content);
      } catch {
        /* keep raw */
      }
    }
    let metadata: Record<string, unknown> | undefined;
    if (row.metadata != null) {
      try {
        metadata = JSON.parse(row.metadata);
      } catch {
        metadata = undefined;
      }
    }
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id,
      kind: row.kind,
      type: row.type ?? undefined,
      content,
      metadata,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by ?? undefined,
    };
  }

  // --- Lesson summaries (Group 1.2) ---

  async createLessonSummary(input: LessonSummaryInput): Promise<LessonSummary> {
    const id = input.id ?? randomUUID();
    const now = new Date();
    const sourceJson = input.sourceFindingIds ? JSON.stringify(input.sourceFindingIds) : null;

    await new Promise<void>((resolve, reject) => {
      this.getDb().run(
        `INSERT INTO lesson_summaries (id, project_id, topic, summary, source_finding_ids, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, input.projectId, input.topic, input.summary, sourceJson, now.getTime(), now.getTime()],
        (err) => (err ? reject(err) : resolve())
      );
    });

    return {
      id,
      projectId: input.projectId,
      topic: input.topic,
      summary: input.summary,
      sourceFindingIds: input.sourceFindingIds,
      createdAt: now,
      updatedAt: now,
    };
  }

  async listLessonSummaries(filter: ListLessonsFilter): Promise<LessonSummary[]> {
    const clauses: string[] = [`project_id = ?`];
    const params: any[] = [filter.projectId];
    if (filter.topic) {
      clauses.push(`topic = ?`);
      params.push(filter.topic);
    }
    const limit = filter.limit && filter.limit > 0 ? `LIMIT ${Math.floor(filter.limit)}` : "";
    const sql = `SELECT * FROM lesson_summaries WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC ${limit}`;

    return new Promise((resolve, reject) => {
      this.getDb().all(sql, params, (err, rows: any[]) => {
        if (err) reject(err);
        else
          resolve(
            (rows || []).map((row) => ({
              id: row.id,
              projectId: row.project_id,
              topic: row.topic,
              summary: row.summary,
              sourceFindingIds: row.source_finding_ids
                ? JSON.parse(row.source_finding_ids)
                : undefined,
              createdAt: new Date(row.created_at),
              updatedAt: new Date(row.updated_at),
            }))
          );
      });
    });
  }

  // --- Per-client active project (Group 1.4) ---

  async getActiveProjectForClient(clientId: string): Promise<ClientActiveProject | null> {
    return new Promise((resolve, reject) => {
      this.getDb().get(
        `SELECT client_id, project_id, set_at FROM client_active_project WHERE client_id = ?`,
        [clientId],
        (err, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else
            resolve({
              clientId: row.client_id,
              projectId: row.project_id,
              setAt: new Date(row.set_at),
            });
        }
      );
    });
  }

  async setActiveProjectForClient(
    clientId: string,
    projectId: string
  ): Promise<ClientActiveProject> {
    const setAt = new Date();
    await new Promise<void>((resolve, reject) => {
      this.getDb().run(
        `INSERT INTO client_active_project (client_id, project_id, set_at)
                 VALUES (?, ?, ?)
                 ON CONFLICT(client_id) DO UPDATE SET project_id = excluded.project_id, set_at = excluded.set_at`,
        [clientId, projectId, setAt.getTime()],
        (err) => (err ? reject(err) : resolve())
      );
    });
    return { clientId, projectId, setAt };
  }

  // --- LLM settings (Group 1.5) ---

  async getLlmSettings(): Promise<LlmSettings | null> {
    return new Promise((resolve, reject) => {
      this.getDb().get(
        `SELECT provider, model, selection_strategy, workflow_mode, updated_at FROM llm_settings WHERE id = 1`,
        [],
        (err, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else
            resolve({
              provider: row.provider ?? undefined,
              model: row.model ?? undefined,
              selectionStrategy: row.selection_strategy ?? undefined,
              workflowMode: row.workflow_mode ?? undefined,
              updatedAt: new Date(row.updated_at),
            });
        }
      );
    });
  }

  async setLlmSettings(input: LlmSettingsInput): Promise<LlmSettings> {
    const updatedAt = new Date();
    await new Promise<void>((resolve, reject) => {
      this.getDb().run(
        `INSERT INTO llm_settings (id, provider, model, selection_strategy, workflow_mode, updated_at)
                 VALUES (1, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                     provider           = excluded.provider,
                     model              = excluded.model,
                     selection_strategy = excluded.selection_strategy,
                     workflow_mode      = excluded.workflow_mode,
                     updated_at         = excluded.updated_at`,
        [
          input.provider ?? null,
          input.model ?? null,
          input.selectionStrategy ?? null,
          input.workflowMode ?? null,
          updatedAt.getTime(),
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });
    return {
      provider: input.provider,
      model: input.model,
      selectionStrategy: input.selectionStrategy,
      workflowMode: input.workflowMode,
      updatedAt,
    };
  }

  // --- Destructive audit log (Group 6.3) ---

  async appendDestructiveAudit(row: DestructiveAuditRow): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.getDb().run(
        `INSERT INTO destructive_audits (id, tool, project_id, reason, affected_ids, invoked_by, metadata, correlation_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id,
          row.tool,
          row.projectId,
          row.reason,
          JSON.stringify(row.affectedIds),
          row.invokedBy,
          row.metadata !== undefined ? JSON.stringify(row.metadata) : null,
          row.correlationId ?? null,
          row.createdAt.getTime(),
        ],
        (err) => (err ? reject(err) : resolve())
      );
    });
  }

  async listDestructiveAudits(filter?: DestructiveAuditFilter): Promise<DestructiveAuditRow[]> {
    const clauses: string[] = [];
    const params: any[] = [];
    if (filter?.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter?.tool) {
      clauses.push("tool = ?");
      params.push(filter.tool);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = filter?.limit && filter.limit > 0 ? `LIMIT ${Math.floor(filter.limit)}` : "";
    return new Promise((resolve, reject) => {
      this.getDb().all(
        `SELECT * FROM destructive_audits ${where} ORDER BY created_at DESC ${limit}`,
        params,
        (err, rows: any[]) => {
          if (err) reject(err);
          else
            resolve(
              (rows || []).map((r) => ({
                id: r.id,
                tool: r.tool,
                projectId: r.project_id,
                reason: r.reason,
                affectedIds: JSON.parse(r.affected_ids),
                invokedBy: r.invoked_by,
                metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
                correlationId: r.correlation_id ?? undefined,
                createdAt: new Date(r.created_at),
              }))
            );
        }
      );
    });
  }

  // --- Wave 3 §10.E — Project Skill ---

  async getSkillByProject(projectId: string): Promise<ProjectSkill | null> {
    return new Promise((resolve, reject) => {
      this.getDb().get(
        `SELECT id, project_id, frontmatter, body, compiled_at, token_count FROM project_skills WHERE project_id = ?`,
        [projectId],
        (err, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else
            resolve({
              id: row.id,
              projectId: row.project_id,
              frontmatter: JSON.parse(row.frontmatter),
              body: row.body,
              compiledAt: new Date(row.compiled_at),
              tokenCount: row.token_count ?? 0,
            });
        }
      );
    });
  }

  async upsertSkill(input: ProjectSkillInput): Promise<ProjectSkill> {
    const id = input.id ?? randomUUID();
    const compiledAt = input.compiledAt ?? new Date();
    const frontmatterJson = JSON.stringify(input.frontmatter ?? {});
    // ON CONFLICT(project_id) — project_id is UNIQUE in the table — so
    // repeat compiles reuse the same row id (idempotent semantics).
    await new Promise<void>((resolve, reject) => {
      this.getDb().run(
        `INSERT INTO project_skills (id, project_id, frontmatter, body, compiled_at, token_count)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(project_id) DO UPDATE SET
                     frontmatter = excluded.frontmatter,
                     body        = excluded.body,
                     compiled_at = excluded.compiled_at,
                     token_count = excluded.token_count`,
        [id, input.projectId, frontmatterJson, input.body, compiledAt.getTime(), input.tokenCount],
        (err) => (err ? reject(err) : resolve())
      );
    });
    // Re-read so the returned id reflects an existing row when the upsert
    // hit the ON CONFLICT branch (UPDATE doesn't overwrite the primary key).
    const existing = await this.getSkillByProject(input.projectId);
    return (
      existing ?? {
        id,
        projectId: input.projectId,
        frontmatter: input.frontmatter,
        body: input.body,
        compiledAt,
        tokenCount: input.tokenCount,
      }
    );
  }

  async replaceSkillReferences(
    skillId: string,
    refs: ProjectSkillReferenceInput[]
  ): Promise<ProjectSkillReference[]> {
    const db = this.getDb();
    // Delete first so re-runs don't accumulate stale topics.
    await new Promise<void>((resolve, reject) => {
      db.run(`DELETE FROM project_skill_references WHERE skill_id = ?`, [skillId], (err) =>
        err ? reject(err) : resolve()
      );
    });
    const inserted: ProjectSkillReference[] = [];
    for (const ref of refs) {
      const id = randomUUID();
      const ids = ref.sourceFindingIds ? JSON.stringify(ref.sourceFindingIds) : null;
      await new Promise<void>((resolve, reject) => {
        db.run(
          `INSERT INTO project_skill_references (id, skill_id, topic, content, source_finding_ids)
                     VALUES (?, ?, ?, ?, ?)`,
          [id, skillId, ref.topic, ref.content, ids],
          (err) => (err ? reject(err) : resolve())
        );
      });
      inserted.push({
        id,
        skillId,
        topic: ref.topic,
        content: ref.content,
        sourceFindingIds: ref.sourceFindingIds,
      });
    }
    return inserted;
  }

  async listSkillReferences(skillId: string): Promise<ProjectSkillReference[]> {
    return new Promise((resolve, reject) => {
      this.getDb().all(
        `SELECT id, skill_id, topic, content, source_finding_ids
                 FROM project_skill_references WHERE skill_id = ? ORDER BY topic ASC`,
        [skillId],
        (err, rows: any[]) => {
          if (err) reject(err);
          else
            resolve(
              (rows || []).map((r) => ({
                id: r.id,
                skillId: r.skill_id,
                topic: r.topic,
                content: r.content,
                sourceFindingIds: r.source_finding_ids
                  ? JSON.parse(r.source_finding_ids)
                  : undefined,
              }))
            );
        }
      );
    });
  }

  async getSkillReference(skillId: string, topic: string): Promise<ProjectSkillReference | null> {
    return new Promise((resolve, reject) => {
      this.getDb().get(
        `SELECT id, skill_id, topic, content, source_finding_ids
                 FROM project_skill_references WHERE skill_id = ? AND topic = ?`,
        [skillId, topic],
        (err, row: any) => {
          if (err) reject(err);
          else if (!row) resolve(null);
          else
            resolve({
              id: row.id,
              skillId: row.skill_id,
              topic: row.topic,
              content: row.content,
              sourceFindingIds: row.source_finding_ids
                ? JSON.parse(row.source_finding_ids)
                : undefined,
            });
        }
      );
    });
  }
}
