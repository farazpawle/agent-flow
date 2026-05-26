/**
 * Task detail page — Phase 1 Group 11.1, 11.2, 11.3, 11.4, 11.6.
 *
 * 5-section layout: Summary / Work Definition / Result / Context / Advanced.
 * - Summary is read-only header info.
 * - Work Definition holds the editable task body. Saves go through
 *   POST /api/tasks/edit with task_edit(action='update', expectedVersion).
 * - Result holds finalization fields (read-only here; mutated via lifecycle).
 * - Context holds problem statement / technical plan / related findings.
 * - Advanced is collapsed by default; contains metadata, dependencies,
 *   and the findings panel (Group 11.2) backed by context_get.
 *
 * Every mutating call sends expectedVersion (11.3). On CONFLICT we
 * surface the diff modal from `../lib/conflict.js` and never blind-retry
 * (11.4). Delete uses the dry_run/execute split (11.6).
 */

import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml, statusKey, statusLabel, formatDate } from "../lib/utils.js";
import { postWithConflictResolution } from "../lib/conflict.js";

const EDITABLE_FIELDS = [
  { key: "name", label: "Name", rows: 1, section: "work" },
  { key: "description", label: "Description", rows: 4, section: "work" },
  { key: "implementationGuide", label: "Implementation Guide", rows: 4, section: "work" },
  { key: "verificationCriteria", label: "Verification Criteria", rows: 3, section: "work" },
  { key: "notes", label: "Notes", rows: 2, section: "work" },
  { key: "problemStatement", label: "Problem Statement", rows: 3, section: "context" },
  { key: "technicalPlan", label: "Technical Plan", rows: 5, section: "context" },
];

const RESULT_FIELDS = [
  { key: "finalOutcome", label: "Final Outcome", rows: 3 },
  { key: "lessonsLearned", label: "Lessons Learned", rows: 2 },
  { key: "summary", label: "Summary", rows: 2 },
];

export async function mount(container, { params }) {
  const id = params.id;
  container.innerHTML = `<div class="placeholder">Loading task…</div>`;

  let task;
  try {
    const res = await api.get(`/api/tasks/${encodeURIComponent(id)}`);
    task = res.task;
  } catch (err) {
    container.innerHTML = `<div class="page-empty error"><h2>Task not found</h2><p>${escapeHtml(err.message)}</p><a class="btn btn-primary" href="#/tasks">Back to tasks</a></div>`;
    return;
  }

  render(container, task);
  attachHandlers(container, task);
  void loadFindings(container, task);
  void loadConversation(container, id);
}

function render(container, task) {
  container.innerHTML = `
        <div class="page-header">
            <div>
                <h1>${escapeHtml(task.name)}</h1>
                <div class="page-subtitle">
                    <span class="badge badge-${statusKey(task.status).replace(/_/g, "-")}">${escapeHtml(statusLabel(task.status))}</span>
                    <span class="muted">· Updated ${escapeHtml(formatDate(task.updatedAt))}</span>
                    <span class="muted">· v${escapeHtml(String(task.version ?? 1))}</span>
                </div>
            </div>
            <div class="page-actions">
                <a class="btn btn-secondary" href="#/tasks">Back</a>
                <button class="btn btn-danger" id="btn-delete-task">Delete…</button>
            </div>
        </div>

        <form id="task-edit-form">
            <!-- ── Section 1 — Summary (read-only header) ─────────── -->
            ${renderSummarySection(task)}

            <!-- ── Section 2 — Work Definition (editable) ─────────── -->
            <section class="task-section" data-section="work">
                <h3>
                    Work Definition
                    <button type="button" class="task-section-toggle" data-toggle="work">−</button>
                </h3>
                <div class="task-section-body">
                    ${EDITABLE_FIELDS.filter((f) => f.section === "work")
                      .map((f) => fieldHtml(f, task))
                      .join("")}
                    <div class="page-actions" style="justify-content:flex-end;">
                        <button class="btn btn-primary" type="submit">Save changes</button>
                    </div>
                </div>
            </section>

            <!-- ── Section 3 — Result (read-only here; mutated via lifecycle) -->
            <section class="task-section" data-section="result">
                <h3>
                    Result
                    <button type="button" class="task-section-toggle" data-toggle="result">−</button>
                </h3>
                <div class="task-section-body">
                    ${RESULT_FIELDS.map((f) => readOnlyFieldHtml(f, task)).join("")}
                    <p class="muted tiny">
                        Result fields are populated by <code>task_lifecycle(action='finalize')</code>.
                        Use an MCP client (or the agent) to advance the task.
                    </p>
                </div>
            </section>

            <!-- ── Section 4 — Context (editable problem/plan) ────── -->
            <section class="task-section" data-section="context">
                <h3>
                    Context
                    <button type="button" class="task-section-toggle" data-toggle="context">−</button>
                </h3>
                <div class="task-section-body">
                    ${EDITABLE_FIELDS.filter((f) => f.section === "context")
                      .map((f) => fieldHtml(f, task))
                      .join("")}
                </div>
            </section>

            <!-- ── Section 5 — Advanced (collapsed: metadata + findings + history) -->
            <section class="task-section collapsed" data-section="advanced">
                <h3>
                    Advanced
                    <button type="button" class="task-section-toggle" data-toggle="advanced">+</button>
                </h3>
                <div class="task-section-body">
                    ${renderAdvancedSection(task)}
                </div>
            </section>
        </form>
    `;
}

