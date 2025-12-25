-- Enable UUID extension if not enabled (Supabase usually has it)
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
    updated_at timestamptz not null default now()
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
    project_id text references projects(id),
    content jsonb not null
);

-- Workflow Steps Table
create table if not exists workflow_steps (
    id text primary key,
    project_id text not null references projects(id),
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

-- Indexes
create index if not exists idx_tasks_project_id on tasks(project_id);
create index if not exists idx_tasks_status on tasks(status);
create index if not exists idx_workflow_project_id on workflow_steps(project_id);
create index if not exists idx_clients_is_active on clients(is_active);

-- Row Level Security (RLS) - Optional but recommended
-- For now, enable RLS but allow public access if you want 'service_role' key to bypass, 
-- or specific policies if you use Authenticated users.
-- Defaults to disabled effectively if you use Service Role Key.
alter table projects enable row level security;
alter table tasks enable row level security;
alter table workflow_steps enable row level security;
alter table clients enable row level security;

-- Simple policies to allow full access if using Anon key (for local dev mode simplicity)
-- WARNING: In production, restrict this!
create policy "Allow all access" on projects for all using (true);
create policy "Allow all access" on tasks for all using (true);
create policy "Allow all access" on workflow_steps for all using (true);
create policy "Allow all access" on clients for all using (true);
