/**
 * Project detail page — redesigned UI (skill · groups · tasks).
 *
 * Layout (all markup scoped under `.project-detail` so restyles never
 * leak into the shared dashboard / skills-page styles):
 *   - Page header — title, description, Back / Delete actions.
 *   - Overview hero — completion donut + status stat tiles + a single
 *     segmented progress bar showing the task-status distribution.
 *   - Two-column body (collapses < 1100px):
 *       · Main  — Groups grid (each tile carries its own progress bar),
 *         the Available-tasks feed (group-filter pills), and the
 *         All-tasks table.
 *       · Side  — Project Skill card + Plan-upload dropzone.
 *
 * Behaviour is unchanged from the Phase-1 / Wave-4 implementation: every
 * element id, data-attribute and event hook the handlers rely on
 * (`#btn-delete-project`, `#group-filter`, `#available-list`,
 * `#plan-upload-host`, `.skill-ref[data-topic]`, `.skill-ref-body`) is
 * preserved verbatim.
 */

import { api, isLlmConfigured } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml, statusKey, statusLabel, formatDate } from "../lib/utils.js";
import { mountPlanUpload } from "../components/planUpload.js";

let currentGroupFilter = null; // null = all groups

export async function mount(container, { params }) {
  container.innerHTML = `<p class="placeholder">Loading project…</p>`;
  currentGroupFilter = null;
  const projectId = params.id;

  let project;
  try {
    const res = await api.get(`/api/projects/${encodeURIComponent(projectId)}`);
    project = res.project;
  } catch (err) {
    container.innerHTML = `<div class="page-empty error"><h2>Project not found</h2><p>${escapeHtml(err.message)}</p><a class="btn btn-primary" href="#/projects">Back to projects</a></div>`;
    return;
  }

  // Load everything the page needs in parallel; each falls back to a
  // safe empty so a single failing call never blanks the whole page.
  const [{ tasks }, groupsRes, skillRes, llmReady] = await Promise.all([
    api.get("/api/tasks").catch(() => ({ tasks: [] })),
    api.post("/api/projects/view", { action: "groups_list", projectId }).catch(() => ({
      groups: [],
      ungroupedTaskCounts: {},
    })),
    api.post("/api/context", { type: "skill_index", projectId }).catch(() => ({ skill: null })),
    isLlmConfigured(),
  ]);

  const ownTasks = tasks.filter((t) => t.projectId === project.id);
  render(container, { project, tasks: ownTasks, groupsRes, skillRes, llmReady });
}

function render(container, { project, tasks, groupsRes, skillRes, llmReady }) {
  const counts = {
    pending: tasks.filter((t) => statusKey(t.status) === "pending").length,
    in_progress: tasks.filter((t) => /in[_ ]progress/i.test(t.status)).length,
    completed: tasks.filter((t) => statusKey(t.status) === "completed").length,
    blocked: tasks.filter((t) => statusKey(t.status) === "blocked").length,
  };

  container.innerHTML = `
    <div class="project-detail">
      <div class="page-header">
        <div>
          <h1>${escapeHtml(project.name)}</h1>
          <div class="page-subtitle">${escapeHtml(project.description || "No description")}</div>
        </div>
        <div class="page-actions">
          <a class="btn btn-secondary" href="#/projects">Back</a>
          <button class="btn btn-danger" id="btn-delete-project">Delete</button>
        </div>
      </div>

      ${renderOverview(counts, tasks.length)}

      <div class="pd-layout">
        <div class="pd-main">
          ${renderGroupsCard(project, groupsRes)}

          <section class="card pd-section">
            <div class="pd-section-head">
              <h4>Available tasks</h4>
              <div class="pill-row" id="group-filter"></div>
            </div>
            <div id="available-list"><p class="placeholder tiny">Loading…</p></div>
          </section>

          <section class="card pd-section">
            <div class="pd-section-head">
              <h4>All tasks</h4>
              <span class="pd-count-pill">${tasks.length}</span>
            </div>
            ${renderTaskTable(tasks)}
          </section>
        </div>

        <aside class="pd-side">
          ${renderSkillCard(project, skillRes)}

          <section class="card pd-section">
            <div class="pd-section-head">
              <h4><span class="pd-head-icon">📤</span>Upload a plan</h4>
            </div>
            <p class="muted tiny pd-section-hint">Drop a Markdown plan to generate a group of tasks with an LLM.</p>
            <div id="plan-upload-host"></div>
          </section>
        </aside>
      </div>
    </div>
  `;

  // Delete project (unchanged behaviour)
  container.querySelector("#btn-delete-project").addEventListener("click", async () => {
    if (!confirm(`Delete project "${project.name}" and all of its tasks?`)) return;
    try {
      await api.del(`/api/projects/${encodeURIComponent(project.id)}`);
      toast.success("Project deleted");
      location.hash = "#/projects";
    } catch (err) {
      toast.error("Delete failed: " + err.message);
    }
  });

  // Skill reference lazy-loaders
  wireSkillRefs(container, project.id);

  // Group filter pills + available list
  renderGroupFilter(container, project.id, groupsRes.groups || []);
  void loadAvailable(container, project.id);

  // Plan-upload widget
  mountPlanUpload(container.querySelector("#plan-upload-host"), {
    projectId: project.id,
    providerConfigured: llmReady,
    onCommitted: (result) => {
      if (result.groupId)
        location.hash = `#/groups/${encodeURIComponent(result.groupId)}?project=${encodeURIComponent(project.id)}`;
      else mount(container, { params: { id: project.id } }); // refresh in place
    },
  });
}