function renderSummarySection(task) {
  return `
        <section class="task-section" data-section="summary">
            <h3>
                Summary
                <button type="button" class="task-section-toggle" data-toggle="summary">−</button>
            </h3>
            <div class="task-section-body">
                <div class="field-block">
                    <label class="label">Status</label>
                    <div class="muted">${escapeHtml(statusLabel(task.status))} (use <code>task_lifecycle</code> to transition)</div>
                </div>
                ${task.projectId ? `<div class="field-block"><label class="label">Project</label><div>${escapeHtml(task.projectId)}</div></div>` : ""}
                ${task.priority ? `<div class="field-block"><label class="label">Priority</label><div>${escapeHtml(task.priority)}</div></div>` : ""}
            </div>
        </section>
    `;
}

function renderAdvancedSection(task) {
  return `
        <div class="field-block">
            <label class="label">Task ID</label>
            <div style="font-family: var(--font-mono); font-size: 12px; word-break: break-all;">${escapeHtml(task.id)}</div>
        </div>
        ${
          task.executionOrder != null
            ? `
            <div class="field-block">
                <label class="label">Execution order</label>
                <div>${escapeHtml(String(task.executionOrder))}</div>
            </div>`
            : ""
        }
        ${
          task.dependencies && task.dependencies.length
            ? `
            <div class="field-block">
                <label class="label">Dependencies</label>
                <div>${task.dependencies
                  .map((d) => {
                    const tid = typeof d === "object" ? d.taskId : d;
                    return `<a href="#/tasks/${encodeURIComponent(tid)}">${escapeHtml(tid)}</a>`;
                  })
                  .join("<br>")}</div>
            </div>`
            : ""
        }

        <h4 style="margin-top: var(--space-4);">Findings</h4>
        <div id="findings-panel"><p class="placeholder tiny">Loading findings…</p></div>

        <h4 style="margin-top: var(--space-4);">Conversation History</h4>
        <div id="conversation-list"><p class="placeholder tiny">Loading…</p></div>

        <h4 style="margin-top: var(--space-4);">Run this task (MCP)</h4>
        <p class="muted tiny">Paste this into your agent's MCP chat to drive the lifecycle.</p>
        <pre id="mcp-call-start"></pre>
        <pre id="mcp-call-request-review" style="margin-top: 8px;"></pre>
        <pre id="mcp-call-finalize" style="margin-top: 8px;"></pre>
    `;
}

function fieldHtml(f, task) {
  if (f.rows === 1) {
    return `
            <div class="field-block">
                <label class="label">${escapeHtml(f.label)}</label>
                <input class="input" name="${f.key}" value="${escapeHtml(task[f.key] || "")}" ${f.key === "name" ? "required" : ""} />
            </div>
        `;
  }
  return `
        <div class="field-block">
            <label class="label">${escapeHtml(f.label)}</label>
            <textarea class="textarea" name="${f.key}" rows="${f.rows}">${escapeHtml(task[f.key] || "")}</textarea>
        </div>
    `;
}

function readOnlyFieldHtml(f, task) {
  const v = task[f.key] || "";
  return `
        <div class="field-block">
            <label class="label">${escapeHtml(f.label)}</label>
            <div class="readonly-text">${v ? escapeHtml(v) : `<span class="muted">— empty —</span>`}</div>
        </div>
    `;
}

