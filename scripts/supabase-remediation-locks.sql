-- Wave 1 §10.C — Multi-agent lock columns + index.
-- Idempotent migration for existing Supabase deployments. Apply by running
-- this file in the Supabase SQL editor.
--
-- Adds three lock columns to `tasks` and the lock-contention filter index.
-- The columns are nullable so the migration is safe against in-flight rows.
-- The canonical schema (`scripts/supabase-schema.sql`) already includes
-- these definitions for fresh deployments; this script brings older
-- deployments up to parity.

alter table tasks
    add column if not exists claimed_by text;

alter table tasks
    add column if not exists claimed_at timestamptz;

alter table tasks
    add column if not exists claim_expires_at timestamptz;

create index if not exists idx_tasks_claim
    on tasks (claimed_by, claim_expires_at);

-- Sanity check: should report 3 columns + 1 index.
-- select column_name from information_schema.columns
--     where table_name = 'tasks' and column_name in ('claimed_by','claimed_at','claim_expires_at');
-- select indexname from pg_indexes where tablename = 'tasks' and indexname = 'idx_tasks_claim';