// ── Status math shared by the overview hero + group tiles ─────────────

function normalizeCounts(taskCounts) {
  const out = { completed: 0, in_progress: 0, blocked: 0, pending: 0, other: 0 };
  for (const [k, v] of Object.entries(taskCounts || {})) {
    const key = statusKey(k);
    if (key in out) out[key] += v;
    else out.other += v;
  }
  return out;
}

/**
 * Build the inner spans of a stacked status bar from a counts object.
 * Returns `{ html, total, done, pct }` so callers can also show a %.
 */
function progressFromCounts(taskCounts) {
  const n = normalizeCounts(taskCounts);
  const total = n.completed + n.in_progress + n.blocked + n.pending + n.other;
  if (!total) return { html: "", total: 0, done: 0, pct: 0 };
  const seg = (key, value) =>
    value > 0
      ? `<span class="pd-bar-seg pd-bar-${key.replace(/_/g, "-")}" style="width:${((value / total) * 100).toFixed(3)}%" title="${value} ${escapeHtml(statusLabel(key))}"></span>`
      : "";
  const html =
    seg("completed", n.completed) +
    seg("in_progress", n.in_progress) +
    seg("blocked", n.blocked) +
    seg("pending", n.pending) +
    seg("other", n.other);
  return { html, total, done: n.completed, pct: Math.round((n.completed / total) * 100) };
}

function statusChips(taskCounts) {
  const n = normalizeCounts(taskCounts);
  const items = [
    ["completed", "Done"],
    ["in_progress", "In progress"],
    ["blocked", "Blocked"],
    ["pending", "Pending"],
  ]
    .filter(([k]) => n[k] > 0)
    .map(
      ([k, label]) =>
        `<span class="pd-chip pd-chip-${k.replace(/_/g, "-")}"><span class="pd-dot"></span>${n[k]} ${label}</span>`
    );
  if (n.other > 0)
    items.push(`<span class="pd-chip"><span class="pd-dot"></span>${n.other} other</span>`);
  return items.length ? items.join("") : `<span class="muted tiny">no tasks</span>`;
}

function renderOverview(counts, total) {
  const { html: bar, pct } = progressFromCounts(counts);
  const tile = (key, label) => `
    <div class="pd-stat pd-stat-${key.replace(/_/g, "-")}">
      <span class="pd-stat-num">${counts[key]}</span>
      <span class="pd-stat-label"><span class="pd-dot"></span>${label}</span>
    </div>`;
  return `
    <section class="card pd-overview">
      <div class="pd-ring" style="--pct:${pct}" role="img" aria-label="${pct}% of tasks complete">
        <span class="pd-ring-label">${pct}<small>%</small></span>
      </div>
      <div class="pd-overview-body">
        <div class="pd-overview-title">
          ${total ? `<strong>${counts.completed}</strong> of <strong>${total}</strong> tasks complete` : "No tasks yet"}
        </div>
        <div class="pd-stats">
          ${tile("pending", "Pending")}
          ${tile("in_progress", "In progress")}
          ${tile("completed", "Completed")}
          ${tile("blocked", "Blocked")}
        </div>
        <div class="pd-bar" aria-hidden="true">${bar || `<span class="pd-bar-empty"></span>`}</div>
      </div>
    </section>`;
}