function attachHandlers(container, taskInitial) {
  // taskState is shared by all handlers so retries can read the
  // currently-loaded version after a CONFLICT-driven reload.
  const taskState = { current: taskInitial };

  // Section collapse toggle
  container.querySelectorAll(".task-section-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const section = btn.closest(".task-section");
      section.classList.toggle("collapsed");
      btn.textContent = section.classList.contains("collapsed") ? "+" : "−";
    });
  });

  // MCP call snippets
  paintMcpSnippets(taskState.current);

  // Save (Work Definition + Context)
  const form = container.querySelector("#task-edit-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitSave(container, form, taskState);
  });

  // Delete (dry_run -> execute)
  container.querySelector("#btn-delete-task").addEventListener("click", async () => {
    await showDeleteDialog(taskState.current);
  });
}

function paintMcpSnippets(task) {
  const startEl = document.getElementById("mcp-call-start");
  const reviewEl = document.getElementById("mcp-call-request-review");
  const finalizeEl = document.getElementById("mcp-call-finalize");
  if (!startEl) return; // Advanced section may be collapsed; HTML hidden, not removed
  startEl.textContent = JSON.stringify(
    { tool: "task_lifecycle", arguments: { action: "start", taskId: task.id } },
    null,
    2
  );
  reviewEl.textContent = JSON.stringify(
    {
      tool: "task_lifecycle",
      arguments: { action: "request_review", taskId: task.id, reviewQuestion: "<question>" },
    },
    null,
    2
  );
  finalizeEl.textContent = JSON.stringify(
    {
      tool: "task_lifecycle",
      arguments: {
        action: "finalize",
        taskId: task.id,
        expectedVersion: task.version ?? 1,
        result: { verdict: "pass", summary: "<summary>", lessonsLearned: "<lesson>" },
      },
    },
    null,
    2
  );
}

function collectUpdates(form) {
  const fd = new FormData(form);
  const updates = {};
  for (const f of EDITABLE_FIELDS) {
    const v = fd.get(f.key);
    if (v !== null) updates[f.key] = v;
  }
  return updates;
}

async function submitSave(container, form, taskState) {
  const updates = collectUpdates(form);
  const t = taskState.current;
  const body = {
    action: "update",
    taskId: t.id,
    expectedVersion: t.version ?? 1,
    ...updates,
  };

  try {
    const outcome = await postWithConflictResolution("/api/tasks/edit", body, {
      localTask: t,
      fieldsToCompare: EDITABLE_FIELDS.map((f) => f.key),
      buildRetryBody: (serverTask) => ({
        action: "update",
        taskId: serverTask.id,
        expectedVersion: serverTask.version ?? 1,
        ...updates,
      }),
    });
    if (outcome.status === "cancelled") {
      toast.info?.("Save cancelled — your edits are still unsaved.") ??
        toast.success("Save cancelled");
      return;
    }
    if (outcome.status === "reloaded") {
      toast.success("Reloaded server copy");
      // Re-mount the page from scratch so all sections reflect the
      // server state without leaking local edits.
      location.reload();
      return;
    }
    const newTask = outcome.result?.task;
    if (newTask) {
      taskState.current = newTask;
      paintMcpSnippets(newTask);
    }
    toast.success(`Saved (v${newTask?.version ?? "?"})`);
  } catch (err) {
    toast.error("Save failed: " + err.message);
  }
}

