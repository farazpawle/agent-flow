import { api, sse } from "../lib/api.js";
import { escapeHtml, statusKey, formatRelative } from "../lib/utils.js";

const DEPRECATION_LOG_LIMIT = 20;

let stream = null;
let deprecationEntries = [];

export async function mount(container) {
  container.innerHTML = `
        <div class="page-header">
            <div>
                <h1>Dashboard</h1>
                <div class="page-subtitle">Overview of your projects and tasks.</div>
            </div>
            <div class="dashboard-quick-actions">
                <a class="btn btn-secondary" href="#/tasks">View Tasks</a>
                <a class="btn btn-primary" href="#/projects">View Projects</a>
            </div>
        </div>

        <div class="stat-grid" id="stat-grid">
            <div class="stat-card"><div class="stat-label">Projects</div><div class="stat-value" id="stat-projects">—</div></div>
            <div class="stat-card"><div class="stat-label">Tasks · Pending</div><div class="stat-value" id="stat-pending">—</div></div>
            <div class="stat-card"><div class="stat-label">Tasks · In Progress</div><div class="stat-value" id="stat-in-progress">—</div></div>
            <div class="stat-card"><div class="stat-label">Tasks · Completed</div><div class="stat-value" id="stat-completed">—</div></div>
            <div class="stat-card"><div class="stat-label">Agents Online</div><div class="stat-value" id="stat-agents">—</div></div>
        </div>

        <div class="split-layout">
            <div>
                <div class="card-header"><h3>Recent Tasks</h3><a href="#/tasks" class="muted tiny">See all →</a></div>
                <div class="activity-list" id="recent-tasks"><p class="placeholder">Loading…</p></div>
            </div>
            <div>
                <div class="card-header">
                    <h3>Activity</h3>
                    <span class="muted tiny" id="activity-status">live</span>
                </div>
                <div class="activity-list" id="activity-log">
                    <p class="placeholder tiny">Deprecation warnings from <code>verify_task</code> / <code>complete_task</code> shim calls will appear here.</p>
                </div>
            </div>
        </div>
    `;

  const [tasksRes, projectsRes, clientsRes] = await Promise.all([
    api.get("/api/tasks").catch(() => ({ tasks: [] })),
    api.get("/api/projects").catch(() => ({ projects: [] })),
    api.get("/api/clients/count").catch(() => ({ count: 0 })),
  ]);

  const tasks = tasksRes.tasks || [];
  const projects = projectsRes.projects || [];
  const agents = clientsRes.count || 0;

  document.getElementById("stat-projects").textContent = projects.length;
  document.getElementById("stat-pending").textContent = tasks.filter((t) =>
    /pending/i.test(t.status)
  ).length;
  document.getElementById("stat-in-progress").textContent = tasks.filter((t) =>
    /in[_ ]progress/i.test(t.status)
  ).length;
  document.getElementById("stat-completed").textContent = tasks.filter((t) =>
    /completed/i.test(t.status)
  ).length;
  document.getElementById("stat-agents").textContent = agents;

  const recentTasks = [...tasks]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 6);
  document.getElementById("recent-tasks").innerHTML = recentTasks.length
    ? recentTasks
        .map(
          (t) => `
        <a class="activity-row" href="#/tasks/${encodeURIComponent(t.id)}">
            <span class="activity-icon">${iconForStatus(t.status)}</span>
            <span class="activity-text">${escapeHtml(t.name)} <span class="badge badge-${statusKey(t.status).replace(/_/g, "-")}">${escapeHtml(t.status)}</span></span>
            <span class="activity-time">${escapeHtml(formatRelative(t.updatedAt))}</span>
        </a>
    `
        )
        .join("")
    : `<p class="placeholder tiny">No tasks yet.</p>`;

  // Group 11.5 — subscribe to the SSE deprecation channel so shim
  // calls show up live in the Activity panel.
  stream = sse("/api/tasks/stream", {
    onEvent: {
      deprecation: (e) => {
        try {
          recordDeprecation(JSON.parse(e.data));
        } catch {
          /* ignore malformed payload */
        }
      },
    },
  });
}

export function unmount() {
  if (stream) {
    try {
      stream.close();
    } catch {
      /* ignore */
    }
    stream = null;
  }
}

function recordDeprecation(payload) {
  deprecationEntries.unshift(payload);
  if (deprecationEntries.length > DEPRECATION_LOG_LIMIT) {
    deprecationEntries.length = DEPRECATION_LOG_LIMIT;
  }
  paintActivity();
}

function paintActivity() {
  const wrap = document.getElementById("activity-log");
  if (!wrap) return;
  if (!deprecationEntries.length) return; // keep placeholder
  wrap.innerHTML = deprecationEntries
    .map(
      (entry) => `
        <div class="deprecated-row">
            <span class="badge-deprecated">DEPRECATED</span>
            <div style="flex:1;">
                <div><code>${escapeHtml(entry.tool || "?")}</code> → <code>${escapeHtml(entry.replacement || "?")}</code></div>
                <div class="muted tiny">
                    ${entry.taskId ? `task ${escapeHtml(entry.taskId)} · ` : ""}
                    removed in ${escapeHtml(entry.removalVersion || "?")}
                    · ${escapeHtml(formatRelative(entry.at))}
                </div>
            </div>
        </div>
    `
    )
    .join("");
}

function iconForStatus(s) {
  const k = statusKey(s);
  if (k === "completed") return "✅";
  if (/in[_ ]progress/i.test(s)) return "⏳";
  if (k === "blocked") return "⛔";
  return "📋";
}