function renderSkillCard(project, skillRes) {
  const skillsHref = `#/skills?project=${encodeURIComponent(project.id)}`;
  if (!skillRes || !skillRes.skill) {
    return `
      <section class="card pd-section pd-skill-card">
        <div class="pd-section-head">
          <h4><span class="pd-head-icon">🧠</span>Project Skill</h4>
          <a class="btn btn-sm btn-secondary" href="${skillsHref}">Open Skills</a>
        </div>
        <div class="pd-empty">
          <div class="pd-empty-icon">🧠</div>
          <p class="muted tiny">No skill compiled yet. Once a couple of lessons / decisions are recorded, compile one from the Skills page.</p>
        </div>
      </section>`;
  }
  const s = skillRes.skill;
  const refs = skillRes.references || [];
  const preview = (s.body || "").slice(0, 600);
  return `
    <section class="card pd-section pd-skill-card">
      <div class="pd-section-head">
        <h4><span class="pd-head-icon">🧠</span>Project Skill</h4>
        <a class="btn btn-sm btn-secondary" href="${skillsHref}">Open Skills</a>
      </div>
      <div class="pd-meta-chips">
        <span class="pd-meta-chip">Compiled ${escapeHtml(formatDate(s.compiledAt))}</span>
        <span class="pd-meta-chip">${escapeHtml(String(s.tokenCount ?? "?"))} tokens</span>
      </div>
      <pre class="skill-body-text">${escapeHtml(preview)}${(s.body || "").length > 600 ? "\n…" : ""}</pre>
      ${
        refs.length
          ? `<div class="skill-refs">${refs
              .map(
                (r) =>
                  `<details class="skill-ref" data-topic="${escapeHtml(r.topic)}"><summary>${escapeHtml(r.topic)}</summary><div class="skill-ref-body"><span class="placeholder tiny">Expand to load…</span></div></details>`
              )
              .join("")}</div>`
          : ""
      }
    </section>`;
}

function wireSkillRefs(container, projectId) {
  container.querySelectorAll(".skill-ref").forEach((det) => {
    det.addEventListener(
      "toggle",
      async () => {
        if (!det.open || det.dataset.loaded === "true") return;
        det.dataset.loaded = "true";
        const slot = det.querySelector(".skill-ref-body");
        try {
          const sec = await api.post("/api/context", {
            type: "skill_section",
            projectId,
            topic: det.dataset.topic,
          });
          slot.innerHTML = `<pre class="skill-body-text">${escapeHtml(sec.content || "")}</pre>`;
        } catch (err) {
          det.dataset.loaded = "false";
          slot.innerHTML = `<p class="placeholder tiny error">Failed: ${escapeHtml(err.message)}</p>`;
        }
      },
      { passive: true }
    );
  });
}

// feature-hierarchy: one section group rendered as a tile, prefixed with its
// derived `<g>` number when present.
function groupTile(project, g) {
  const { html: bar, total, pct } = progressFromCounts(g.taskCounts || {});
  const num = g.displayNumber
    ? `<span class="group-tile-num muted tiny">${escapeHtml(String(g.displayNumber))}</span> `
    : "";
  return `
    <a class="group-tile" href="#/groups/${encodeURIComponent(g.id)}?project=${encodeURIComponent(project.id)}">
      <div class="group-tile-top">
        <span class="group-tile-name">${num}${escapeHtml(g.name)}</span>
        ${total ? `<span class="group-tile-pct">${pct}%</span>` : ""}
      </div>
      <div class="pd-bar pd-bar-sm" aria-hidden="true">${bar || `<span class="pd-bar-empty"></span>`}</div>
      <div class="group-tile-counts">${statusChips(g.taskCounts || {})}</div>
    </a>`;
}

function renderGroupsCard(project, groupsRes) {
  // groups_list now returns features (top-level) each with nested `children`.
  const features = groupsRes.groups || [];
  const ungrouped = groupsRes.ungroupedTaskCounts || {};
  const ungroupedTotal = Object.values(ungrouped).reduce((a, b) => a + b, 0);
  // Count leaf section groups (a feature's children, or a standalone group).
  const leafCount = features.reduce(
    (n, f) => n + (f.children && f.children.length ? f.children.length : 1),
    0
  );
  if (!features.length) {
    return `
      <section class="card pd-section">
        <div class="pd-section-head"><h4><span class="pd-head-icon">🗂️</span>Features &amp; groups</h4></div>
        <div class="pd-empty">
          <div class="pd-empty-icon">🗂️</div>
          <p class="muted tiny">No features yet${ungroupedTotal ? ` · ${ungroupedTotal} ungrouped task${ungroupedTotal === 1 ? "" : "s"}` : ""}. Upload a plan with a <code># Feature: …</code> header to create one.</p>
        </div>
      </section>`;
  }
  return `
    <section class="card pd-section">
      <div class="pd-section-head">
        <h4><span class="pd-head-icon">🗂️</span>Features &amp; groups</h4>
        <span class="pd-count-pill">${leafCount}</span>
      </div>
      ${features
        .map((f) => {
          const children = f.children || [];
          if (children.length) {
            return `
            <div class="feature-block">
              <div class="feature-head">
                <span class="badge badge-default">feature</span>
                <span class="feature-name">${escapeHtml(f.name)}</span>
              </div>
              <div class="group-grid">
                ${children.map((c) => groupTile(project, c)).join("")}
              </div>
            </div>`;
          }
          // Standalone manual group (no parent feature) → single tile.
          return `<div class="group-grid">${groupTile(project, f)}</div>`;
        })
        .join("")}
      ${ungroupedTotal ? `<p class="muted tiny pd-ungrouped-note">${ungroupedTotal} ungrouped task${ungroupedTotal === 1 ? "" : "s"}.</p>` : ""}
    </section>`;
}

