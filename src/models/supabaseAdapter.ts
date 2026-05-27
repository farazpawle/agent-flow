import { createClient, SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
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
  TaskFinding,
  TaskFindingInput,
} from "./interfaces.js";
import { Task, TaskGroup, TaskGroupInput } from "../types/index.js";
import { Project } from "./projectModel.js";
import { Client } from "./clientModel.js";
import { WorkflowStep, WorkflowStepType } from "./workflowModel.js";
import { taskEvents, TASK_EVENTS } from "../utils/events.js";
import { applyEnvironmentAliases } from "../utils/envConfig.js";

export class SupabaseAdapter implements DatabaseAdapter {
  private supabase: SupabaseClient | null = null;
  private initialized: boolean = false;
  private tasksChannel: RealtimeChannel | null = null;

  async init(): Promise<void> {
    if (this.initialized) return;

    applyEnvironmentAliases(process.env);

    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables");
    }

    try {
      this.supabase = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: false },
      });

      // Verify connection by making a lightweight call
      const { error } = await this.supabase.from("projects").select("id").limit(1);

      if (error) {
        // If table doesn't exist, it might be a 404 or specific error.
        // Since we can't easily auto-create tables in Supabase from here (requires admin API or SQL editor),
        // we assume the user has run the schema script.
        console.error("(AgentFlow) Supabase connection check failed:", error.message);
        throw error;
      }

      // --- Realtime Subscription Setup ---
      // Subscribe to all changes in 'tasks' table
      this.tasksChannel = this.supabase
        .channel("room_tasks")
        .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, (payload) => {
          console.error("(AgentFlow) Realtime update received:", payload.eventType);
          // Emit event so the server can push SSE to clients
          taskEvents.emit(TASK_EVENTS.UPDATED);
        })
        .subscribe((status) => {
          // console.error(`(AgentFlow) Realtime subscription status: ${status}`);
        });

      this.initialized = true;
      console.error("(AgentFlow) Supabase connection established successfully");
    } catch (error) {
      console.error("(AgentFlow) Failed to initialize Supabase client:", error);
      throw error;
    }
  }

  async close(): Promise<void> {
    if (this.tasksChannel) {
      await this.supabase?.removeChannel(this.tasksChannel);
      this.tasksChannel = null;
    }
    // Supabase client is stateless mostly, but we can set null
    this.supabase = null;
    this.initialized = false;
    return Promise.resolve();
  }

  private getSupabase(): SupabaseClient {
    if (!this.supabase) throw new Error("Supabase client not initialized");
    return this.supabase;
  }

  // --- Task Operations ---

  async getAllTasks(projectId?: string): Promise<Task[]> {
    let query = this.getSupabase()
      .from("tasks")
      .select(
        "content, execution_order, version, claimed_by, claimed_at, claim_expires_at, group_id, parent_task_id"
      );

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    try {
      const { data, error } = await query
        .order("execution_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data.map((row: any) => {
        const task = row.content;
        return {
          ...task,
          executionOrder: row.execution_order ?? task.executionOrder,
          version: row.version, // Group 1.3 — OCC column is source of truth
          claimedBy: row.claimed_by ?? undefined,
          claimedAt: row.claimed_at ? new Date(row.claimed_at) : undefined,
          claimExpiresAt: row.claim_expires_at ? new Date(row.claim_expires_at) : undefined,
          groupId: row.group_id ?? undefined,
          parentTaskId: row.parent_task_id ?? undefined,
          createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
          updatedAt: task.updatedAt ? new Date(task.updatedAt) : new Date(),
          completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
        };
      });
    } catch (error: any) {
      // Fallback if execution_order column is missing
      if (error.message?.includes("execution_order") || error.code === "42703") {
        // 42703 is undefined_column
        console.warn("(AgentFlow) execution_order column missing, falling back to created_at sort");
        const { data, error: retryError } = await this.getSupabase()
          .from("tasks")
          .select("content")
          .order("created_at", { ascending: true });
        if (retryError) throw retryError;
        return data.map((row: any) => {
          const task = row.content;
          return {
            ...task,
            createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
            updatedAt: task.updatedAt ? new Date(task.updatedAt) : new Date(),
            completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
          };
        });
      }
      throw error;
    }
  }

  async getTask(id: string): Promise<Task | null> {
    const { data, error } = await this.getSupabase()
      .from("tasks")
      .select(
        "content, execution_order, version, claimed_by, claimed_at, claim_expires_at, group_id, parent_task_id"
      )
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null; // Not found code
      throw error;
    }

    if (!data) return null;
    const task = data.content;
    return {
      ...task,
      executionOrder: data.execution_order ?? task.executionOrder,
      version: data.version, // Group 1.3 — OCC column is source of truth
      claimedBy: data.claimed_by ?? undefined,
      claimedAt: data.claimed_at ? new Date(data.claimed_at) : undefined,
      claimExpiresAt: data.claim_expires_at ? new Date(data.claim_expires_at) : undefined,
      groupId: data.group_id ?? undefined,
      parentTaskId: data.parent_task_id ?? undefined,
      createdAt: task.createdAt ? new Date(task.createdAt) : new Date(),
      updatedAt: task.updatedAt ? new Date(task.updatedAt) : new Date(),
      completedAt: task.completedAt ? new Date(task.completedAt) : undefined,
    };
  }

  async saveTask(task: Task): Promise<void> {
    const createdAt =
      task.createdAt instanceof Date
        ? task.createdAt.toISOString()
        : new Date(task.createdAt).toISOString();
    const updatedAt =
      task.updatedAt instanceof Date
        ? task.updatedAt.toISOString()
        : new Date(task.updatedAt).toISOString();
    const completedAt = task.completedAt
      ? task.completedAt instanceof Date
        ? task.completedAt.toISOString()
        : new Date(task.completedAt).toISOString()
      : null;

    const taskData = {
      id: task.id,
      name: task.name,
      status: task.status,
      created_at: createdAt,
      updated_at: updatedAt,
      completed_at: completedAt,
      client_id: (task as any).clientId ?? null,
      project_id: (task as any).projectId ?? null,
      content: task, // Supabase handles object -> JSONB automatically
      execution_order: task.executionOrder || 0,
      // Group 1.3 OCC column. Upserts must echo the current version
      // (or 1 for new rows) so `incrementTaskVersion`'s bump is
      // never clobbered by a downstream saveTask.
      version: (task as Task & { version?: number }).version ?? 1,
      // Wave 1 §10.C — lock columns persisted as their own columns, not
      // inside the JSON blob, so atomic claim/extend can target them.
      claimed_by: task.claimedBy ?? null,
      claimed_at: task.claimedAt
        ? task.claimedAt instanceof Date
          ? task.claimedAt.toISOString()
          : new Date(task.claimedAt).toISOString()
        : null,
      claim_expires_at: task.claimExpiresAt
        ? task.claimExpiresAt instanceof Date
          ? task.claimExpiresAt.toISOString()
          : new Date(task.claimExpiresAt).toISOString()
        : null,
      // Wave 1 §10.D — group/hierarchy columns.
      group_id: task.groupId ?? null,
      parent_task_id: task.parentTaskId ?? null,
    };

    try {
      const { error } = await this.getSupabase().from("tasks").upsert(taskData);
      if (error) throw error;
    } catch (error: any) {
      if (error.message?.includes("execution_order") || error.code === "42703") {
        console.warn("(AgentFlow) execution_order column missing in saveTask, retrying without it");
        const { execution_order, ...fallbackData } = taskData;
        const { error: retryError } = await this.getSupabase().from("tasks").upsert(fallbackData);
        if (retryError) throw retryError;
        return;
      }
      throw error;
    }
  }

  async deleteTask(id: string): Promise<void> {
    const { error } = await this.getSupabase().from("tasks").delete().eq("id", id);
    if (error) throw error;
  }

  async saveTasks(tasks: Task[]): Promise<void> {
    try {
      // Try with execution_order
      const rows = tasks.map((task) => this.mapTaskToRow(task, true));
      const { error } = await this.getSupabase().from("tasks").upsert(rows);
      if (error) throw error;
    } catch (error: any) {
      if (error.message?.includes("execution_order") || error.code === "42703") {
        console.warn(
          "(AgentFlow) execution_order column missing in saveTasks, retrying without it"
        );
        const rows = tasks.map((task) => this.mapTaskToRow(task, false));
        const { error: retryError } = await this.getSupabase().from("tasks").upsert(rows);
        if (retryError) throw retryError;
        return;
      }
      throw error;
    }
  }

  private mapTaskToRow(task: Task, includeOrder: boolean): any {
    const createdAt =
      task.createdAt instanceof Date
        ? task.createdAt.toISOString()
        : new Date(task.createdAt).toISOString();
    const updatedAt =
      task.updatedAt instanceof Date
        ? task.updatedAt.toISOString()
        : new Date(task.updatedAt).toISOString();
    const completedAt = task.completedAt
      ? task.completedAt instanceof Date
        ? task.completedAt.toISOString()
        : new Date(task.completedAt).toISOString()
      : null;

    const row: any = {
      id: task.id,
      name: task.name,
      status: task.status,
      created_at: createdAt,
      updated_at: updatedAt,
      completed_at: completedAt,
      client_id: (task as any).clientId ?? null,
      project_id: (task as any).projectId ?? null,
      content: task,
      // Group 1.3 OCC column — see saveTask for rationale.
      version: (task as Task & { version?: number }).version ?? 1,
      // Wave 1 §10.C — lock columns.
      claimed_by: task.claimedBy ?? null,
      claimed_at: task.claimedAt
        ? task.claimedAt instanceof Date
          ? task.claimedAt.toISOString()
          : new Date(task.claimedAt).toISOString()
        : null,
      claim_expires_at: task.claimExpiresAt
        ? task.claimExpiresAt instanceof Date
          ? task.claimExpiresAt.toISOString()
          : new Date(task.claimExpiresAt).toISOString()
        : null,
      // Wave 1 §10.D — group/hierarchy columns.
      group_id: task.groupId ?? null,
      parent_task_id: task.parentTaskId ?? null,
    };
    if (includeOrder) {
      row.execution_order = task.executionOrder || 0;
    }
    return row;
  }

  // --- Project Operations ---

  async createProject(project: Project): Promise<void> {
    const { error } = await this.getSupabase()
      .from("projects")
      .upsert({
        id: project.id,
        name: project.name,
        description: project.description,
        path: project.path,
        git_remote_url: project.gitRemoteUrl,
        tech_stack: project.techStack, // JSONB array support
        created_at:
          project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
        updated_at:
          project.updatedAt instanceof Date ? project.updatedAt.toISOString() : project.updatedAt,
      });

    if (error) throw error;
  }

  async getProject(id: string): Promise<Project | null> {
    const { data, error } = await this.getSupabase()
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    const { count: taskCount, error: countError } = await this.getSupabase()
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id);

    if (countError) throw countError;

    return this.mapProjectRow(data, taskCount || 0);
  }

  async getAllProjects(): Promise<Project[]> {
    const { data, error } = await this.getSupabase()
      .from("projects")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) return [];

    const { data: taskRows, error: taskError } = await this.getSupabase()
      .from("tasks")
      .select("project_id")
      .not("project_id", "is", null);

    if (taskError) throw taskError;

    const taskCountByProjectId = new Map<string, number>();
    for (const row of taskRows || []) {
      const projectId = row.project_id as string | null;
      if (!projectId) continue;
      taskCountByProjectId.set(projectId, (taskCountByProjectId.get(projectId) || 0) + 1);
    }

    return data.map((row) => this.mapProjectRow(row, taskCountByProjectId.get(row.id) || 0));
  }

  async deleteProject(id: string): Promise<void> {
    const { error } = await this.getSupabase().from("projects").delete().eq("id", id);
    if (error) throw error;
  }

  private mapProjectRow(row: any, taskCount: number = 0): Project {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      path: row.path,
      gitRemoteUrl: row.git_remote_url,
      techStack: row.tech_stack || [],
      taskCount,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  // --- Workflow Step Operations ---

  async createWorkflowStep(step: WorkflowStep): Promise<void> {
    const { error } = await this.getSupabase()
      .from("workflow_steps")
      .insert({
        id: step.id,
        project_id: step.projectId,
        task_id: step.taskId,
        step_type: step.stepType,
        content: step.content,
        previous_step_id: step.previousStepId,
        created_at: step.createdAt instanceof Date ? step.createdAt.toISOString() : step.createdAt,
        tool_name: step.toolName ?? null,
        duration_ms: step.durationMs ?? null,
        input_tokens: step.inputTokens ?? null,
        output_tokens: step.outputTokens ?? null,
        outcome: step.outcome ?? null,
        error_code: step.errorCode ?? null,
        correlation_id: step.correlationId ?? null,
      });

    if (error) throw error;
  }

  async getWorkflowStep(id: string): Promise<WorkflowStep | null> {
    const { data, error } = await this.getSupabase()
      .from("workflow_steps")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    return this.mapWorkflowStepRow(data);
  }

  async getWorkflowSteps(projectId: string): Promise<WorkflowStep[]> {
    const { data, error } = await this.getSupabase()
      .from("workflow_steps")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return (data || []).map((row: any) => this.mapWorkflowStepRow(row));
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
    const { error, count } = await this.getSupabase()
      .from("workflow_steps")
      .delete({ count: "exact" })
      .eq("project_id", projectId);

    if (error) throw error;
    return count || 0;
  }

  // --- Client Operations ---

  async registerClient(client: Client): Promise<void> {
    const { error } = await this.getSupabase()
      .from("clients")
      .upsert({
        id: client.id,
        name: client.name,
        type: client.type,
        workspace: client.workspace,
        connected_at:
          client.connectedAt instanceof Date
            ? client.connectedAt.toISOString()
            : client.connectedAt,
        last_activity_at:
          client.lastActivityAt instanceof Date
            ? client.lastActivityAt.toISOString()
            : client.lastActivityAt,
        is_active: client.isActive,
      });

    if (error) throw error;
  }

  async getAllClients(activeOnly: boolean = true): Promise<Client[]> {
    let query = this.getSupabase().from("clients").select("*");
    if (activeOnly) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query.order("last_activity_at", { ascending: false });

    if (error) throw error;

    return data.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type,
      workspace: row.workspace,
      connectedAt: new Date(row.connected_at),
      lastActivityAt: new Date(row.last_activity_at),
      isActive: row.is_active,
    }));
  }

  async getClient(id: string): Promise<Client | null> {
    const { data, error } = await this.getSupabase()
      .from("clients")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return null;
      throw error;
    }

    return {
      id: data.id,
      name: data.name,
      type: data.type,
      workspace: data.workspace,
      connectedAt: new Date(data.connected_at),
      lastActivityAt: new Date(data.last_activity_at),
      isActive: data.is_active,
    };
  }

  async deleteClient(id: string): Promise<void> {
    const { error } = await this.getSupabase().from("clients").delete().eq("id", id);
    if (error) throw error;
  }

  async deleteInactiveClients(): Promise<number> {
    const { error, count } = await this.getSupabase()
      .from("clients")
      .delete({ count: "exact" })
      .eq("is_active", false);

    if (error) throw error;
    return count || 0;
  }

  async updateClientHeartbeat(id: string): Promise<void> {
    const { error } = await this.getSupabase()
      .from("clients")
      .update({
        last_activity_at: new Date().toISOString(),
        is_active: true,
      })
      .eq("id", id);

    if (error) throw error;
  }

  async cleanupStaleClients(timeoutMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - timeoutMs).toISOString();

    const { error, data } = await this.getSupabase()
      .from("clients")
      .update({ is_active: false })
      .eq("is_active", true)
      .lt("last_activity_at", cutoff)
      .select("id");

    const count = data?.length || 0;

    if (error) throw error;
    return count;
  }

  async markAllClientsInactive(): Promise<void> {
    // Supabase requires a WHERE clause for UPDATE - target all active clients
    const { error } = await this.getSupabase()
      .from("clients")
      .update({ is_active: false })
      .eq("is_active", true);

    if (error) throw error;
  }

  // --- Transactions (Group 3.2) ---

  /**
   * Best-effort transaction wrapper. The Supabase REST API does not
   * expose a client-driven transaction handle, so we just execute `fn`.
   * Cross-row atomicity for multi-task writes falls back to the
   * per-row CAS in `incrementTaskVersion`.
   *
   * If true atomicity becomes load-bearing, a Postgres RPC function
   * wrapping the batch is the upgrade path.
   */
  async runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  // --- Task version (optimistic concurrency) ---
  // Postgres has no built-in CAS for arbitrary rows, but the conditional
  // UPDATE-with-RETURNING pattern is atomic at the row level: only the
  // row whose current version equals `expectedVersion` is mutated.

  async incrementTaskVersion(
    taskId: string,
    expectedVersion: number
  ): Promise<IncrementTaskVersionResult> {
    const { data, error } = await this.getSupabase()
      .from("tasks")
      .update({ version: expectedVersion + 1 })
      .eq("id", taskId)
      .eq("version", expectedVersion)
      .select("version");

    if (error) throw error;

    if (data && data.length === 1) {
      return { ok: true, newVersion: expectedVersion + 1 };
    }

    const { data: currentRow, error: readError } = await this.getSupabase()
      .from("tasks")
      .select("version")
      .eq("id", taskId)
      .maybeSingle();

    if (readError) throw readError;

    return { ok: false, currentVersion: (currentRow?.version as number | undefined) ?? null };
  }

  // --- Multi-agent lock (Wave 1 §10.C) ---
  // Postgres has no straightforward client-side equivalent of SQLite's
  // single-statement conditional UPDATE; the SDK does not let us bump a
  // numeric column in-place. We use a read → conditional-update sequence
  // and rely on the `version` OCC column as the race guard. If another
  // claimant slipped in between read and write, the version mismatch
  // makes our UPDATE affect zero rows and we surface the contention.

  async claimTask(taskId: string, clientId: string, ttlMs: number): Promise<ClaimTaskResult> {
    const sb = this.getSupabase();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    const { data: cur, error: readErr } = await sb
      .from("tasks")
      .select("version, claimed_by, claimed_at, claim_expires_at")
      .eq("id", taskId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!cur) {
      return {
        ok: false,
        heldBy: "(unknown)",
        claimedAt: new Date(0),
        claimExpiresAt: new Date(0),
      };
    }

    const heldByOther =
      cur.claimed_by &&
      cur.claimed_by !== clientId &&
      cur.claim_expires_at &&
      new Date(cur.claim_expires_at).getTime() > now;
    if (heldByOther) {
      return {
        ok: false,
        heldBy: cur.claimed_by as string,
        claimedAt: cur.claimed_at ? new Date(cur.claimed_at) : new Date(0),
        claimExpiresAt: cur.claim_expires_at ? new Date(cur.claim_expires_at) : new Date(0),
      };
    }

    const newVersion = (cur.version ?? 1) + 1;
    const { data, error } = await sb
      .from("tasks")
      .update({
        claimed_by: clientId,
        claimed_at: new Date(now).toISOString(),
        claim_expires_at: new Date(expiresAt).toISOString(),
        version: newVersion,
      })
      .eq("id", taskId)
      .eq("version", cur.version)
      .select("version");
    if (error) throw error;

    if (data && data.length === 1) {
      return {
        ok: true,
        newVersion,
        claimedAt: new Date(now),
        claimExpiresAt: new Date(expiresAt),
      };
    }

    // Lost the race against another claimant — re-read and surface holder.
    const { data: lost } = await sb
      .from("tasks")
      .select("claimed_by, claimed_at, claim_expires_at")
      .eq("id", taskId)
      .maybeSingle();
    return {
      ok: false,
      heldBy: (lost?.claimed_by as string | null | undefined) ?? "(unknown)",
      claimedAt: lost?.claimed_at ? new Date(lost.claimed_at) : new Date(0),
      claimExpiresAt: lost?.claim_expires_at ? new Date(lost.claim_expires_at) : new Date(0),
    };
  }

  async extendTaskClaim(
    taskId: string,
    clientId: string,
    ttlMs: number
  ): Promise<ExtendClaimResult> {
    const sb = this.getSupabase();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    const { data: cur, error: readErr } = await sb
      .from("tasks")
      .select("version, claimed_by, claim_expires_at")
      .eq("id", taskId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (
      !cur ||
      cur.claimed_by !== clientId ||
      !cur.claim_expires_at ||
      new Date(cur.claim_expires_at).getTime() < now
    ) {
      return { ok: false };
    }

    const newVersion = (cur.version ?? 1) + 1;
    const { data, error } = await sb
      .from("tasks")
      .update({
        claim_expires_at: new Date(expiresAt).toISOString(),
        version: newVersion,
      })
      .eq("id", taskId)
      .eq("version", cur.version)
      .select("version");
    if (error) throw error;
    if (data && data.length === 1) {
      return { ok: true, newVersion, claimExpiresAt: new Date(expiresAt) };
    }
    return { ok: false };
  }

  async clearTaskClaim(taskId: string): Promise<void> {
    const { error } = await this.getSupabase()
      .from("tasks")
      .update({ claimed_by: null, claimed_at: null, claim_expires_at: null })
      .eq("id", taskId);
    if (error) throw error;
  }

  // --- Task groups (Wave 1 §10.D) ---

  private mapGroupRow(row: any): TaskGroup {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      description: row.description ?? undefined,
      status: (row.status ?? "active") as "active" | "completed" | "archived",
      createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      updatedAt: row.updated_at ? new Date(row.updated_at) : new Date(),
    };
  }

  async createGroup(input: TaskGroupInput): Promise<TaskGroup> {
    const id = input.id ?? randomUUID();
    const status = input.status ?? "active";
    const nowIso = new Date().toISOString();
    const { error } = await this.getSupabase()
      .from("task_groups")
      .insert({
        id,
        project_id: input.projectId,
        name: input.name,
        description: input.description ?? null,
        status,
        created_at: nowIso,
        updated_at: nowIso,
      });
    if (error) throw error;
    return {
      id,
      projectId: input.projectId,
      name: input.name,
      description: input.description,
      status,
      createdAt: new Date(nowIso),
      updatedAt: new Date(nowIso),
    };
  }

  async getGroup(id: string): Promise<TaskGroup | null> {
    const { data, error } = await this.getSupabase()
      .from("task_groups")
      .select("id, project_id, name, description, status, created_at, updated_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return this.mapGroupRow(data);
  }

  async listGroups(projectId: string): Promise<TaskGroup[]> {
    const { data, error } = await this.getSupabase()
      .from("task_groups")
      .select("id, project_id, name, description, status, created_at, updated_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r) => this.mapGroupRow(r));
  }

  async updateGroup(
    id: string,
    patch: Partial<Pick<TaskGroup, "name" | "description" | "status">>
  ): Promise<TaskGroup | null> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.status !== undefined) updates.status = patch.status;
    const { error } = await this.getSupabase().from("task_groups").update(updates).eq("id", id);
    if (error) throw error;
    return this.getGroup(id);
  }

  async deleteGroup(id: string): Promise<void> {
    // Supabase FK ON DELETE SET NULL handles dependent tasks; the
    // statement here is the actual delete.
    const { error } = await this.getSupabase().from("task_groups").delete().eq("id", id);
    if (error) throw error;
  }

  async getGroupCounts(
    projectId: string
  ): Promise<Array<{ groupId: string | null; status: string; count: number }>> {
    // No SQL GROUP BY in the JS client; pull rows and aggregate in JS.
    // Scoped to a single project so the cost is bounded.
    const { data, error } = await this.getSupabase()
      .from("tasks")
      .select("group_id, status")
      .eq("project_id", projectId);
    if (error) throw error;
    const counts = new Map<string, { groupId: string | null; status: string; count: number }>();
    for (const r of data ?? []) {
      const groupId = (r as { group_id?: string | null }).group_id ?? null;
      const status = (r as { status: string }).status;
      const key = `${groupId ?? ""}|${status}`;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { groupId, status, count: 1 });
    }
    return Array.from(counts.values());
  }

  // --- Findings (Group 1.1 / 1.7 / 1.8) ---

  private async resolveProjectIdForTask(taskId: string): Promise<string | null> {
    const { data, error } = await this.getSupabase()
      .from("tasks")
      .select("project_id")
      .eq("id", taskId)
      .maybeSingle();

    if (error) throw error;
    return (data?.project_id as string | null | undefined) ?? null;
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

    const row = {
      id,
      project_id: projectId,
      task_id: input.taskId,
      kind: input.kind,
      type: input.type ?? null,
      content: input.content ?? null,
      metadata: input.metadata ?? null,
      created_at: createdAt.toISOString(),
      created_by: input.createdBy ?? null,
    };

    const { error } = await this.getSupabase().from("task_findings").insert(row);
    if (error) throw error;

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
    let query = this.getSupabase().from("task_findings").select("*");
    if (filter.taskId) query = query.eq("task_id", filter.taskId);
    if (filter.projectId) query = query.eq("project_id", filter.projectId);
    if (filter.kind) query = query.eq("kind", filter.kind);
    if (filter.type) query = query.eq("type", filter.type);
    if (filter.sinceMs) query = query.gte("created_at", new Date(filter.sinceMs).toISOString());

    query = query.order("created_at", { ascending: false });
    if (filter.limit && filter.limit > 0) query = query.limit(Math.floor(filter.limit));

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((row: any) => this.mapFindingRow(row));
  }

  async deleteFindingsOlderThan(cutoffMs: number): Promise<number> {
    const { error, count } = await this.getSupabase()
      .from("task_findings")
      .delete({ count: "exact" })
      .lt("created_at", new Date(cutoffMs).toISOString());

    if (error) throw error;
    return count || 0;
  }

  private mapFindingRow(row: any): TaskFinding {
    return {
      id: row.id,
      projectId: row.project_id,
      taskId: row.task_id,
      kind: row.kind,
      type: row.type ?? undefined,
      content: row.content,
      metadata: row.metadata ?? undefined,
      createdAt: new Date(row.created_at),
      createdBy: row.created_by ?? undefined,
    };
  }

  // --- Lesson summaries (Group 1.2) ---

  async createLessonSummary(input: LessonSummaryInput): Promise<LessonSummary> {
    const id = input.id ?? randomUUID();
    const now = new Date();

    const row = {
      id,
      project_id: input.projectId,
      topic: input.topic,
      summary: input.summary,
      source_finding_ids: input.sourceFindingIds ?? null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    const { error } = await this.getSupabase().from("lesson_summaries").insert(row);
    if (error) throw error;

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
    let query = this.getSupabase()
      .from("lesson_summaries")
      .select("*")
      .eq("project_id", filter.projectId);
    if (filter.topic) query = query.eq("topic", filter.topic);
    query = query.order("updated_at", { ascending: false });
    if (filter.limit && filter.limit > 0) query = query.limit(Math.floor(filter.limit));

    const { data, error } = await query;
    if (error) throw error;

    return (data || []).map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      topic: row.topic,
      summary: row.summary,
      sourceFindingIds: row.source_finding_ids ?? undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  // --- Per-client active project (Group 1.4) ---

  async getActiveProjectForClient(clientId: string): Promise<ClientActiveProject | null> {
    const { data, error } = await this.getSupabase()
      .from("client_active_project")
      .select("*")
      .eq("client_id", clientId)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return {
      clientId: data.client_id,
      projectId: data.project_id,
      setAt: new Date(data.set_at),
    };
  }

  async setActiveProjectForClient(
    clientId: string,
    projectId: string
  ): Promise<ClientActiveProject> {
    const setAt = new Date();
    const { error } = await this.getSupabase().from("client_active_project").upsert({
      client_id: clientId,
      project_id: projectId,
      set_at: setAt.toISOString(),
    });
    if (error) throw error;
    return { clientId, projectId, setAt };
  }

  // --- LLM settings (Group 1.5) ---

  async getLlmSettings(): Promise<LlmSettings | null> {
    const { data, error } = await this.getSupabase()
      .from("llm_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return {
      provider: data.provider ?? undefined,
      model: data.model ?? undefined,
      selectionStrategy: data.selection_strategy ?? undefined,
      workflowMode: data.workflow_mode ?? undefined,
      updatedAt: new Date(data.updated_at),
    };
  }

  async setLlmSettings(input: LlmSettingsInput): Promise<LlmSettings> {
    const updatedAt = new Date();
    const { error } = await this.getSupabase()
      .from("llm_settings")
      .upsert({
        id: 1,
        provider: input.provider ?? null,
        model: input.model ?? null,
        selection_strategy: input.selectionStrategy ?? null,
        workflow_mode: input.workflowMode ?? null,
        updated_at: updatedAt.toISOString(),
      });
    if (error) throw error;
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
    const { error } = await this.getSupabase()
      .from("destructive_audits")
      .insert({
        id: row.id,
        tool: row.tool,
        project_id: row.projectId,
        reason: row.reason,
        affected_ids: row.affectedIds, // jsonb
        invoked_by: row.invokedBy,
        metadata: row.metadata ?? null, // jsonb
        correlation_id: row.correlationId ?? null,
        created_at: row.createdAt.toISOString(),
      });
    if (error) throw error;
  }

  async listDestructiveAudits(filter?: DestructiveAuditFilter): Promise<DestructiveAuditRow[]> {
    let query = this.getSupabase().from("destructive_audits").select("*");
    if (filter?.projectId) query = query.eq("project_id", filter.projectId);
    if (filter?.tool) query = query.eq("tool", filter.tool);
    query = query.order("created_at", { ascending: false });
    if (filter?.limit && filter.limit > 0) query = query.limit(Math.floor(filter.limit));
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map((r: any) => ({
      id: r.id,
      tool: r.tool,
      projectId: r.project_id,
      reason: r.reason,
      affectedIds: r.affected_ids,
      invokedBy: r.invoked_by,
      metadata: r.metadata ?? undefined,
      correlationId: r.correlation_id ?? undefined,
      createdAt: new Date(r.created_at),
    }));
  }
}
