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
    project_id text references projects(id) on delete cascade,
    execution_order integer default 0,
    content jsonb not null
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
create index if not exists idx_workflow_project_id on workflow_steps(project_id);
create index if not exists idx_clients_is_active on clients(is_active);

-- Enable Realtime for the tasks table
-- Note: You may need to enable this in the Supabase UI under Database -> Replication -> public -> tasks
-- alter publication supabase_realtime add table tasks;

-- Row Level Security (RLS)
-- If you use the Service Role Key (recommended for backends), RLS is bypassed.
-- The following policies are for safety if using the Anon/Authenticated keys.
alter table projects enable row level security;
alter table tasks enable row level security;
alter table workflow_steps enable row level security;
alter table clients enable row level security;

-- Simple "Allow All" policies for development. 
-- WARNING: In production, you should tighten these policies!
create policy "Allow all access for projects" on projects for all using (true);
create policy "Allow all access for tasks" on tasks for all using (true);
create policy "Allow all access for workflow_steps" on workflow_steps for all using (true);
create policy "Allow all access for clients" on clients for all using (true);
