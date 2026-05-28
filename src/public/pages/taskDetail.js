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
import { escapeHtml, statusKey, statusLabel, formatDate, formatRelative } from "../lib/utils.js";
import { postWithConflictResolution } from "../lib/conflict.js";
import { renderTaskTree } from "../components/treeView.js";

// Wave 4 §10.H — `notes` is intentionally NOT in this list: it is an
// append-only audit trail edited via task_edit(action='append_note'),
// not the update path. Putting it back here would overwrite the trail.
const EDITABLE_FIELDS = [
  { key: "name", label: "Name", rows: 1, section: "work" },
  { key: "description", label: "Description", rows: 4, section: "work" },
  { key: "implementationGuide", label: "Implementation Guide", rows: 4, section: "work" },
  { key: "verificationCriteria", label: "Verification Criteria", rows: 3, section: "work" },
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
  let lock = null;
  try {
    // Wave 4 §10.B/§10.C — the view endpoint returns the task PLUS the
    // resolved `lock` field (and recovers expired claims at read time).
    const res = await api.post("/api/tasks/view", { action: "get", taskId: id });
    task = res.task;
    lock = res.lock ?? null;
  } catch (err) {
    container.innerHTML = `<div class="page-empty error"><h2>Task not found</h2><p>${escapeHtml(err.message)}</p><a class="btn btn-primary" href="#/tasks">Back to tasks</a></div>`;
    return;
  }

  render(container, task, lock);
  attachHandlers(container, task, lock);
  void loadFindings(container, task);
  void loadSubtasks(container, task);
}

function render(container, task, lock) {
  container.innerHTML = `
        <div class="page-header">
            <div>
                <h1>${escapeHtml(task.name)}</h1>
                <div class="page-subtitle">
                    <span class="badge badge-${statusKey(task.status).replace(/_/g, "-")}">${escapeHtml(statusLabel(task.status))}</span>
                    <span class="muted">· Updated ${escapeHtml(formatDate(task.updatedAt))}</span>
                    <span class="muted">· v${escapeHtml(String(task.version ?? 1))}</span>
                    ${renderLockBadge(lock)}
                </div>
            </div>
            <div class="page-actions">
                <a class="btn btn-secondary" href="#/tasks">Back</a>
                ${lock ? `<button class="btn btn-secondary" id="btn-force-release" title="Drop another agent's claim">Force release</button>` : ""}
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

        <!-- ── Wave 4 §10.B — Subtasks (rendered only when children exist) -->
        <div id="subtasks-card"></div>

        <!-- ── Wave 4 §10.H — Notes audit log (append-only) ───────────── -->
        ${renderNotesAuditCard(task)}
    `;
}

/**
 * Wave 4 §10.C — lock badge. `lock` is the top-level field from
 * task_view(action='get'): { heldBy, since, expiresAt } | null.
 */
function renderLockBadge(lock) {
  if (!lock) return "";
  const since = lock.since ? formatRelative(lock.since) : "";
  return `<span class="lock-badge" title="Claimed by ${escapeHtml(lock.heldBy)}${lock.expiresAt ? ` · expires ${formatDate(lock.expiresAt)}` : ""}">🔒 ${escapeHtml(lock.heldBy)}${since ? ` · ${escapeHtml(since)}` : ""}</span>`;
}

/**
 * Wave 4 §10.H — render the append-only notes trail newest-first plus an
 * append composer. Entries are split on leading `[…]` brackets; any ISO
 * timestamp inside the bracket drives the sort (entries without one sink
 * to the bottom in original order).
 */
function renderNotesAuditCard(task) {
  const entries = parseNotes(task.notes || "");
  const list = entries.length
    ? `<ul class="notes-audit">
        ${entries
          .map(
            (e) => `
          <li class="notes-entry">
            ${e.ts ? `<span class="notes-ts muted tiny">${escapeHtml(formatDate(e.ts))}</span>` : ""}
            <div class="notes-text">${escapeHtml(e.text)}</div>
          </li>`
          )
          .join("")}
      </ul>`
    : `<p class="placeholder tiny">No notes yet. Append context, decisions, or course-corrections below — the trail is append-only.</p>`;

  return `
    <div class="card" id="notes-audit-card">
      <h4>Notes (audit log)</h4>
      ${list}
      <div class="field-block" style="margin-top: var(--space-3);">
        <textarea class="textarea" id="note-composer" rows="2" placeholder="Append a note (pushback, scope change, course-correction, blocker resolution)…"></textarea>
        <div class="page-actions" style="justify-content:flex-end; margin-top: var(--space-2);">
          <button class="btn btn-secondary" id="btn-append-note">Append note</button>
        </div>
      </div>
    </div>`;
}

