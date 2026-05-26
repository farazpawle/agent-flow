/**
 * AgentFlow SPA bootstrap.
 * Sets up router, sidebar navigation, theme, breadcrumbs, toasts.
 */
import { Router } from "./lib/router.js";
import { applyI18n, loadLocale, t } from "./lib/i18n.js";
import { mountToastHost, toast } from "./lib/toast.js";
import { api } from "./lib/api.js";
import { escapeHtml } from "./lib/utils.js";

import * as dashboard from "./pages/dashboard.js";
import * as projects from "./pages/projects.js";
import * as projectDetail from "./pages/projectDetail.js";
import * as tasksBoard from "./pages/tasksBoard.js";
import * as tasksGraph from "./pages/tasksGraph.js";
import * as taskDetail from "./pages/taskDetail.js";
import * as agents from "./pages/agents.js";
import * as settings from "./pages/settings.js";

const NAV = [
  { section: "Overview" },
  { route: "/", icon: "🏠", labelKey: "nav_dashboard", label: "Dashboard" },
  { route: "/projects", icon: "📁", labelKey: "nav_projects", label: "Projects" },
  { section: "Workflow" },
  {
    route: "/tasks",
    icon: "📋",
    labelKey: "nav_tasks",
    label: "Tasks",
    children: [
      { route: "/tasks", label: "Board", labelKey: "nav_tasks_board" },
      { route: "/tasks/graph", label: "Graph", labelKey: "nav_tasks_graph" },
    ],
  },
  { section: "System" },
  { route: "/agents", icon: "🤖", labelKey: "nav_agents", label: "Agents" },
  { route: "/settings", icon: "⚙️", labelKey: "nav_settings", label: "Settings" },
];

async function boot() {
  // Locale + toast host
  await loadLocale("en");
  mountToastHost(document.getElementById("toast-root"));

  // Theme
  const savedTheme = localStorage.getItem("agentflow.theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  document.getElementById("btn-theme").addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", cur);
    localStorage.setItem("agentflow.theme", cur);
  });

  // Sidebar toggle
  const shell = document.getElementById("app-shell");
  document.getElementById("toggle-sidebar").addEventListener("click", () => {
    if (window.innerWidth <= 768) shell.classList.toggle("mobile-open");
    else shell.classList.toggle("collapsed");
  });

  // Settings shortcut
  document
    .getElementById("btn-settings")
    .addEventListener("click", () => (location.hash = "#/settings"));

  // Build sidebar
  renderSidebar();

  // Router
  const outlet = document.getElementById("outlet");
  const router = new Router(outlet);
  router
    .on("/", dashboard)
    .on("/projects", projects)
    .on("/projects/:id", projectDetail)
    .on("/tasks", tasksBoard)
    .on("/tasks/graph", tasksGraph)
    .on("/tasks/:id", taskDetail)
    .on("/agents", agents)
    .on("/settings", settings)
    .notFound({
      mount(container) {
        container.innerHTML = `<div class="page-empty"><h2>Not Found</h2><p>The route <code>${escapeHtml(location.hash)}</code> doesn't exist.</p><a href="#/" class="btn btn-primary" style="margin-top:16px;">Back to Dashboard</a></div>`;
      },
    });
  router.subscribe(updateChrome);
  router.start();

  // Agent count badge — poll every 10s
  refreshAgentCount();
  setInterval(refreshAgentCount, 10000);

  // Phase 1 Group 11.7 — per-client active project indicator. The
  // indicator surfaces the active project of the most-recently-active
  // connected MCP client (not a global one). Updates every 15s so
  // switches via `project_edit(action='set_active')` show up promptly.
  refreshActiveProject();
  setInterval(refreshActiveProject, 15000);

  // i18n on static nodes
  applyI18n(document);
}

function renderSidebar() {
  const nav = document.getElementById("sidebar-nav");
  const html = [];
  for (const item of NAV) {
    if (item.section) {
      html.push(`<div class="sidebar-section-title">${escapeHtml(item.section)}</div>`);
      continue;
    }
    html.push(`<a class="nav-item" href="#${item.route}" data-route="${escapeHtml(item.route)}">
      <span class="nav-icon">${item.icon}</span>
      <span class="nav-label">${escapeHtml(item.label)}</span>
    </a>`);
    if (item.children) {
      html.push(`<div class="nav-sub">`);
      for (const child of item.children) {
        html.push(`<a class="nav-item" href="#${child.route}" data-route="${escapeHtml(child.route)}">
          <span class="nav-label">${escapeHtml(child.label)}</span>
        </a>`);
      }
      html.push(`</div>`);
    }
  }
  nav.innerHTML = html.join("");
}

