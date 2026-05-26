/**
 * Projects list — Phase 1 Group 11.6 dry-run delete flow.
 *
 * The legacy `confirm()` + DELETE-by-id flow is gone. Delete now hits
 * `POST /api/projects/delete` with `mode='dry_run'` first to show the
 * caller exactly how many tasks (and which ones) will go, then
 * requires a `reason ≥ 10` and an explicit confirm before executing.
 */

import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml, formatRelative } from "../lib/utils.js";

export async function mount(container) {
  container.innerHTML = `
        <div class="page-header">
            <div>
                <h1>Projects</h1>
                <div class="page-subtitle">Each project owns its own tasks. Agents use <code>project_view(action='active')</code> with their <code>clientId</code> to find the active project.</div>
            </div>
        </div>
        <div class="grid-cards" id="projects-grid"><p class="placeholder">Loading…</p></div>
    `;

  try {
    const { projects } = await api.get("/api/projects");
    if (!projects.length) {
      document.getElementById("projects-grid").innerHTML =
        `<div class="page-empty" style="grid-column: 1/-1;">
                <h3>No projects yet</h3>
                <p>Connect an MCP client and call <code>project_edit(action='create')</code> to create one.</p>
            </div>`;
      return;
    }
    document.getElementById("projects-grid").innerHTML = projects
      .map(
        (p) => `
            <div class="entity-card">
                <div class="entity-card-head">
                    <a class="entity-card-title" href="#/projects/${encodeURIComponent(p.id)}">${escapeHtml(p.name)}</a>
                    <span class="badge badge-default">${p.taskCount || 0} tasks</span>
                </div>
                <div class="entity-card-meta">${escapeHtml(p.description || "No description")}</div>
                ${p.path ? `<div class="muted tiny">${escapeHtml(p.path)}</div>` : ""}
                ${
                  p.techStack && p.techStack.length
                    ? `<div class="entity-card-stats">${p.techStack
                        .slice(0, 5)
                        .map((s) => `<span class="badge badge-default">${escapeHtml(s)}</span>`)
                        .join("")}</div>`
                    : ""
                }
                <div class="entity-card-stats"><span class="muted">${escapeHtml(formatRelative(p.updatedAt))}</span></div>
                <div class="entity-card-actions">
                    <a class="btn btn-sm btn-secondary" href="#/projects/${encodeURIComponent(p.id)}">Open</a>
                    <button class="btn btn-sm btn-danger" data-id="${escapeHtml(p.id)}" data-name="${escapeHtml(p.name)}">Delete…</button>
                </div>
            </div>
        `
      )
      .join("");

    document.querySelectorAll(".entity-card-actions [data-id]").forEach((b) =>
      b.addEventListener("click", async () => {
        await showProjectDeleteDialog(b.dataset.id, b.dataset.name, container);
      })
    );
  } catch (err) {
    document.getElementById("projects-grid").innerHTML =
      `<p class="placeholder error">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}

async function showProjectDeleteDialog(projectId, projectName, container) {
  // 1. Dry-run to show the blast radius.
  let dryRun;
  try {
    dryRun = await api.post("/api/projects/delete", {
      mode: "dry_run",
      projectId,
    });
  } catch (err) {
    toast.error("Dry-run failed: " + err.message);
    return;
  }

  const affectedTasks = dryRun?.affectedTaskCount ?? 0;
  const sample = dryRun?.affectedTaskSample ?? [];

  const root = document.getElementById("modal-root");
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.innerHTML = `
        <div class="modal modal-md">
            <div class="modal-header"><h3>Delete project "${escapeHtml(projectName)}"?</h3></div>
            <div class="modal-body">
                <p>
                    Dry-run preview from <code>project_delete(mode='dry_run')</code>.
                    Re-confirm with a reason to execute — the server will write an audit entry.
                </p>
                <p>
                    <strong>Affected:</strong> ${affectedTasks} task${affectedTasks === 1 ? "" : "s"}
                    will be deleted alongside the project.
                </p>
                ${
                  sample.length
                    ? `
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
                `
                    : ""
                }
                <div class="field-block" style="margin-top: var(--space-3);">
                    <label class="label">Reason (≥ 10 chars, recorded in audit log)</label>
                    <input class="input" id="proj-delete-reason" />
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" data-action="cancel">Cancel</button>
                <button class="btn btn-danger"   data-action="execute">Delete project</button>
            </div>
        </div>
    `;
  root.appendChild(wrap);

  wrap.querySelector('[data-action="cancel"]').addEventListener("click", () => wrap.remove());
  wrap.addEventListener("click", (e) => {
    if (e.target === wrap) wrap.remove();
  });
  wrap.querySelector('[data-action="execute"]').addEventListener("click", async () => {
    const reason = (wrap.querySelector("#proj-delete-reason").value || "").trim();
    if (reason.length < 10) {
      toast.error("Reason must be at least 10 characters.");
      return;
    }
    try {
      await api.post("/api/projects/delete", {
        mode: "execute",
        projectId,
        reason,
        confirm: true,
      });
      toast.success("Project deleted");
      wrap.remove();
      mount(container);
    } catch (err) {
      toast.error("Delete failed: " + err.message);
    }
  });
}