function renderGroupFilter(container, projectId, features) {
  const host = container.querySelector("#group-filter");
  // Tasks live in leaf section groups, so flatten features → their children
  // (a standalone manual group is its own leaf).
  const leaves = [];
  for (const f of features) {
    if (f.children && f.children.length) leaves.push(...f.children);
    else leaves.push(f);
  }
  const pills = [
    { id: null, name: "All" },
    ...leaves.map((g) => ({
      id: g.id,
      name: g.displayNumber ? `${g.displayNumber} ${g.name}` : g.name,
    })),
  ];
  host.innerHTML = pills
    .map(
      (p) =>
        `<button class="pill ${(p.id || null) === currentGroupFilter ? "active" : ""}" data-group="${escapeHtml(p.id || "")}">${escapeHtml(p.name)}</button>`
    )
    .join("");
  host.querySelectorAll(".pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentGroupFilter = btn.dataset.group || null;
      host.querySelectorAll(".pill").forEach((b) => b.classList.toggle("active", b === btn));
      void loadAvailable(container, projectId);
    });
  });
}

async function loadAvailable(container, projectId) {
  const host = container.querySelector("#available-list");
  if (!host) return;
  host.innerHTML = `<p class="placeholder tiny">Loading…</p>`;
  try {
    const body = { action: "available", projectId };
    if (currentGroupFilter) body.groupId = currentGroupFilter;
    const res = await api.post("/api/tasks/view", body);
    const list = res.tasks || [];
    if (!list.length) {
      host.innerHTML = `<div class="pd-empty"><div class="pd-empty-icon">✅</div><p class="placeholder tiny">No available tasks. Try removing the group filter or finalizing in-progress tasks.</p></div>`;
      return;
    }
    host.innerHTML = `
      <ul class="available-list">
        ${list
          .map(
            (t) => `
          <li class="available-item ${t.lockedByOther ? "is-locked" : ""}" ${t.lockedByOther ? `aria-disabled="true" title="Locked by another agent"` : ""} data-id="${escapeHtml(t.id)}">
            <span class="pd-pri pd-pri-${priorityClass(t.priority)}">${escapeHtml(t.priority || "—")}</span>
            <span class="available-name">${escapeHtml(t.name)}</span>
            <span class="badge badge-${statusKey(t.status).replace(/_/g, "-")}">${escapeHtml(statusLabel(t.status))}</span>
            ${t.lockedByOther ? `<span class="muted tiny">🔒</span>` : `<span class="pd-row-go" aria-hidden="true">→</span>`}
          </li>`
          )
          .join("")}
      </ul>
      ${res.truncated ? `<p class="muted tiny pd-ungrouped-note">More available — refine the filter to see the rest.</p>` : ""}`;

    host.querySelectorAll(".available-item:not(.is-locked)").forEach((li) => {
      li.addEventListener("click", () => {
        location.hash = `#/tasks/${encodeURIComponent(li.dataset.id)}`;
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="placeholder tiny error">Failed to load available tasks: ${escapeHtml(err.message)}</p>`;
  }
}

function priorityClass(p) {
  const k = (p || "").toLowerCase();
  return ["critical", "high", "medium", "low"].includes(k) ? k : "none";
}

function renderTaskTable(tasks) {
  if (!tasks.length)
    return `<div class="pd-empty"><div class="pd-empty-icon">📋</div><p class="placeholder">No tasks for this project yet.</p></div>`;
  return `
    <table class="table pd-table">
      <thead><tr><th>#</th><th>Name</th><th>Priority</th><th>Status</th><th>Updated</th><th></th></tr></thead>
      <tbody>
        ${tasks
          .slice()
          .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
          .map(
            (t) => `
          <tr>
            <td class="muted tiny">${t.displayNumber ?? t.executionOrder ?? "—"}</td>
            <td><a href="#/tasks/${encodeURIComponent(t.id)}">${escapeHtml(t.name)}</a></td>
            <td><span class="pd-pri pd-pri-${priorityClass(t.priority)}">${escapeHtml(t.priority || "—")}</span></td>
            <td><span class="badge badge-${statusKey(t.status).replace(/_/g, "-")}">${escapeHtml(statusLabel(t.status))}</span></td>
            <td class="muted tiny">${escapeHtml(formatDate(t.updatedAt))}</td>
            <td><a class="btn btn-sm btn-secondary" href="#/tasks/${encodeURIComponent(t.id)}">Open</a></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}