/**
 * Parse the heterogeneous notes string into ordered entries. append_note
 * blocks are `[<iso>] text`; lifecycle tags are `[blocked: …]`,
 * `[released <iso> by …]`, `[abandoned <iso>, …]`, etc. We split on a
 * `[` that starts a line, pull the first ISO-8601 timestamp out of each
 * entry for sorting, and present newest-first.
 */
function parseNotes(notes) {
  if (!notes || !notes.trim()) return [];
  const chunks = notes
    .split(/\n(?=\[)/) // split before any line beginning with "["
    .map((c) => c.trim())
    .filter(Boolean);
  const isoRe = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?/;
  const entries = chunks.map((text, i) => {
    const m = text.match(isoRe);
    return { ts: m ? new Date(m[0]) : null, text, _i: i };
  });
  entries.sort((a, b) => {
    if (a.ts && b.ts) return b.ts - a.ts;
    if (a.ts) return -1;
    if (b.ts) return 1;
    return a._i - b._i;
  });
  return entries;
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

function attachHandlers(container, taskInitial, lock) {
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

  // Wave 4 §10.B — Force release (admin override of another agent's claim)
  const forceBtn = container.querySelector("#btn-force-release");
  if (forceBtn) {
    forceBtn.addEventListener("click", async () => {
      const heldBy = lock?.heldBy ?? "another agent";
      if (!confirm(`Force-release this task? It is currently claimed by ${heldBy}.`)) return;
      try {
        await api.post("/api/tasks/lifecycle", {
          action: "release",
          taskId: taskState.current.id,
          force: true,
          note: "Force-released from the dashboard",
        });
        toast.success("Claim released");
        location.reload();
      } catch (err) {
        toast.error("Force release failed: " + err.message);
      }
    });
  }

  // Wave 4 §10.H — append a note (append-only audit trail)
  wireAppendNote(container, taskState);
}

/**
 * Wire the append-note button. Re-callable: after a successful append we
 * re-render the audit card in place (preserving unsaved form edits) and
 * re-bind, so this function attaches to whichever button is current.
 */
function wireAppendNote(container, taskState) {
  const btn = container.querySelector("#btn-append-note");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    const composer = container.querySelector("#note-composer");
    const text = (composer.value || "").trim();
    if (!text) {
      toast.error("Note is empty.");
      return;
    }
    btn.disabled = true;
    try {
      const res = await api.post("/api/tasks/edit", {
        action: "append_note",
        taskId: taskState.current.id,
        text,
        expectedVersion: taskState.current.version ?? 1,
      });
      const newTask = res.task;
      if (newTask) {
        taskState.current = newTask;
        const card = container.querySelector("#notes-audit-card");
        const fresh = document.createElement("div");
        fresh.innerHTML = renderNotesAuditCard(newTask);
        card.replaceWith(fresh.firstElementChild);
        wireAppendNote(container, taskState); // re-bind to the new button
        paintMcpSnippets(newTask);
      }
      toast.success("Note appended");
    } catch (err) {
      if (err.status === 409 || err.body?.code === "CONFLICT") {
        toast.error("Version conflict — reload the task and try again.");
      } else {
        toast.error("Append failed: " + err.message);
      }
    } finally {
      btn.disabled = false;
    }
  });
}

/**
 * Wave 4 §10.B — render the subtask tree when the task has children.
 * §10.D guarantees one-level nesting, so children are leaves. We build
 * the roots array from the project's task list filtered by
 * parentTaskId.
 */
async function loadSubtasks(container, task) {
  const host = container.querySelector("#subtasks-card");
  if (!host) return;
  try {
    const { tasks } = await api.get("/api/tasks");
    const children = tasks
      .filter((t) => t.parentTaskId === task.id)
      .map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        groupId: t.groupId ?? null,
        parentTaskId: t.parentTaskId ?? null,
        children: [],
      }));
    if (!children.length) {
      host.innerHTML = "";
      return;
    }
    host.innerHTML = `
      <div class="card">
        <h4>Subtasks (${children.length})</h4>
        ${renderTaskTree(children)}
      </div>`;
  } catch {
    host.innerHTML = "";
  }
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