async function showDeleteDialog(task) {
  // 1. dry_run
  let dryRun;
  try {
    dryRun = await api.post("/api/tasks/delete", {
      action: "delete_one",
      mode: "dry_run",
      taskId: task.id,
    });
  } catch (err) {
    toast.error("Dry-run failed: " + err.message);
    return;
  }

  const affectedCount = dryRun?.affectedTaskCount ?? 1;
  const sample = dryRun?.affectedTaskSample ?? [
    { id: task.id, name: task.name, status: task.status },
  ];

  // 2. Render preview modal
  const root = document.getElementById("modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
        <div class="modal modal-md">
            <div class="modal-header"><h3>Delete this task?</h3></div>
            <div class="modal-body">
                <p>
                    Dry-run preview from <code>task_delete(mode='dry_run')</code>.
                    Re-confirm with a reason to actually execute — the server will write an audit entry.
                </p>
                <p>
                    <strong>Affected:</strong> ${affectedCount} task${affectedCount === 1 ? "" : "s"}.
                </p>
                <table class="diff-table">
                    <thead><tr><th>Task</th><th>Name</th><th>Status</th></tr></thead>
                    <tbody>
                        ${sample
                          .map(
                            (s) => `
                            <tr>
                                <td class="muted tiny">${escapeHtml(s.id)}</td>
                                <td>${escapeHtml(s.name || "")}</td>
                                <td>${escapeHtml(s.status || "")}</td>
                            </tr>
                        `
                          )
                          .join("")}
                    </tbody>
                </table>
                <div class="field-block" style="margin-top: var(--space-3);">
                    <label class="label">Reason (≥ 10 chars, recorded in audit log)</label>
                    <input class="input" id="delete-reason" />
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                <button class="btn btn-danger"   data-action="execute">Delete</button>
            </div>
        </div>
    `;
  root.appendChild(wrap);

  return new Promise((resolve) => {
    wrap.querySelector('[data-action="cancel"]').addEventListener("click", () => {
      wrap.remove();
      resolve();
    });
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) {
        wrap.remove();
        resolve();
      }
    });
    wrap.querySelector('[data-action="execute"]').addEventListener("click", async () => {
      const reason = (wrap.querySelector("#delete-reason").value || "").trim();
      if (reason.length < 10) {
        toast.error("Reason must be at least 10 characters.");
        return;
      }
      try {
        await api.post("/api/tasks/delete", {
          action: "delete_one",
          mode: "execute",
          taskId: task.id,
          reason,
          confirm: true,
        });
        toast.success("Task deleted");
        wrap.remove();
        location.hash = "#/tasks";
        resolve();
      } catch (err) {
        toast.error("Delete failed: " + err.message);
      }
    });
  });
}

async function loadFindings(container, task) {
  const panel = container.querySelector("#findings-panel");
  if (!panel) return;
  try {
    const ctx = await api.post("/api/context", {
      type: "findings",
      taskId: task.id,
      limit: 25,
    });
    const items = ctx.findings || [];
    if (!items.length) {
      panel.innerHTML = `<p class="placeholder tiny">No findings recorded for this task yet. Use <code>artifact_record</code> to add evidence, commits, PRs, or test logs.</p>`;
      return;
    }
    panel.innerHTML = `
            <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap: var(--space-2);">
                ${items
                  .map(
                    (f) => `
                    <li style="border:1px solid var(--border); border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);">
                        <div style="display:flex; gap: var(--space-2); align-items:center;">
                            <span class="badge badge-default">${escapeHtml(f.kind || "finding")}</span>
                            ${f.type ? `<span class="muted tiny">${escapeHtml(f.type)}</span>` : ""}
                            <span class="muted tiny" style="margin-left:auto;">${escapeHtml(f.createdAt || "")}</span>
                        </div>
                        <pre class="diff-cell" style="margin-top:6px;">${escapeHtml(stringify(f.content))}</pre>
                    </li>
                `
                  )
                  .join("")}
            </ul>
            ${ctx.truncated ? `<p class="muted tiny">Truncated — full list available via <code>context_get(type='findings')</code>.</p>` : ""}
        `;
  } catch (err) {
    panel.innerHTML = `<p class="placeholder tiny error">Failed to load findings: ${escapeHtml(err.message)}</p>`;
  }
}

function stringify(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

async function loadConversation(container, id) {
  const wrap = container.querySelector("#conversation-list");
  if (!wrap) return;
  try {
    const { conversationHistory } = await api.get(
      `/api/tasks/${encodeURIComponent(id)}/conversation`
    );
    if (!conversationHistory || !conversationHistory.length) {
      wrap.innerHTML = `<p class="placeholder tiny">No conversation history yet. Run this task via MCP to record the conversation.</p>`;
      return;
    }
    wrap.innerHTML = conversationHistory
      .map(
        (e) => `
            <div class="conversation-entry">
                <div class="role">${escapeHtml(e.role)}${e.toolName ? ` · ${escapeHtml(e.toolName)}` : ""}</div>
                <pre>${escapeHtml(typeof e.content === "string" ? e.content : JSON.stringify(e.content, null, 2))}</pre>
            </div>
        `
      )
      .join("");
  } catch (err) {
    wrap.innerHTML = `<p class="placeholder tiny error">Failed to load history: ${escapeHtml(err.message)}</p>`;
  }
}
