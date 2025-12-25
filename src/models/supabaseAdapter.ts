import { createClient, SupabaseClient, RealtimeChannel } from '@supabase/supabase-js';
import { DatabaseAdapter } from './interfaces.js';
import { Task } from '../types/index.js';
import { Project } from './projectModel.js';
import { Client } from './clientModel.js';
import { WorkflowStep, WorkflowStepType } from './workflowModel.js';
import { taskEvents, TASK_EVENTS } from '../utils/events.js';

export class SupabaseAdapter implements DatabaseAdapter {
    private supabase: SupabaseClient | null = null;
    private initialized: boolean = false;
    private tasksChannel: RealtimeChannel | null = null;

    async init(): Promise<void> {
        if (this.initialized) return;

        console.error('(AgentFlow) Initializing Supabase connection...');

        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

        if (!supabaseUrl || !supabaseKey) {
            throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY environment variables');
        }

        try {
            this.supabase = createClient(supabaseUrl, supabaseKey, {
                auth: { persistSession: false }
            });

            // Verify connection by making a lightweight call
            const { error } = await this.supabase.from('projects').select('id').limit(1);

            if (error) {
                // If table doesn't exist, it might be a 404 or specific error.
                // Since we can't easily auto-create tables in Supabase from here (requires admin API or SQL editor),
                // we assume the user has run the schema script.
                console.error('(AgentFlow) Supabase connection check failed:', error.message);
                throw error;
            }

            // --- Realtime Subscription Setup ---
            // Subscribe to all changes in 'tasks' table
            this.tasksChannel = this.supabase
                .channel('room_tasks')
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'tasks' },
                    (payload) => {
                        console.error('(AgentFlow) Realtime update received:', payload.eventType);
                        // Emit event so the server can push SSE to clients
                        taskEvents.emit(TASK_EVENTS.UPDATED);
                    }
                )
                .subscribe((status) => {
                    console.error(`(AgentFlow) Realtime subscription status: ${status}`);
                });

