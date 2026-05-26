// One-shot Supabase integrity diagnostic for AgentFlow.
// Verifies every column the SupabaseAdapter touches, runs an isolated CRUD
// round-trip with `__integrity_test__` rows, checks FK cascade & realtime.
// Read-only against existing data.
//
// Usage: node --use-system-ca scripts/tmp-supabase-integrity.mjs
// This file is intentionally temporary and will be deleted after the run.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(REPO_ROOT, ".env") });

function resolveEnv(preferred, legacy) {
  const pick = (v) => (v && v.trim() ? v.trim() : undefined);
  return pick(process.env[preferred]) ?? pick(process.env[legacy]);
}

const SUPABASE_URL = resolveEnv("SUPABASE_PROJECT_URL", "SUPABASE_URL");
const SUPABASE_KEY = resolveEnv("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY");

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("FATAL: Missing SUPABASE_PROJECT_URL / SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(2);
}

const TEST_PREFIX = "__integrity_test__";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const EXPECTED_COLUMNS = {
  projects: [
    "id",
    "name",
    "description",
    "path",
    "git_remote_url",
    "tech_stack",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  tasks: [
    "id",
    "name",
    "status",
    "created_at",
    "updated_at",
    "completed_at",
    "client_id",
    "project_id",
    "content",
    "execution_order",
    "deleted_at",
  ],
  workflow_steps: [
    "id",
    "project_id",
    "task_id",
    "step_type",
    "content",
    "previous_step_id",
    "created_at",
    "tool_name",
    "duration_ms",
    "input_tokens",
    "output_tokens",
    "outcome",
    "error_code",
    "correlation_id",
  ],
  clients: ["id", "name", "type", "workspace", "connected_at", "last_activity_at", "is_active"],
};

const SUSPECT_LEGACY_TABLES = [
  "documents",
  "embeddings",
  "chunks",
  "vectors",
  "rag_documents",
  "rag_chunks",
  "memory",
  "memories",
];

const report = {
  connection: null,
  tables: {},
  legacyTables: {},
  crud: {},
  cascade: null,
  realtime: null,
  cleanup: {},
};

function classifyError(err) {
  if (!err) return null;
  return { code: err.code || err.details?.code, message: err.message || String(err) };
}

function extractMissingColumn(message) {
  if (!message) return null;
  let m = message.match(/column ['"]?([\w.]+)['"]? (?:of relation ['"]?\w+['"]? )?does not exist/i);
  if (m) return m[1].includes(".") ? m[1].split(".").pop() : m[1];
  m = message.match(/Could not find the ['"]([\w]+)['"] column/i);
  if (m) return m[1];
  m = message.match(/column ['"]([\w]+)['"]/i);
  return m ? m[1] : null;
}

async function probeColumns(table, columns) {
  const result = { exists: true, missingColumns: [], unexpectedError: null };
  const probe = await supabase.from(table).select("*", { count: "exact", head: true });
  if (probe.error) {
    const cls = classifyError(probe.error);
    if (cls.code === "42P01" || /does not exist/i.test(cls.message)) {
      result.exists = false;
      return result;
    }
    result.unexpectedError = cls;
    return result;
  }
  for (const col of columns) {
    const { error } = await supabase.from(table).select(col).limit(0);
    if (error) {
      const cls = classifyError(error);
      const missing =
        cls.code === "42703" ||
        /does not exist/i.test(cls.message) ||
        /Could not find/i.test(cls.message);
      if (missing) {
        result.missingColumns.push(extractMissingColumn(cls.message) || col);
      } else {
        result.unexpectedError = result.unexpectedError || cls;
      }
    }
  }
  result.missingColumns = [...new Set(result.missingColumns)];
  return result;
}

async function probeLegacyTable(table) {
  const { error, count } = await supabase.from(table).select("*", { count: "exact", head: true });
  if (error) {
    const cls = classifyError(error);
    if (cls.code === "42P01" || /does not exist/i.test(cls.message)) return { exists: false };
    return { exists: true, errorProbing: cls };
  }
  return { exists: true, rowCount: count ?? 0 };
}

async function step1_connection() {
  const { error } = await supabase.from("projects").select("id").limit(1);
  if (error) {
    report.connection = { ok: false, error: classifyError(error) };
    return false;
  }
  report.connection = { ok: true, url: SUPABASE_URL };
  return true;
}

async function step2_schemaProbe() {
  for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
    report.tables[table] = await probeColumns(table, cols);
  }
  for (const t of SUSPECT_LEGACY_TABLES) {
    report.legacyTables[t] = await probeLegacyTable(t);
  }
}

async function step3_crud() {
  const projId = `${TEST_PREFIX}proj`;
  const taskId = `${TEST_PREFIX}task`;
  const stepId = `${TEST_PREFIX}step`;
  const clientId = `${TEST_PREFIX}client`;
  const now = new Date().toISOString();

  {
    const { error } = await supabase.from("projects").upsert({
      id: projId,
      name: "AgentFlow integrity test",
      description: "temp row",
      path: "/tmp/integrity-test",
      git_remote_url: `https://example.invalid/${projId}-${Date.now()}`,
      tech_stack: ["typescript", "node"],
      created_at: now,
      updated_at: now,
    });
    report.crud.project_upsert = { ok: !error, error: classifyError(error) };
  }

  {
    const taskContent = {
      id: taskId,
      name: "integrity task",
      description: "temp",
      status: "Pending",
      dependencies: [],
      createdAt: now,
      updatedAt: now,
      projectId: projId,
    };
    const { error } = await supabase.from("tasks").upsert({
      id: taskId,
      name: "integrity task",
      status: "Pending",
      created_at: now,
      updated_at: now,
      completed_at: null,
      client_id: null,
      project_id: projId,
      content: taskContent,
      execution_order: 0,
    });
    report.crud.task_upsert = { ok: !error, error: classifyError(error) };
  }

  {
    const { error } = await supabase.from("workflow_steps").insert({
      id: stepId,
      project_id: projId,
      task_id: taskId,
      step_type: "PLAN",
      content: "integrity probe",
      previous_step_id: null,
      created_at: now,
      tool_name: "tmp-supabase-integrity",
      duration_ms: 1,
      input_tokens: 0,
      output_tokens: 0,
      outcome: "success",
      error_code: null,
      correlation_id: "integrity-test",
    });
    report.crud.workflow_step_insert_full = { ok: !error, error: classifyError(error) };
  }

  {
    const { error } = await supabase.from("clients").upsert({
      id: clientId,
      name: "integrity client",
      type: "unknown",
      workspace: "/tmp",
      connected_at: now,
      last_activity_at: now,
      is_active: true,
    });
    report.crud.client_upsert = { ok: !error, error: classifyError(error) };
  }

  for (const [table, id] of [
    ["projects", projId],
    ["tasks", taskId],
    ["workflow_steps", stepId],
    ["clients", clientId],
  ]) {
    const { data, error } = await supabase.from(table).select("id").eq("id", id).maybeSingle();
    report.crud[`${table}_read`] = {
      ok: !error && !!data,
      error: classifyError(error),
      found: !!data,
    };
  }

  {
    const { error: delErr } = await supabase.from("projects").delete().eq("id", projId);
    report.crud.project_delete = { ok: !delErr, error: classifyError(delErr) };

    const { data: taskAfter } = await supabase
      .from("tasks")
      .select("id")
      .eq("id", taskId)
      .maybeSingle();
    const { data: stepAfter } = await supabase
      .from("workflow_steps")
      .select("id")
      .eq("id", stepId)
      .maybeSingle();

    report.cascade = {
      taskGoneAfterDelete: !taskAfter,
      stepGoneAfterDelete: !stepAfter,
      ok: !taskAfter && !stepAfter,
    };
  }
}

async function step4_realtime() {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      report.realtime = payload;
      try {
        supabase.removeChannel(channel);
      } catch (_) {}
      resolve();
    };
    const channel = supabase
      .channel("integrity_room_tasks")
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks" }, () => {})
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") finish({ ok: true, status });
        else if (["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status))
          finish({ ok: false, status, error: classifyError(err) });
      });
    setTimeout(() => finish({ ok: false, status: "CLIENT_TIMEOUT" }), 8000);
  });
}

async function step5_cleanup() {
  for (const table of ["workflow_steps", "tasks", "projects", "clients"]) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: "exact" })
      .like("id", `${TEST_PREFIX}%`);
    report.cleanup[table] = error
      ? { ok: false, error: classifyError(error) }
      : { ok: true, removed: count ?? 0 };
  }
}

(async () => {
  console.log(`[integrity] target: ${SUPABASE_URL}`);
  if (!(await step1_connection())) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(1);
  }
  await step2_schemaProbe();
  await step3_crud();
  await step4_realtime();
  await step5_cleanup();

  console.log("\n===== INTEGRITY REPORT (JSON) =====");
  console.log(JSON.stringify(report, null, 2));
  console.log("===== END REPORT =====");
  process.exit(0);
})().catch((err) => {
  console.error("[integrity] unhandled error:", err);
  console.log(JSON.stringify(report, null, 2));
  process.exit(1);
});
