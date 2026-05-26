-- AgentFlow Supabase remediation — generated 2026-05-21
-- Run this once in the Supabase SQL Editor for project
-- sjekgzzlzreigkakgwkn to bring the live database in line with
-- scripts/supabase-schema.sql and remove dead RAG-feature tables.
--
-- Everything is wrapped in a single transaction so the database is
-- never left in a half-applied state. Re-running is safe (idempotent).

begin;

-- ────────────────────────────────────────────────────────────────
-- 1. Add the soft-delete columns the canonical schema expects.
-- ────────────────────────────────────────────────────────────────
alter table public.projects
    add column if not exists deleted_at timestamptz;
alter table public.tasks
    add column if not exists deleted_at timestamptz;

create index if not exists idx_projects_deleted_at
    on public.projects(deleted_at) where deleted_at is null;
create index if not exists idx_tasks_deleted_at
    on public.tasks(deleted_at) where deleted_at is null;

-- ────────────────────────────────────────────────────────────────
-- 2. Add the 7 missing telemetry columns on workflow_steps.
--    Required by src/models/supabaseAdapter.ts:319-338 — every
--    workflow step write currently fails (PGRST204) without these.
-- ────────────────────────────────────────────────────────────────
alter table public.workflow_steps add column if not exists tool_name text;
alter table public.workflow_steps add column if not exists duration_ms integer;
alter table public.workflow_steps add column if not exists input_tokens integer;
alter table public.workflow_steps add column if not exists output_tokens integer;
alter table public.workflow_steps add column if not exists outcome text;
alter table public.workflow_steps add column if not exists error_code text;
alter table public.workflow_steps add column if not exists correlation_id text;

create index if not exists idx_workflow_steps_correlation
    on public.workflow_steps(correlation_id) where correlation_id is not null;

-- ────────────────────────────────────────────────────────────────
-- 3. Repair tasks → projects FK to be ON DELETE CASCADE.
--    Live DB currently has the constraint without cascade, so
--    deleteProject() fails with 23503 when any tasks reference it.
-- ────────────────────────────────────────────────────────────────
do $$
declare
    constraint_name_var text;
begin
    -- Find any FK on public.tasks whose only column is project_id,
    -- regardless of what it's named. Uses information_schema to
    -- avoid the name[]/text[] type mismatch that pg_catalog hits.
    select tc.constraint_name
      into constraint_name_var
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_schema = tc.constraint_schema
       and kcu.constraint_name   = tc.constraint_name
     where tc.table_schema    = 'public'
       and tc.table_name      = 'tasks'
       and tc.constraint_type = 'FOREIGN KEY'
       and kcu.column_name    = 'project_id'
     limit 1;

    if constraint_name_var is not null then
        execute format('alter table public.tasks drop constraint %I', constraint_name_var);
    end if;

    alter table public.tasks
        add constraint tasks_project_id_fkey
        foreign key (project_id) references public.projects(id) on delete cascade;
end$$;

-- ────────────────────────────────────────────────────────────────
-- 4. Drop dead RAG-feature tables (verified empty by the integrity
--    diagnostic, 2026-05-21). The application no longer references
--    any of these. `cascade` removes any orphaned FK / view deps.
-- ────────────────────────────────────────────────────────────────
drop table if exists public.rag_chunks      cascade;
drop table if exists public.rag_documents   cascade;
drop table if exists public.embeddings      cascade;
drop table if exists public.chunks          cascade;
drop table if exists public.vectors         cascade;
drop table if exists public.documents       cascade;
drop table if exists public.memory          cascade;
drop table if exists public.memories        cascade;

commit;