            this.initialized = true;
            console.error('(AgentFlow) Supabase connection established successfully');
        } catch (error) {
            console.error('(AgentFlow) Failed to initialize Supabase client:', error);
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
        if (!this.supabase) throw new Error('Supabase client not initialized');
        return this.supabase;
    }

    // --- Task Operations ---

    async getAllTasks(projectId?: string): Promise<Task[]> {
        let query = this.getSupabase().from('tasks').select('content, execution_order');

        if (projectId) {
            query = query.eq('project_id', projectId);
        }

        try {
            const { data, error } = await query.order('execution_order', { ascending: true }).order('created_at', { ascending: true });
            if (error) throw error;
            return data.map((row: any) => ({
                ...row.content,
                executionOrder: row.execution_order ?? row.content.executionOrder
            }));
        } catch (error: any) {
            // Fallback if execution_order column is missing
            if (error.message?.includes('execution_order') || error.code === '42703') { // 42703 is undefined_column
                console.warn('(AgentFlow) execution_order column missing, falling back to created_at sort');
                const { data, error: retryError } = await this.getSupabase().from('tasks').select('content').order('created_at', { ascending: true });
                if (retryError) throw retryError;
                return data.map((row: any) => row.content);
            }
            throw error;
        }
    }

    async getTask(id: string): Promise<Task | null> {
        const { data, error } = await this.getSupabase()
            .from('tasks')
            .select('content, execution_order')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null; // Not found code
            throw error;
        }

        return data ? { ...data.content, executionOrder: data.execution_order ?? data.content.executionOrder } : null;
    }

    async saveTask(task: Task): Promise<void> {
        const createdAt = task.createdAt instanceof Date ? task.createdAt.toISOString() : new Date(task.createdAt).toISOString();
        const updatedAt = task.updatedAt instanceof Date ? task.updatedAt.toISOString() : new Date(task.updatedAt).toISOString();
        const completedAt = task.completedAt
            ? (task.completedAt instanceof Date ? task.completedAt.toISOString() : new Date(task.completedAt).toISOString())
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
            execution_order: (task.executionOrder || 0)
        };

        try {
            const { error } = await this.getSupabase().from('tasks').upsert(taskData);
            if (error) throw error;
        } catch (error: any) {
            if (error.message?.includes('execution_order') || error.code === '42703') {
                console.warn('(AgentFlow) execution_order column missing in saveTask, retrying without it');
                const { execution_order, ...fallbackData } = taskData;
                const { error: retryError } = await this.getSupabase().from('tasks').upsert(fallbackData);
                if (retryError) throw retryError;
                return;
            }
            throw error;
        }
    }

    async deleteTask(id: string): Promise<void> {
        const { error } = await this.getSupabase().from('tasks').delete().eq('id', id);
        if (error) throw error;
    }

    async saveTasks(tasks: Task[]): Promise<void> {
        try {
            // Try with execution_order
            const rows = tasks.map(task => this.mapTaskToRow(task, true));
            const { error } = await this.getSupabase().from('tasks').upsert(rows);
            if (error) throw error;
        } catch (error: any) {
            if (error.message?.includes('execution_order') || error.code === '42703') {
                console.warn('(AgentFlow) execution_order column missing in saveTasks, retrying without it');
                const rows = tasks.map(task => this.mapTaskToRow(task, false));
                const { error: retryError } = await this.getSupabase().from('tasks').upsert(rows);
                if (retryError) throw retryError;
                return;
            }
            throw error;
        }
    }

    private mapTaskToRow(task: Task, includeOrder: boolean): any {
        const createdAt = task.createdAt instanceof Date ? task.createdAt.toISOString() : new Date(task.createdAt).toISOString();
        const updatedAt = task.updatedAt instanceof Date ? task.updatedAt.toISOString() : new Date(task.updatedAt).toISOString();
        const completedAt = task.completedAt
            ? (task.completedAt instanceof Date ? task.completedAt.toISOString() : new Date(task.completedAt).toISOString())
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
            content: task
        };
        if (includeOrder) {
            row.execution_order = (task.executionOrder || 0);
        }
        return row;
    }


    // --- Project Operations ---

    async createProject(project: Project): Promise<void> {
        const { error } = await this.getSupabase().from('projects').upsert({
            id: project.id,
            name: project.name,
            description: project.description,
            path: project.path,
            git_remote_url: project.gitRemoteUrl,
            tech_stack: project.techStack, // JSONB array support
            created_at: project.createdAt instanceof Date ? project.createdAt.toISOString() : project.createdAt,
            updated_at: project.updatedAt instanceof Date ? project.updatedAt.toISOString() : project.updatedAt
        });

        if (error) throw error;
    }

    async getProject(id: string): Promise<Project | null> {
        const { data, error } = await this.getSupabase()
            .from('projects')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw error;
        }

        return this.mapProjectRow(data);
    }

    async getAllProjects(): Promise<Project[]> {
        const { data, error } = await this.getSupabase()
            .from('projects')
            .select('*')
            .order('updated_at', { ascending: false });

        if (error) throw error;
        return data.map(row => this.mapProjectRow(row)) || [];
    }

    async deleteProject(id: string): Promise<void> {
        const { error } = await this.getSupabase().from('projects').delete().eq('id', id);
        if (error) throw error;
    }

    private mapProjectRow(row: any): Project {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            path: row.path,
            gitRemoteUrl: row.git_remote_url,
            techStack: row.tech_stack || [],
            taskCount: 0, // TODO: Implement count if needed
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at)
        };
    }

    // --- Workflow Step Operations ---

    async createWorkflowStep(step: WorkflowStep): Promise<void> {
        const { error } = await this.getSupabase().from('workflow_steps').insert({
            id: step.id,
            project_id: step.projectId,
            task_id: step.taskId,
            step_type: step.stepType,
            content: step.content,
            previous_step_id: step.previousStepId,
            created_at: step.createdAt instanceof Date ? step.createdAt.toISOString() : step.createdAt
        });

        if (error) throw error;
    }

    async getWorkflowStep(id: string): Promise<WorkflowStep | null> {
        const { data, error } = await this.getSupabase()
            .from('workflow_steps')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw error;
        }

        return {
            id: data.id,
            projectId: data.project_id,
            taskId: data.task_id,
            stepType: data.step_type as WorkflowStepType,
            content: data.content,
            previousStepId: data.previous_step_id,
            createdAt: new Date(data.created_at)
        };
    }

    async getWorkflowSteps(projectId: string): Promise<WorkflowStep[]> {
        const { data, error } = await this.getSupabase()
            .from('workflow_steps')
            .select('*')
            .eq('project_id', projectId)
            .order('created_at', { ascending: true });

        if (error) throw error;

        return data.map((row: any) => ({
            id: row.id,
            projectId: row.project_id,
            taskId: row.task_id,
            stepType: row.step_type as WorkflowStepType,
            content: row.content,
            previousStepId: row.previous_step_id,
            createdAt: new Date(row.created_at)
        }));
    }

    // --- Client Operations ---

    async registerClient(client: Client): Promise<void> {
        const { error } = await this.getSupabase().from('clients').upsert({
            id: client.id,
            name: client.name,
            type: client.type,
            workspace: client.workspace,
            connected_at: client.connectedAt instanceof Date ? client.connectedAt.toISOString() : client.connectedAt,
            last_activity_at: client.lastActivityAt instanceof Date ? client.lastActivityAt.toISOString() : client.lastActivityAt,
            is_active: client.isActive
        });

        if (error) throw error;
    }

    async getAllClients(activeOnly: boolean = true): Promise<Client[]> {
        let query = this.getSupabase().from('clients').select('*');
        if (activeOnly) {
            query = query.eq('is_active', true);
        }

        const { data, error } = await query.order('last_activity_at', { ascending: false });

        if (error) throw error;

        return data.map((row: any) => ({
            id: row.id,
            name: row.name,
            type: row.type,
            workspace: row.workspace,
            connectedAt: new Date(row.connected_at),
            lastActivityAt: new Date(row.last_activity_at),
            isActive: row.is_active
        }));
    }

    async getClient(id: string): Promise<Client | null> {
        const { data, error } = await this.getSupabase()
            .from('clients')
            .select('*')
            .eq('id', id)
            .single();

        if (error) {
            if (error.code === 'PGRST116') return null;
            throw error;
        }

        return {
            id: data.id,
            name: data.name,
            type: data.type,
            workspace: data.workspace,
            connectedAt: new Date(data.connected_at),
            lastActivityAt: new Date(data.last_activity_at),
            isActive: data.is_active
        };
    }

    async deleteClient(id: string): Promise<void> {
        const { error } = await this.getSupabase().from('clients').delete().eq('id', id);
        if (error) throw error;
    }

    async deleteInactiveClients(): Promise<number> {
        const { error, count } = await this.getSupabase()
            .from('clients')
            .delete({ count: 'exact' })
            .eq('is_active', false);

        if (error) throw error;
        return count || 0;
    }

    async updateClientHeartbeat(id: string): Promise<void> {
        const { error } = await this.getSupabase()
            .from('clients')
            .update({
                last_activity_at: new Date().toISOString(),
                is_active: true
            })
            .eq('id', id);

        if (error) throw error;
    }

    async cleanupStaleClients(timeoutMs: number): Promise<number> {
        const cutoff = new Date(Date.now() - timeoutMs).toISOString();

        const { error, data } = await this.getSupabase()
            .from('clients')
            .update({ is_active: false })
            .eq('is_active', true)
            .lt('last_activity_at', cutoff)
            .select('id');

        const count = data?.length || 0;

        if (error) throw error;
        return count;
    }

    async markAllClientsInactive(): Promise<void> {
        // Supabase requires a WHERE clause for UPDATE - target all active clients
        const { error } = await this.getSupabase()
            .from('clients')
            .update({ is_active: false })
            .eq('is_active', true);

        if (error) throw error;
    }
}
