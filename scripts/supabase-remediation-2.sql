-- AgentFlow Supabase remediation — follow-up (run 2 of 2)
-- Generated 2026-05-21 after the integrity diagnostic revealed:
--   1. workflow_steps_project_id_fkey is NOT cascading (was masked in
--      run 1 because telemetry inserts failed, so no step existed for
--      the cascade test).
--   2. The 8 RAG-leftover tables are still present (the prior remediation
--      transaction either didn't include the DROP block or it was
--      filtered out when only the corrected DO block was pasted).
--
-- Idempotent and wrapped in a single transaction. Paste the WHOLE file
-- into the Supabase SQL Editor for project sjekgzzlzreigkakgwkn.

begin;

-- ────────────────────────────────────────────────────────────────
-- 1. Repair workflow_steps → projects FK to be ON DELETE CASCADE.
--    Same uses-information_schema lookup as the tasks FK fix.
-- ────────────────────────────────────────────────────────────────
do $$
declare
    constraint_name_var text;
begin
    select tc.constraint_name
      into constraint_name_var
      from information_schema.table_constraints tc
      join information_schema.key_column_usage kcu
        on kcu.constraint_schema = tc.constraint_schema
       and kcu.constraint_name   = tc.constraint_name
     where tc.table_schema    = 'public'
       and tc.table_name      = 'workflow_steps'
       and tc.constraint_type = 'FOREIGN KEY'
       and kcu.column_name    = 'project_id'
     limit 1;

    if constraint_name_var is not null then
        execute format('alter table public.workflow_steps drop constraint %I', constraint_name_var);
    end if;

    alter table public.workflow_steps
        add constraint workflow_steps_project_id_fkey
        foreign key (project_id) references public.projects(id) on delete cascade;
end$$;

-- ────────────────────────────────────────────────────────────────
-- 2. Drop dead RAG-feature tables (verified empty by integrity
--    diagnostic, rowCount=0 across all eight). `cascade` removes
--    any orphaned FKs / views.
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
