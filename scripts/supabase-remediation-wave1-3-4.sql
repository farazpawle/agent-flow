-- ============================================================================
-- AgentFlow — Supabase remediation for Wave 1 / 3 / 4 schema drift
-- ============================================================================
-- Brings an older live Supabase deployment up to parity with the code.
-- This is a convenience consolidation of three existing, idempotent files:
--   - scripts/supabase-remediation-locks.sql   (Wave 1 §10.C — lock columns)
--   - scripts/supabase-remediation-groups.sql  (Wave 1 §10.D — task groups)
--   - scripts/supabase-remediation-skills.sql  (Wave 3 §10.E — project skill)
--
-- Every statement is guarded with `if not exists` / `drop ... if exists`, so
-- the whole file is SAFE TO RE-RUN. Apply it in the Supabase SQL Editor
-- (New query → paste → Run), then run `npm run supabase:check` locally.
--
-- Without these, live runtime fails:
--   - task_edit(create)        → INTERNAL  (INSERT references claimed_*/group_id/parent_task_id)
--   - project_edit(create_group)→ INTERNAL  (task_groups table missing)
--   - context_get(skill_index) → INTERNAL  (project_skills tables missing)
-- ============================================================================

begin;

-- ===== Wave 1 §10.C — multi-agent lock columns on tasks =====================
alter table tasks add column if not exists claimed_by       text;
alter table tasks add column if not exists claimed_at       timestamptz;
alter table tasks add column if not exists claim_expires_at timestamptz;
create index if not exists idx_tasks_claim on tasks (claimed_by, claim_expires_at);

-- ===== Wave 1 §10.D — task groups + task hierarchy ==========================
create table if not exists task_groups (
    id          text primary key,
    project_id  text not null references projects(id) on delete cascade,
    name        text not null,
    description text,
    status      text not null default 'active',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);
create index if not exists idx_task_groups_project on task_groups(project_id);

alter table tasks add column if not exists group_id       text references task_groups(id) on delete set null;
alter table tasks add column if not exists parent_task_id text references tasks(id)       on delete set null;
create index if not exists idx_tasks_project_group on tasks(project_id, group_id);
create index if not exists idx_tasks_parent        on tasks(parent_task_id);

-- ===== Wave 3 §10.E — project skill tables ==================================
create table if not exists project_skills (
    id          text primary key,
    project_id  text not null unique references projects(id) on delete cascade,
    frontmatter jsonb not null default '{}'::jsonb,
    body        text not null,
    compiled_at timestamptz not null default now(),
    token_count integer not null default 0
);
create index if not exists idx_project_skills_project on project_skills(project_id);

create table if not exists project_skill_references (
    id                 text primary key,
    skill_id           text not null references project_skills(id) on delete cascade,
    topic              text not null,
    content            text not null,
    source_finding_ids jsonb
);
create index if not exists idx_project_skill_refs_skill on project_skill_references(skill_id);
create index if not exists idx_project_skill_refs_topic on project_skill_references(skill_id, topic);

alter table project_skills           enable row level security;
alter table project_skill_references enable row level security;

drop policy if exists "service_role full access to project_skills"           on project_skills;
drop policy if exists "service_role full access to project_skill_references" on project_skill_references;
create policy "service_role full access to project_skills"
    on project_skills           for all to service_role using (true) with check (true);
create policy "service_role full access to project_skill_references"
    on project_skill_references for all to service_role using (true) with check (true);

commit;

-- ============================================================================
-- Verification — should return one row per object, all flagged 'OK'.
-- ============================================================================
select 'tasks.claimed_by'                as object,
       case when exists (select 1 from information_schema.columns
                         where table_name='tasks' and column_name='claimed_by') then 'OK' else 'MISSING' end as status
union all select 'tasks.claimed_at',
       case when exists (select 1 from information_schema.columns where table_name='tasks' and column_name='claimed_at') then 'OK' else 'MISSING' end
union all select 'tasks.claim_expires_at',
       case when exists (select 1 from information_schema.columns where table_name='tasks' and column_name='claim_expires_at') then 'OK' else 'MISSING' end
union all select 'tasks.group_id',
       case when exists (select 1 from information_schema.columns where table_name='tasks' and column_name='group_id') then 'OK' else 'MISSING' end
union all select 'tasks.parent_task_id',
       case when exists (select 1 from information_schema.columns where table_name='tasks' and column_name='parent_task_id') then 'OK' else 'MISSING' end
union all select 'table task_groups',
       case when to_regclass('public.task_groups') is not null then 'OK' else 'MISSING' end
union all select 'table project_skills',
       case when to_regclass('public.project_skills') is not null then 'OK' else 'MISSING' end
union all select 'table project_skill_references',
       case when to_regclass('public.project_skill_references') is not null then 'OK' else 'MISSING' end
order by object;
