import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const PROMPTS_ROOT = path.join(REPO_ROOT, "src", "prompts");

// Phase 1 Groups 4–10 reshaped the MCP tool surface. Prompt templates
// must not reference removed tools; the suggested replacements below
// point at the v2 equivalents (or the workflow that subsumes them).
const forbiddenToolReferences = [
  // ── Phase 1 Group 10 removed plan_idea / process_thought ──────────
  {
    token: "plan_idea",
    replacement: 'workflow_run(workflow="plan"|"analyze"|"review")',
  },
  {
    token: "process_thought",
    replacement: 'workflow_run(workflow="process_thought")',
  },
  // ── Legacy planner stage names (pre-v2) ───────────────────────────
  {
    token: "analyze_task",
    replacement: 'workflow_run(workflow="analyze")',
  },
  {
    token: "plan_task",
    replacement:
      'workflow_run(workflow="plan") + workflow_run(workflow="split_plan") + task_edit(action="create")',
  },
  {
    token: "reflect_task",
    replacement: 'workflow_run(workflow="review")',
  },
  {
    token: "analyze_idea",
    replacement: 'workflow_run(workflow="analyze")',
  },
  {
    token: "reflect_idea",
    replacement: 'workflow_run(workflow="review")',
  },
  // ── Phase 1 Groups 5/6 removed split_tasks / sync_tasks ───────────
  {
    token: "split_tasks",
    replacement: 'workflow_run(workflow="split_plan") + task_edit(action="create")',
  },
  {
    token: "sync_tasks",
    replacement:
      'task_edit(action="create"|"update") for non-destructive paths; task_delete(action="clear_all_for_project", mode="execute") for the destructive path',
  },
  {
    token: "clear_all_tasks",
    replacement: 'task_delete(action="clear_all_for_project", mode="execute")',
  },
  // ── Phase 1 Groups 4/5 removed list_tasks / find_task / update_task ──
  {
    token: "list_tasks",
    replacement: 'task_view(action="list")',
  },
  {
    token: "find_task",
    replacement: 'task_view(action="search"|"get")',
  },
  {
    token: "update_task_content",
    replacement: 'task_edit(action="update")',
  },
  {
    token: "update_task",
    replacement: 'task_edit(action="update")',
  },
  {
    token: "reorder_tasks",
    replacement: 'task_edit(action="reorder")',
  },
  // ── Phase 1 Groups 4/5/6 removed project_* legacy tools ───────────
  {
    token: "list_projects",
    replacement: 'project_view(action="list")',
  },
  {
    token: "get_project_context",
    replacement: 'project_view(action="active")',
  },
  {
    token: "create_project",
    replacement: 'project_edit(action="create")',
  },
  {
    token: "delete_project",
    replacement:
      'project_delete(mode="dry_run") → project_delete(mode="execute", reason, confirm:true)',
  },
  {
    token: "delete_task",
    replacement: 'task_delete(action="delete_one"|"delete_many", mode="dry_run"|"execute")',
  },
  // ── Phase 1 Group 7 removed execute_task ──────────────────────────
  {
    token: "execute_task",
    replacement: 'task_lifecycle(action="start")',
  },
  // ── Group 8 keeps verify_task/complete_task as shims; templates may
  //    still reference them but should prefer task_lifecycle directly.
  //    Not policed here to avoid churning shim-aware copy.
  // ── Generic non-AgentFlow references kept from the pre-v2 audit ──
  {
    token: "perplexity",
    replacement:
      'Use capability-based guidance (e.g., research capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
  {
    token: "context7",
    replacement:
      'Use capability-based guidance (e.g., documentation capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
  {
    token: "decisionframework",
    replacement:
      'Use capability-based guidance (e.g., decision-analysis capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
  {
    token: "mentalmodel",
    replacement:
      'Use capability-based guidance (e.g., mental-model capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
  {
    token: "debuggingapproach",
    replacement:
      'Use capability-based guidance (e.g., debugging-method capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
  {
    token: "run_command",
    replacement:
      'Use capability-based guidance (e.g., command-execution capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
  {
    token: "search_web",
    replacement:
      'Use capability-based guidance (e.g., research capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
  {
    token: "desktop commander",
    replacement:
      'Use capability-based guidance (e.g., command-execution capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
  {
    token: "clear thoughts",
    replacement:
      'Use capability-based guidance (e.g., decision-analysis or mental-model capability) and run workflow_run(workflow="process_thought") before optional tool selection.',
  },
];

function escapeRegex(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function collectMarkdownFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

async function collectTemplateDirectories() {
  const entries = await fs.readdir(PROMPTS_ROOT, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("templates_"))
    .map((entry) => path.join(PROMPTS_ROOT, entry.name));
}

async function runAudit() {
  const templateDirs = await collectTemplateDirectories();

  if (templateDirs.length === 0) {
    console.log("ℹ️ No templates_* directories found under src/prompts. Nothing to audit.");
    return;
  }

  const markdownFiles = (
    await Promise.all(templateDirs.map((dir) => collectMarkdownFiles(dir)))
  ).flat();

  const findings = [];

  // Phase 1 Groups 4–10 removed several tools from the MCP surface but
  // kept their prompt-template directories on disk so the legacy
  // handlers under `src/tools/task/{execution,modification}.ts`
  // remain compilable (they are unreachable from the dispatcher but
  // still imported by the barrel re-exports). The prose inside those
  // directories references the now-removed tool names — that's the
  // CORRECT factual state for code that targets the legacy handlers.
  //
  // The audit's job is to catch *new* prose that points at removed
  // tools, not to demand a rewrite of every orphan file. The orphan
  // directories below are excluded; an explicit orphan-cleanup pass
  // will delete them in a future minor along with their generators.
  const ORPHAN_DIRECTORIES = new Set([
    "completeTask",
    "deleteTask",
    "executeTask",
    "findTask",
    "generateRoadmap",
    "listTasks",
    "planIdea",
    "processThought",
    "queryTask",
    "splitTasks",
    "updateTaskContent",
    "verifyTask",
  ]);
  // Subdirectories of `taskToolMessages/` that mirror removed tools.
  const ORPHAN_MESSAGE_GROUPS = new Set([
    "execution", // executeTask / verifyTask / completeTask shim path
    "management", // listTasks (replaced by task_view)
    "modification", // delete_task / update_task_content (replaced by task_delete / task_edit)
    "planning", // plan_idea / process_thought / generate_roadmap chain
  ]);

  function isOrphanPath(filePath) {
    const segs = filePath.replace(/\\/g, "/").split("/");
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].startsWith("templates_")) {
        const next = segs[i + 1];
        if (next && ORPHAN_DIRECTORIES.has(next)) return true;
        if (next === "taskToolMessages") {
          const group = segs[i + 2];
          if (group && ORPHAN_MESSAGE_GROUPS.has(group)) return true;
        }
        if (next === "workflows") return true; // Phase 1 Group 10 docs
        return false;
      }
    }
    return false;
  }

  for (const filePath of markdownFiles) {
    if (isOrphanPath(filePath)) continue;

    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split(/\r?\n/);

    for (const rule of forbiddenToolReferences) {
      const tokenRegex = new RegExp(`\\b${escapeRegex(rule.token)}\\b`, "i");

      lines.forEach((line, index) => {
        if (!tokenRegex.test(line)) return;

        // Allow `workflow="<token>"` / `workflow='<token>'` / `workflow=<token>`
        // shapes — these are not deprecated tool references, they are
        // workflow_run discriminator values.
        const workflowValueRegex = new RegExp(
          `workflow\\s*=\\s*['"\`]?${escapeRegex(rule.token)}['"\`]?`,
          "i"
        );
        if (workflowValueRegex.test(line)) return;

        findings.push({
          filePath,
          lineNumber: index + 1,
          token: rule.token,
          replacement: rule.replacement,
          line: line.trim(),
        });
      });
    }
  }

  if (findings.length === 0) {
    console.log("✅ Prompt template tool-reference audit passed. No deprecated tool names found.");
    return;
  }

  console.error("❌ Deprecated tool references found in prompt templates:\n");

  for (const finding of findings) {
    const relativePath = path.relative(REPO_ROOT, finding.filePath).replace(/\\/g, "/");
    console.error(`- ${relativePath}:${finding.lineNumber}`);
    console.error(`  token: ${finding.token}`);
    console.error(`  suggested replacement: ${finding.replacement}`);
    console.error(`  line: ${finding.line}`);
    console.error("");
  }

  process.exitCode = 1;
}

runAudit().catch((error) => {
  console.error("❌ Failed to run prompt template tool-reference audit:", error);
  process.exitCode = 1;
});
