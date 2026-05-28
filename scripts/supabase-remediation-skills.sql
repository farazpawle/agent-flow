-- Wave 3 §10.E — idempotent migration for existing Supabase deployments.
-- Adds the project_skills + project_skill_references tables and their
-- service-role RLS policies. Safe to run on a database that already has
-- the canonical schema applied.

create table if not exists project_skills (
    id text primary key,
    project_id text not null unique references projects(id) on delete cascade,
    frontmatter jsonb not null default '{}'::jsonb,
    body text not null,
    compiled_at timestamptz not null default now(),
    token_count integer not null default 0
);
create index if not exists idx_project_skills_project on project_skills(project_id);

create table if not exists project_skill_references (
    id text primary key,
    skill_id text not null references project_skills(id) on delete cascade,
    topic text not null,
    content text not null,
    source_finding_ids jsonb
);
create index if not exists idx_project_skill_refs_skill on project_skill_references(skill_id);
create index if not exists idx_project_skill_refs_topic on project_skill_references(skill_id, topic);

alter table project_skills            enable row level security;
alter table project_skill_references  enable row level security;

drop policy if exists "service_role full access to project_skills" on project_skills;
drop policy if exists "service_role full access to project_skill_references" on project_skill_references;
create policy "service_role full access to project_skills"
    on project_skills for all to service_role using (true) with check (true);
create policy "service_role full access to project_skill_references"
    on project_skill_references for all to service_role using (true) with check (true);
