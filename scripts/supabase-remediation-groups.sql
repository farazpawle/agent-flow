-- Wave 1 §10.D — Task groups + task hierarchy.
-- Idempotent migration for existing Supabase deployments. Apply by running
-- this file in the Supabase SQL editor.
--
-- Adds the `task_groups` table, the `tasks.group_id` and
-- `tasks.parent_task_id` foreign keys, and the supporting indexes.
-- All statements are guarded with `if not exists` so the script is
-- safe to re-run. The canonical schema (`scripts/supabase-schema.sql`)
-- already includes these definitions for fresh deployments.

create table if not exists task_groups (
    id text primary key,
    project_id text not null references projects(id) on delete cascade,
    name text not null,
    description text,
    status text not null default 'active',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_task_groups_project on task_groups(project_id);

alter table tasks
    add column if not exists group_id text references task_groups(id) on delete set null;

alter table tasks
    add column if not exists parent_task_id text references tasks(id) on delete set null;

create index if not exists idx_tasks_project_group on tasks(project_id, group_id);
create index if not exists idx_tasks_parent on tasks(parent_task_id);

-- Sanity check:
-- select column_name from information_schema.columns
--     where table_name = 'tasks' and column_name in ('group_id','parent_task_id');
-- select to_regclass('public.task_groups') as task_groups_exists;
