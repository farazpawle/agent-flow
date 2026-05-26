-- AgentFlow Supabase remediation — Phase 1 (Group 1) schema reshape
-- Generated 2026-05-24.
--
-- Brings an existing Supabase project in line with the new tables/columns
-- introduced by the v2 MCP tool-surface redesign:
--   1.3  tasks.version (optimistic concurrency)
--   1.1  task_findings (append-only artifacts/evidence)
--   1.2  lesson_summaries
--   1.4  client_active_project
--   1.5  llm_settings (single-row enforced by CHECK (id = 1))
--
-- Idempotent and wrapped in a single transaction. Safe to paste into the
-- Supabase SQL Editor as many times as needed; second-run is a no-op.

begin;

-- 1.3 — optimistic concurrency column on tasks. Constant default makes the
-- backfill metadata-only on Postgres >= 11 (no table rewrite).
alter table public.tasks
    add column if not exists version integer not null default 1;

-- 1.1 — task_findings
create table if not exists public.task_findings (
    id text primary key,
    project_id text not null references public.projects(id) on delete cascade,
    task_id text not null references public.tasks(id) on delete cascade,
    kind text not null,
    type text,
    content jsonb not null,
    metadata jsonb,
    created_at timestamptz not null default now(),
    created_by text
);
create index if not exists idx_findings_task_created
    on public.task_findings(task_id, created_at desc);
create index if not exists idx_findings_project_created
    on public.task_findings(project_id, created_at desc);
create index if not exists idx_findings_task_kind
    on public.task_findings(task_id, kind);
create index if not exists idx_findings_project_kind_type
    on public.task_findings(project_id, kind, type);

-- 1.2 — lesson_summaries
create table if not exists public.lesson_summaries (
    id text primary key,
    project_id text not null references public.projects(id) on delete cascade,
    topic text not null,
    summary text not null,
    source_finding_ids jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists idx_lesson_summaries_project_topic
    on public.lesson_summaries(project_id, topic);

-- 1.4 — client_active_project
create table if not exists public.client_active_project (
    client_id text primary key references public.clients(id) on delete cascade,
    project_id text not null references public.projects(id) on delete cascade,
    set_at timestamptz not null default now()
);

-- 1.5 — llm_settings (single-row)
create table if not exists public.llm_settings (
    id integer primary key check (id = 1),
    provider text,
    model text,
    selection_strategy text,
    workflow_mode text,
    updated_at timestamptz not null default now()
);

-- RLS: deny-all to anon/authenticated, full access to service_role.
alter table public.task_findings        enable row level security;
alter table public.lesson_summaries     enable row level security;
alter table public.client_active_project enable row level security;
alter table public.llm_settings         enable row level security;

drop policy if exists "service_role full access to task_findings"
    on public.task_findings;
drop policy if exists "service_role full access to lesson_summaries"
    on public.lesson_summaries;
drop policy if exists "service_role full access to client_active_project"
    on public.client_active_project;
drop policy if exists "service_role full access to llm_settings"
    on public.llm_settings;

create policy "service_role full access to task_findings"
    on public.task_findings for all to service_role using (true) with check (true);
create policy "service_role full access to lesson_summaries"
    on public.lesson_summaries for all to service_role using (true) with check (true);
create policy "service_role full access to client_active_project"
    on public.client_active_project for all to service_role using (true) with check (true);
create policy "service_role full access to llm_settings"
    on public.llm_settings for all to service_role using (true) with check (true);

-- Phase 1 Group 6.3 — append-only destructive audit log (no FK cascade).
create table if not exists public.destructive_audits (
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
    on public.destructive_audits(project_id, created_at desc);
create index if not exists idx_destructive_audits_tool
    on public.destructive_audits(tool, created_at desc);

alter table public.destructive_audits enable row level security;
drop policy if exists "service_role full access to destructive_audits"
    on public.destructive_audits;
create policy "service_role full access to destructive_audits"
    on public.destructive_audits for all to service_role using (true) with check (true);

commit;
