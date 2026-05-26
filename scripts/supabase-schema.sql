-- AgentFlow Supabase Schema
-- Run this in your Supabase SQL Editor to initialize the database.

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Projects Table
create table if not exists projects (
    id text primary key,
    name text not null,
    description text,
    path text,
    git_remote_url text unique,
    tech_stack jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    deleted_at timestamptz
);

-- Tasks Table
create table if not exists tasks (
    id text primary key,
    name text not null,
    status text not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    completed_at timestamptz,
    client_id text,
    project_id text references projects(id) on delete cascade,
    execution_order integer default 0,
    content jsonb not null,
    deleted_at timestamptz
);

-- Workflow Steps Table
create table if not exists workflow_steps (
    id text primary key,
    project_id text not null references projects(id) on delete cascade,
    task_id text,
    step_type text not null,
    content text not null,
    previous_step_id text,
    created_at timestamptz not null default now()
);

-- Clients Table
create table if not exists clients (
    id text primary key,
    name text not null,
    type text not null,
    workspace text,
    connected_at timestamptz not null default now(),
    last_activity_at timestamptz not null default now(),
    is_active boolean default true
);

-- Indexes for performance
create index if not exists idx_tasks_project_id on tasks(project_id);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_tasks_execution_order on tasks(execution_order);
create index if not exists idx_tasks_deleted_at on tasks(deleted_at) where deleted_at is null;
create index if not exists idx_projects_deleted_at on projects(deleted_at) where deleted_at is null;
create index if not exists idx_workflow_project_id on workflow_steps(project_id);
create index if not exists idx_clients_is_active on clients(is_active);

-- Enable Realtime for the tasks table
-- Note: You may need to enable this in the Supabase UI under Database -> Replication -> public -> tasks
-- alter publication supabase_realtime add table tasks;

-- Row Level Security (RLS)
-- AgentFlow uses the Service Role Key on the server side, which bypasses RLS.
-- We enable RLS without permissive policies so that anon / authenticated
-- keys cannot read or mutate these tables directly (defense in depth).
-- When multi-user is introduced (see roadmap Tier 3.1), add project-scoped
-- policies keyed off project_members membership.
alter table projects enable row level security;
alter table tasks enable row level security;
alter table workflow_steps enable row level security;
alter table clients enable row level security;

-- Drop legacy permissive policies that may have been created by older
-- schema versions. Safe to run on a fresh DB (no-op if absent).
drop policy if exists "Allow all access for projects" on projects;
drop policy if exists "Allow all access for tasks" on tasks;
drop policy if exists "Allow all access for workflow_steps" on workflow_steps;
drop policy if exists "Allow all access for clients" on clients;

-- Service-role policies: explicit allow only for the service_role JWT.
-- Server-side code using the Service Role Key bypasses RLS entirely, so
-- these policies exist primarily for clarity; they grant nothing to
-- anon or authenticated callers.
create policy "service_role full access to projects"
    on projects for all to service_role using (true) with check (true);
create policy "service_role full access to tasks"
    on tasks for all to service_role using (true) with check (true);
create policy "service_role full access to workflow_steps"
    on workflow_steps for all to service_role using (true) with check (true);
create policy "service_role full access to clients"
    on clients for all to service_role using (true) with check (true);

-- ============================================================
-- Telemetry: workflow step trace
-- ============================================================

-- Extend workflow_steps with per-tool telemetry (idempotent).
alter table workflow_steps add column if not exists tool_name text;
alter table workflow_steps add column if not exists duration_ms integer;
alter table workflow_steps add column if not exists input_tokens integer;
alter table workflow_steps add column if not exists output_tokens integer;
alter table workflow_steps add column if not exists outcome text;
alter table workflow_steps add column if not exists error_code text;
alter table workflow_steps add column if not exists correlation_id text;

create index if not exists idx_workflow_steps_correlation
    on workflow_steps(correlation_id) where correlation_id is not null;

-- ============================================================
-- Phase 1 (Group 1) — schema reshape for v2 tool surface
-- ============================================================

-- 1.3 — optimistic concurrency column on tasks. Postgres backfills
-- existing rows in metadata-only fashion thanks to the constant default.
alter table tasks add column if not exists version integer not null default 1;

-- 1.1 — append-only task_findings (artifacts/evidence/findings).
create table if not exists task_findings (
    id text primary key,
    project_id text not null references projects(id) on delete cascade,
    task_id text not null references tasks(id) on delete cascade,
    kind text not null,
    type text,
    content jsonb not null,
    metadata jsonb,
    created_at timestamptz not null default now(),
    created_by text
);
create index if not exists idx_findings_task_created
    on task_findings(task_id, created_at desc);
create index if not exists idx_findings_project_created
    on task_findings(project_id, created_at desc);
create index if not exists idx_findings_task_kind
    on task_findings(task_id, kind);
create index if not exists idx_findings_project_kind_type
    on task_findings(project_id, kind, type);

-- 1.2 — lesson_summaries (project-level lesson roll-ups).
create table if not exists lesson_summaries (
    id text primary key,
    project_id text not null references projects(id) on delete cascade,
    topic text not null,
    summary text not null,
    source_finding_ids jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_lesson_summaries_project_topic
    on lesson_summaries(project_id, topic);

-- 1.4 — per-client active project pointer.
create table if not exists client_active_project (
    client_id text primary key references clients(id) on delete cascade,
    project_id text not null references projects(id) on delete cascade,
    set_at timestamptz not null default now()
);

-- 1.5 — single-row LLM settings overlay (no API keys here — env-only).
create table if not exists llm_settings (
    id integer primary key check (id = 1),
    provider text,
    model text,
    selection_strategy text,
    workflow_mode text,
    updated_at timestamptz not null default now()
);

-- RLS posture for the new tables matches existing tables: deny-all to anon
-- and authenticated, service_role unrestricted (server uses service-role key).
alter table task_findings        enable row level security;
alter table lesson_summaries     enable row level security;
alter table client_active_project enable row level security;
alter table llm_settings         enable row level security;

create policy "service_role full access to task_findings"
    on task_findings for all to service_role using (true) with check (true);
create policy "service_role full access to lesson_summaries"
    on lesson_summaries for all to service_role using (true) with check (true);
create policy "service_role full access to client_active_project"
    on client_active_project for all to service_role using (true) with check (true);
create policy "service_role full access to llm_settings"
    on llm_settings for all to service_role using (true) with check (true);

-- ============================================================
-- Phase 1 Group 6.3 — destructive audit log
-- Append-only. NOT foreign-keyed so rows outlive the projects/tasks they
-- describe (auditability survives cascading deletes).
-- ============================================================

create table if not exists destructive_audits (
    id text primary key,
    tool text not null,
    project_id text not null,
    reason text not null,
    affected_ids jsonb not null,
    invoked_by text not null,
    metadata jsonb,
    correlation_id text,
    created_at timestamptz not null default now()
);
create index if not exists idx_destructive_audits_project_created
    on destructive_audits(project_id, created_at desc);
create index if not exists idx_destructive_audits_tool
    on destructive_audits(tool, created_at desc);

alter table destructive_audits enable row level security;
create policy "service_role full access to destructive_audits"
    on destructive_audits for all to service_role using (true) with check (true);
