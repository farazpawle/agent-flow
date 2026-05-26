import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml, statusKey, formatDate } from "../lib/utils.js";

export async function mount(container, { params }) {
  container.innerHTML = `<p class="placeholder">Loading project…</p>`;
  try {
    const { project } = await api.get(`/api/projects/${encodeURIComponent(params.id)}`);
    const { tasks } = await api.get("/api/tasks").catch(() => ({ tasks: [] }));
    const ownTasks = tasks.filter((t) => t.projectId === project.id);
    render(container, project, ownTasks);
  } catch (err) {
    container.innerHTML = `<div class="page-empty error"><h2>Project not found</h2><p>${escapeHtml(err.message)}</p><a class="btn btn-primary" href="#/projects">Back to projects</a></div>`;
  }
}

function render(container, project, tasks) {
  const counts = {
    pending: tasks.filter((t) => /pending/i.test(t.status)).length,
    in_progress: tasks.filter((t) => /in[_ ]progress/i.test(t.status)).length,
    completed: tasks.filter((t) => /completed/i.test(t.status)).length,
    blocked: tasks.filter((t) => /blocked/i.test(t.status)).length,
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

    <div class="card">
      <h4>Metadata</h4>
      <table class="table">
        <tbody>
          <tr><th>ID</th><td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(project.id)}</td></tr>
          ${project.path ? `<tr><th>Path</th><td>${escapeHtml(project.path)}</td></tr>` : ""}
          ${project.gitRemoteUrl ? `<tr><th>Git Remote</th><td><a href="${escapeHtml(project.gitRemoteUrl)}" target="_blank" rel="noopener">${escapeHtml(project.gitRemoteUrl)}</a></td></tr>` : ""}
          ${project.techStack && project.techStack.length ? `<tr><th>Tech Stack</th><td>${project.techStack.map((s) => `<span class="badge badge-default">${escapeHtml(s)}</span>`).join(" ")}</td></tr>` : ""}
          <tr><th>Updated</th><td>${escapeHtml(formatDate(project.updatedAt))}</td></tr>
        </tbody>
      </table>
    </div>

    <h3 style="margin-top: var(--space-5);">Tasks (${tasks.length})</h3>
    ${
      tasks.length
        ? `
      <table class="table">
        <thead><tr><th>#</th><th>Name</th><th>Status</th><th>Updated</th><th></th></tr></thead>
        <tbody>
          ${tasks
            .sort((a, b) => (a.executionOrder || 0) - (b.executionOrder || 0))
            .map(
              (t) => `
            <tr>
              <td class="muted tiny">${t.executionOrder ?? "—"}</td>
              <td><a href="#/tasks/${encodeURIComponent(t.id)}">${escapeHtml(t.name)}</a></td>
              <td><span class="badge badge-${statusKey(t.status).replace(/_/g, "-")}">${escapeHtml(t.status)}</span></td>
              <td class="muted tiny">${escapeHtml(formatDate(t.updatedAt))}</td>
              <td><a class="btn btn-sm btn-secondary" href="#/tasks/${encodeURIComponent(t.id)}">Open</a></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `
        : `<p class="placeholder">No tasks for this project yet.</p>`
    }
  `;

  document.getElementById("btn-delete-project").addEventListener("click", async () => {
    if (!confirm(`Delete project "${project.name}" and all of its tasks?`)) return;
    try {
      await api.del(`/api/projects/${encodeURIComponent(project.id)}`);
      toast.success("Project deleted");
      location.hash = "#/projects";
    } catch (err) {
      toast.error("Delete failed: " + err.message);
    }
  });
}