function updateChrome(route) {
  // Highlight active nav
  document.querySelectorAll(".sidebar-nav .nav-item").forEach((item) => {
    const r = item.dataset.route;
    item.classList.toggle(
      "active",
      r === route.pathname ||
        (r === "/tasks" &&
          /^\/tasks(\/.*)?$/.test(route.pathname) &&
          route.pathname !== "/tasks/graph")
    );
  });

  // Breadcrumbs
  const crumbs = buildBreadcrumbs(route);
  const breadcrumbsEl = document.getElementById("breadcrumbs");
  breadcrumbsEl.innerHTML = crumbs
    .map((c, i) => {
      const cls = i === crumbs.length - 1 ? "crumb current" : "crumb";
      const sep = i > 0 ? `<span class="crumb-sep">›</span>` : "";
      return `${sep}<span class="${cls}">${c.href ? `<a href="${escapeHtml(c.href)}">${escapeHtml(c.label)}</a>` : escapeHtml(c.label)}</span>`;
    })
    .join("");

  // Close mobile sidebar on navigation
  document.getElementById("app-shell").classList.remove("mobile-open");
}

function buildBreadcrumbs(route) {
  const p = route.pathname;
  if (p === "/") return [{ label: "Dashboard" }];
  if (p === "/projects") return [{ label: "Projects" }];
  if (/^\/projects\/[^/]+$/.test(p))
    return [{ label: "Projects", href: "#/projects" }, { label: route.params.id }];
  if (p === "/tasks") return [{ label: "Tasks", href: "#/tasks" }, { label: "Board" }];
  if (p === "/tasks/graph") return [{ label: "Tasks", href: "#/tasks" }, { label: "Graph" }];
  if (/^\/tasks\/[^/]+$/.test(p))
    return [{ label: "Tasks", href: "#/tasks" }, { label: route.params.id }];
  if (p === "/agents") return [{ label: "Agents" }];
  if (p === "/settings") return [{ label: "Settings" }];
  return [{ label: p }];
}

async function refreshAgentCount() {
  try {
    const { count } = await api.get("/api/clients/count");
    const el = document.getElementById("client-count-badge");
    if (el) el.textContent = `${count} agent${count === 1 ? "" : "s"}`;
  } catch (err) {
    // silent
  }
}

/**
 * Resolve the per-client active project (Phase 1 Group 11.7). The
 * indicator never shows a global value — it reflects the
 * `client_active_project` row of whichever MCP client most recently
 * heartbeated. Empty state is "—".
 */
async function refreshActiveProject() {
  const nameEl = document.getElementById("active-project-name");
  if (!nameEl) return;
  try {
    const { clients = [] } = await api.get("/api/clients").catch(() => ({ clients: [] }));
    // Active MCP clients only, sorted newest-first by activity.
    const candidates = clients
      .filter((c) => c && c.isActive && c.id)
      .sort((a, b) => new Date(b.lastActivityAt || 0) - new Date(a.lastActivityAt || 0));
    if (!candidates.length) {
      nameEl.textContent = "—";
      nameEl.title = "No connected MCP client";
      return;
    }
    const client = candidates[0];
    const view = await api
      .post("/api/projects/view", {
        action: "active",
        clientId: client.id,
      })
      .catch(() => null);
    const project = view?.activeProject;
    if (project?.name) {
      nameEl.textContent = project.name;
      nameEl.title = `Active project for client ${client.name || client.id}: ${project.name}`;
    } else {
      nameEl.textContent = "—";
      nameEl.title = `Client ${client.name || client.id} has no active project set. Call project_edit(action='set_active') with clientId.`;
    }
  } catch {
    // silent — the indicator is best-effort, never blocks UI
  }
}

window.__agentflowToast = toast;

boot().catch((err) => {
  console.error("Boot failed", err);
  document.getElementById("outlet").innerHTML =
    `<div class="page-empty error"><h2>Failed to start</h2><pre>${escapeHtml(err.message || String(err))}</pre></div>`;
});
