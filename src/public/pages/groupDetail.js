/**
 * Group detail page — Wave 4 §10.B (4.11).
 *
 * Reached as `#/groups/:id?project=<pid>`. In-app links always carry the
 * project id (a group can't be resolved without its project, since
 * task_view(tree) requires projectId); a bare URL falls back to a scan
 * across projects.
 *
 * Two tabs:
 *   - Tree (default): task_view(action='tree', projectId, groupId) via
 *     the shared treeView component, with a "copy as markdown" action.
 *   - DAG: the group's tasks rendered through the existing d3 dependency
 *     graph (legacy/d3-graph.js).
 */

import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml } from "../lib/utils.js";
import { renderTaskTree, treeToMarkdown } from "../components/treeView.js";
import { createDependencyGraph } from "../legacy/d3-graph.js";

let graph = null;
let liveStream = null;
let treeRoots = [];

export async function mount(container, { params, query } = {}) {
  const groupId = params.id;
  container.innerHTML = `<div class="placeholder">Loading group…</div>`;

  // Resolve the owning project.
  let projectId = query && query.project ? query.project : null;
  let group = null;
  try {
    const resolved = await resolveGroup(groupId, projectId);
    projectId = resolved.projectId;
    group = resolved.group;
  } catch (err) {
    container.innerHTML = `<div class="page-empty error"><h2>Group not found</h2><p>${escapeHtml(err.message)}</p><a class="btn btn-primary" href="#/projects">Back to projects</a></div>`;
    return;
  }

  const counts = group.taskCounts || {};
  const countChips = Object.entries(counts)
    .map(([k, v]) => `<span class="badge badge-default">${escapeHtml(k)}: ${v}</span>`)
    .join(" ");

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>${escapeHtml(group.name)}</h1>
        <div class="page-subtitle">${escapeHtml(group.description || "No description")} ${countChips}</div>
      </div>
      <div class="page-actions">
        <a class="btn btn-secondary" href="#/projects/${encodeURIComponent(projectId)}">Project</a>
        <button class="btn btn-secondary" id="grp-copy-md">Copy as markdown</button>
      </div>
    </div>

    <div class="tabs" id="grp-tabs">
      <button class="tab active" data-tab="tree">Tree</button>
      <button class="tab" data-tab="dag">Dependency graph</button>
    </div>

    <div id="grp-tab-tree" class="grp-tab-panel"></div>
    <div id="grp-tab-dag" class="grp-tab-panel" hidden>
      <div class="graph-canvas" id="grp-graph-canvas"></div>
    </div>`;

  // Tab switching
  container.querySelectorAll("#grp-tabs .tab").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(container, btn.dataset.tab, projectId, groupId));
  });

  container.querySelector("#grp-copy-md").addEventListener("click", async () => {
    const md = treeToMarkdown(treeRoots);
    try {
      await navigator.clipboard.writeText(md);
      toast.success("Copied tree as markdown");
    } catch {
      toast.error("Clipboard unavailable — see console");
      console.log(md);
    }
  });

  await loadTree(container, projectId, groupId);
}

export function unmount() {
  if (liveStream) {
    liveStream.close();
    liveStream = null;
  }
  if (graph) {
    graph.destroy();
    graph = null;
  }
}

async function resolveGroup(groupId, projectId) {
  if (projectId) {
    const res = await api.post("/api/projects/view", { action: "groups_list", projectId });
    const group = (res.groups || []).find((g) => g.id === groupId);
    if (group) return { projectId, group };
  }
  // Fallback: scan projects for the group.
  const { projects = [] } = await api.get("/api/projects").catch(() => ({ projects: [] }));
  for (const p of projects) {
    const res = await api
      .post("/api/projects/view", { action: "groups_list", projectId: p.id })
      .catch(() => ({ groups: [] }));
    const group = (res.groups || []).find((g) => g.id === groupId);
    if (group) return { projectId: p.id, group };
  }
  throw new Error(`Group ${groupId} not found in any project.`);
}

async function loadTree(container, projectId, groupId) {
  const panel = container.querySelector("#grp-tab-tree");
  panel.innerHTML = `<div class="placeholder">Loading tree…</div>`;
  try {
    const res = await api.post("/api/tasks/view", { action: "tree", projectId, groupId });
    treeRoots = res.roots || [];
    panel.innerHTML = `<div class="card">${renderTaskTree(treeRoots)}</div>`;
  } catch (err) {
    panel.innerHTML = `<p class="placeholder error">Failed to load tree: ${escapeHtml(err.message)}</p>`;
  }
}

function switchTab(container, tab, projectId, groupId) {
  container.querySelectorAll("#grp-tabs .tab").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  const treePanel = container.querySelector("#grp-tab-tree");
  const dagPanel = container.querySelector("#grp-tab-dag");
  treePanel.hidden = tab !== "tree";
  dagPanel.hidden = tab !== "dag";
  if (tab === "dag") loadDag(container, projectId, groupId);
}

async function loadDag(container, projectId, groupId) {
  const canvas = container.querySelector("#grp-graph-canvas");
  if (!graph) {
    graph = createDependencyGraph(canvas, {
      onNodeClick: (id) => (location.hash = `#/tasks/${encodeURIComponent(id)}`),
    });
  }
  const refresh = async () => {
    try {
      const { tasks } = await api.get("/api/tasks");
      const groupTasks = tasks.filter((t) => t.groupId === groupId && t.projectId === projectId);
      graph.update(groupTasks);
    } catch {
      /* ignore */
    }
  };
  await refresh();
  if (!liveStream) {
    try {
      liveStream = new EventSource("/api/tasks/stream");
      liveStream.addEventListener("update", refresh);
      liveStream.onmessage = refresh;
    } catch {
      /* ignore */
    }
  }
}
