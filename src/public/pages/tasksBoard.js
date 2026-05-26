import { api } from "../lib/api.js";
import { escapeHtml, statusKey, statusLabel, formatRelative, debounce } from "../lib/utils.js";
import { toast } from "../lib/toast.js";

const COLUMNS = [
  { key: "pending", label: "Pending", match: (s) => statusKey(s) === "pending" },
  { key: "in_progress", label: "In Progress", match: (s) => /in[_ ]progress/i.test(s) },
  { key: "completed", label: "Completed", match: (s) => statusKey(s) === "completed" },
  { key: "blocked", label: "Blocked", match: (s) => statusKey(s) === "blocked" },
];

let liveStream = null;
let projectsCache = [];
let activeProjectId = "all";

export async function mount(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Tasks · Board</h1>
        <div class="page-subtitle">Drag cards between columns to update status. Live-syncs across clients.</div>
      </div>
      <div class="page-actions">
        <select class="select" id="board-project-filter" style="width: 220px;"></select>
        <a class="btn btn-secondary" href="#/tasks/graph">Graph view</a>
      </div>
    </div>
    <div class="kanban-board" id="kanban-board"></div>
  `;

  // Initial render skeleton
  renderBoardSkeleton();

  // Load projects + tasks in parallel
  const [{ projects }, { tasks }] = await Promise.all([
    api.get("/api/projects").catch(() => ({ projects: [] })),
    api.get("/api/tasks").catch(() => ({ tasks: [] })),
  ]);
  projectsCache = projects;

  const sel = document.getElementById("board-project-filter");
  sel.innerHTML =
    `<option value="all">All projects</option>` +
    projects
      .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
      .join("");
  sel.value = activeProjectId;
  sel.addEventListener("change", () => {
    activeProjectId = sel.value;
    refresh();
  });

  renderTasks(tasks);

  // Live updates via SSE
  try {
    liveStream = new EventSource("/api/tasks/stream");
    liveStream.addEventListener("update", debounce(refresh, 250));
    liveStream.onmessage = debounce(refresh, 250);
  } catch (err) {
    // ignore — fallback to manual refresh
  }
}

export function unmount() {
  if (liveStream) {
    liveStream.close();
    liveStream = null;
  }
}

function renderBoardSkeleton() {
  const board = document.getElementById("kanban-board");
  board.innerHTML = COLUMNS.map(
    (c) => `
    <div class="kanban-column" data-status="${c.key}">
      <div class="kanban-col-header">
        <span>${escapeHtml(c.label)}</span>
        <span class="kanban-col-count" id="col-count-${c.key}">0</span>
      </div>
      <div class="kanban-cards" id="col-${c.key}" data-status="${c.key}"></div>
    </div>
  `
  ).join("");

  // Wire DnD
  board.querySelectorAll(".kanban-cards").forEach((col) => {
    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.parentElement.classList.add("drop-target");
    });
    col.addEventListener("dragleave", () => col.parentElement.classList.remove("drop-target"));
    col.addEventListener("drop", async (e) => {
      e.preventDefault();
      col.parentElement.classList.remove("drop-target");
      const taskId = e.dataTransfer.getData("text/task-id");
      const status = col.dataset.status;
      if (!taskId || !status) return;
      try {
        await api.patch(`/api/tasks/${encodeURIComponent(taskId)}`, { status });
        toast.success("Task moved");
        refresh();
      } catch (err) {
        toast.error("Failed to move task: " + err.message);
      }
    });
  });
}

async function refresh() {
  try {
    const { tasks } = await api.get("/api/tasks");
    renderTasks(tasks);
  } catch (err) {
    // swallow — toast was likely already shown
  }
}

function renderTasks(tasks) {
  const filtered =
    activeProjectId === "all" ? tasks : tasks.filter((t) => t.projectId === activeProjectId);
  const buckets = { pending: [], in_progress: [], completed: [], blocked: [] };
  for (const t of filtered) {
    let placed = false;
    for (const col of COLUMNS) {
      if (col.match(t.status)) {
        buckets[col.key].push(t);
        placed = true;
        break;
      }
    }
    if (!placed) buckets.pending.push(t);
  }

  for (const col of COLUMNS) {
    const list = buckets[col.key];
    document.getElementById(`col-count-${col.key}`).textContent = list.length;
    const wrap = document.getElementById(`col-${col.key}`);
    if (!list.length) {
      wrap.innerHTML = `<p class="placeholder tiny">No tasks here.</p>`;
      continue;
    }
    wrap.innerHTML = list.map((t) => taskCard(t)).join("");
  }

  // Attach drag handlers + click-to-detail
  document.querySelectorAll(".kanban-card").forEach((card) => {
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/task-id", card.dataset.id);
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("dragging"));
    card.addEventListener("click", () => {
      location.hash = `#/tasks/${encodeURIComponent(card.dataset.id)}`;
    });
  });
}

function taskCard(t) {
  const proj = projectsCache.find((p) => p.id === t.projectId);
  const updated = t.updatedAt ? formatRelative(t.updatedAt) : "";
  return `
    <div class="kanban-card" draggable="true" data-id="${escapeHtml(t.id)}">
      <div class="kanban-card-title">${escapeHtml(t.name)}</div>
      <div class="kanban-card-meta">
        ${proj ? `<span>${escapeHtml(proj.name)}</span>` : ""}
        ${updated ? `<span>· ${escapeHtml(updated)}</span>` : ""}
      </div>
    </div>
  `;
}
