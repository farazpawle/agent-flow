import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// Load .env from root
dotenv.config({ path: path.join(REPO_ROOT, ".env") });

// Accept both preferred (Phase 1+) and legacy env names — same alias
// behaviour the runtime applies via src/utils/envConfig.ts. The script
// is plain JS so it can't import the TS aliaser directly; mirror the
// two pairs explicitly instead.
const supabaseUrl = process.env.SUPABASE_PROJECT_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function checkSupabase() {
  console.log("🔍 Checking Supabase connection and tables...");

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "❌ Error: SUPABASE_PROJECT_URL (or legacy SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (or legacy SUPABASE_SERVICE_KEY) must be set in .env"
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Each entry pairs the table name with a column we know lives on it.
  // `client_active_project` uses `client_id` as its primary key (not
  // `id`), so the previous one-size-fits-all `select('id')` falsely
  // reported it as broken even after the migration ran. The check is
  // about table existence; any real column does the job.
  const tables = [
    { name: "projects", column: "id" },
    { name: "tasks", column: "id" },
    { name: "workflow_steps", column: "id" },
    { name: "clients", column: "id" },
    // Phase 1 (Group 1) — schema reshape
    { name: "task_findings", column: "id" },
    { name: "lesson_summaries", column: "id" },
    { name: "client_active_project", column: "client_id" },
    { name: "llm_settings", column: "id" },
    // Phase 1 (Group 6.3) — destructive audit log
    { name: "destructive_audits", column: "id" },
    // Wave 1 §10.D — task groups (run supabase-remediation-groups.sql)
    { name: "task_groups", column: "id", remediation: "supabase-remediation-groups.sql" },
    // Wave 3 §10.E — project skill (run supabase-remediation-skills.sql)
    { name: "project_skills", column: "id", remediation: "supabase-remediation-skills.sql" },
    {
      name: "project_skill_references",
      column: "id",
      remediation: "supabase-remediation-skills.sql",
    },
  ];

  // Base-table existence checks left a gap: the Wave 1/3/4 migrations add
  // *columns* to existing tables, which a table-level check can't see. A
  // deployment missing these passes the table scan yet 500s at runtime
  // (e.g. task_edit create INSERTs claimed_by/group_id). Verify each
  // explicitly so the check matches what the adapters actually write.
  const columns = [
    // Wave 1 §10.C — lock columns (supabase-remediation-locks.sql)
    { table: "tasks", column: "claimed_by", remediation: "supabase-remediation-locks.sql" },
    { table: "tasks", column: "claimed_at", remediation: "supabase-remediation-locks.sql" },
    { table: "tasks", column: "claim_expires_at", remediation: "supabase-remediation-locks.sql" },
    // Wave 1 §10.D — task hierarchy (supabase-remediation-groups.sql)
    { table: "tasks", column: "group_id", remediation: "supabase-remediation-groups.sql" },
    { table: "tasks", column: "parent_task_id", remediation: "supabase-remediation-groups.sql" },
    // Phase 1 — ordering + optimistic concurrency (supabase-remediation-3.sql)
    { table: "tasks", column: "execution_order", remediation: "supabase-remediation-3.sql" },
    { table: "tasks", column: "version", remediation: "supabase-remediation-3.sql" },
  ];

  let allOk = true;

  for (const { name, column, remediation } of tables) {
    const { error } = await supabase.from(name).select(column).limit(1);
    if (error) {
      // PostgREST reports a missing table as 42P01 or, via the schema
      // cache, PGRST205. Treat both as "table missing".
      const missing = error.code === "42P01" || error.code === "PGRST205";
      console.error(`❌ Table "${name}" check failed: ${error.message}`);
      if (missing) {
        console.error(
          `   👉 Hint: run scripts/${remediation ?? "supabase-remediation-3.sql"} in your Supabase SQL Editor.`
        );
      }
      allOk = false;
    } else {
      console.log(`✅ Table "${name}" is accessible.`);
    }
  }

  for (const { table, column, remediation } of columns) {
    const { error } = await supabase.from(table).select(column).limit(1);
    if (error) {
      // 42703 = undefined_column. The table exists but lacks the column.
      console.error(`❌ Column "${table}.${column}" check failed: ${error.message}`);
      if (error.code === "42703") {
        console.error(`   👉 Hint: run scripts/${remediation} in your Supabase SQL Editor.`);
      }
      allOk = false;
    } else {
      console.log(`✅ Column "${table}.${column}" is present.`);
    }
  }

  if (allOk) {
    console.log("✨ Supabase is correctly configured — all tables and columns are present!");
  } else {
    console.error(
      "⚠️ Schema drift detected. Apply the remediation script(s) named above in the Supabase SQL Editor (all are idempotent), then re-run `npm run supabase:check`."
    );
    process.exit(1);
  }
}

checkSupabase().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
