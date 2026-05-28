/**
 * Project detail page — extended for Wave 4 §10.B (4.5).
 *
 * Adds on top of the Phase-1 layout:
 *   - Project Skill card — context_get(type='skill_index'); body +
 *     collapsible references + a link to the full /skills page.
 *   - Groups section — project_view(action='groups_list') with per-group
 *     status counts; each group links to /groups/:gid?project=…
 *   - Group filter pills driving task_view(action='available', groupId);
 *     locked-by-other rows are dimmed + non-navigable.
 *   - Plan-upload dropzone (planUpload widget), disabled when no LLM
 *     provider is configured.
 */

import { api, isLlmConfigured } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml, statusKey, formatDate } from "../lib/utils.js";
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

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-value">${counts.pending}</div></div>
      <div class="stat-card"><div class="stat-label">In Progress</div><div class="stat-value">${counts.in_progress}</div></div>
      <div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value">${counts.completed}</div></div>
      <div class="stat-card"><div class="stat-label">Blocked</div><div class="stat-value">${counts.blocked}</div></div>
    </div>

    ${renderSkillCard(project, skillRes)}
    ${renderGroupsCard(project, groupsRes)}

    <div class="card">
      <div class="page-actions" style="justify-content: space-between; align-items:center;">
        <h4 style="margin:0;">Available tasks</h4>
        <div class="pill-row" id="group-filter"></div>
      </div>
      <div id="available-list"><p class="placeholder tiny">Loading…</p></div>
    </div>

    <div class="card">
      <h4>Upload a plan</h4>
      <div id="plan-upload-host"></div>
    </div>

    <h3 style="margin-top: var(--space-5);">All tasks (${tasks.length})</h3>
    ${renderTaskTable(tasks)}
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

function renderSkillCard(project, skillRes) {
  const skillsHref = `#/skills?project=${encodeURIComponent(project.id)}`;
  if (!skillRes || !skillRes.skill) {
    return `
      <div class="card">
        <div class="page-actions" style="justify-content: space-between; align-items:center;">
          <h4 style="margin:0;">Project Skill</h4>
          <a class="btn btn-sm btn-secondary" href="${skillsHref}">Open Skills</a>
        </div>
        <p class="muted tiny">No skill compiled yet. Once a couple of lessons/decisions are recorded, compile one from the Skills page.</p>
      </div>`;
  }
  const s = skillRes.skill;
  const refs = skillRes.references || [];
  const preview = (s.body || "").slice(0, 600);
  return `
    <div class="card">
      <div class="page-actions" style="justify-content: space-between; align-items:center;">
        <h4 style="margin:0;">Project Skill</h4>
        <a class="btn btn-sm btn-secondary" href="${skillsHref}">Open Skills</a>
      </div>
      <p class="muted tiny">Compiled ${escapeHtml(formatDate(s.compiledAt))} · ${escapeHtml(String(s.tokenCount ?? "?"))} tokens</p>
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
    </div>`;
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

function renderGroupsCard(project, groupsRes) {
  const groups = groupsRes.groups || [];
  const ungrouped = groupsRes.ungroupedTaskCounts || {};
  const ungroupedTotal = Object.values(ungrouped).reduce((a, b) => a + b, 0);
  if (!groups.length) {
    return `
      <div class="card">
        <h4>Groups</h4>
        <p class="muted tiny">No groups yet${ungroupedTotal ? ` · ${ungroupedTotal} ungrouped task${ungroupedTotal === 1 ? "" : "s"}` : ""}. Upload a plan with a <code># Feature: …</code> header to create one.</p>
      </div>`;
  }
  return `
    <div class="card">
      <h4>Groups (${groups.length})</h4>
      <div class="group-grid">
        ${groups
          .map((g) => {
            const chips = Object.entries(g.taskCounts || {})
              .map(([k, v]) => `<span class="badge badge-default">${escapeHtml(k)}: ${v}</span>`)
              .join(" ");
            return `
            <a class="group-tile" href="#/groups/${encodeURIComponent(g.id)}?project=${encodeURIComponent(project.id)}">
              <div class="group-tile-name">${escapeHtml(g.name)}</div>
              <div class="group-tile-counts">${chips || `<span class="muted tiny">no tasks</span>`}</div>
            </a>`;
          })
          .join("")}
      </div>
      ${ungroupedTotal ? `<p class="muted tiny" style="margin-top: var(--space-2);">${ungroupedTotal} ungrouped task${ungroupedTotal === 1 ? "" : "s"}.</p>` : ""}
    </div>`;
}

function renderGroupFilter(container, projectId, groups) {
  const host = container.querySelector("#group-filter");
  const pills = [{ id: null, name: "All" }, ...groups.map((g) => ({ id: g.id, name: g.name }))];
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
      host.innerHTML = `<p class="placeholder tiny">No available tasks. Try removing the group filter or finalizing in-progress tasks.</p>`;
      return;
    }
    host.innerHTML = `
      <ul class="available-list">
        ${list
          .map(
            (t) => `
          <li class="available-item ${t.lockedByOther ? "is-locked" : ""}" ${t.lockedByOther ? `aria-disabled="true" title="Locked by another agent"` : ""} data-id="${escapeHtml(t.id)}">
            <span class="available-priority badge badge-default">${escapeHtml(t.priority || "—")}</span>
            <span class="available-name">${escapeHtml(t.name)}</span>
            <span class="badge badge-${statusKey(t.status).replace(/_/g, "-")}">${escapeHtml(t.status)}</span>
            ${t.lockedByOther ? `<span class="muted tiny">🔒 locked</span>` : ""}
          </li>`
          )
          .join("")}
      </ul>
      ${res.truncated ? `<p class="muted tiny">More available — refine the filter to see the rest.</p>` : ""}`;

    host.querySelectorAll(".available-item:not(.is-locked)").forEach((li) => {
      li.addEventListener("click", () => {
        location.hash = `#/tasks/${encodeURIComponent(li.dataset.id)}`;
      });
    });
  } catch (err) {
    host.innerHTML = `<p class="placeholder tiny error">Failed to load available tasks: ${escapeHtml(err.message)}</p>`;
  }
}

function renderTaskTable(tasks) {
  if (!tasks.length) return `<p class="placeholder">No tasks for this project yet.</p>`;
  return `
    <table class="table">
      <thead><tr><th>#</th><th>Name</th><th>Status</th><th>Updated</th><th></th></tr></thead>
      <tbody>
        ${tasks
          .slice()
          .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
          .map(
            (t) => `
          <tr>
            <td class="muted tiny">${t.executionOrder ?? "—"}</td>
            <td><a href="#/tasks/${encodeURIComponent(t.id)}">${escapeHtml(t.name)}</a></td>
            <td><span class="badge badge-${statusKey(t.status).replace(/_/g, "-")}">${escapeHtml(t.status)}</span></td>
            <td class="muted tiny">${escapeHtml(formatDate(t.updatedAt))}</td>
            <td><a class="btn btn-sm btn-secondary" href="#/tasks/${encodeURIComponent(t.id)}">Open</a></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}
