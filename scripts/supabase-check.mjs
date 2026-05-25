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
  ];
  let allOk = true;

  for (const { name, column } of tables) {
    const { error } = await supabase.from(name).select(column).limit(1);
    if (error) {
      console.error(`❌ Table "${name}" check failed: ${error.message}`);
      if (error.code === "42P01") {
        console.error(
          `   👉 Hint: Table "${name}" does not exist. Please run scripts/supabase-remediation-3.sql in your Supabase SQL Editor.`
        );
      }
      allOk = false;
    } else {
      console.log(`✅ Table "${name}" is accessible.`);
    }
  }

  if (allOk) {
    console.log("✨ Supabase is correctly configured and all tables are present!");
  } else {
    console.error(
      "⚠️ Some tables are missing. Please initialize them using scripts/supabase-schema.sql"
    );
    process.exit(1);
  }
}

checkSupabase().catch((err) => {
  console.error("❌ Unexpected error:", err);
  process.exit(1);
});
