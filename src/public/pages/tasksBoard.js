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
let viewMode = "board"; // "board" | "available"

export async function mount(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Tasks · Board</h1>
        <div class="page-subtitle">Drag cards between columns to update status. Live-syncs across clients.</div>
      </div>
      <div class="page-actions">
        <div class="pill-row" id="board-view-toggle">
          <button class="pill ${viewMode === "board" ? "active" : ""}" data-view="board">Board</button>
          <button class="pill ${viewMode === "available" ? "active" : ""}" data-view="available">Available</button>
        </div>
        <select class="select" id="board-project-filter" style="width: 220px;"></select>
        <a class="btn btn-secondary" href="#/tasks/graph">Graph view</a>
      </div>
    </div>
    <div class="kanban-board" id="kanban-board"></div>
    <div id="available-board" hidden></div>
  `;

  // Initial render skeleton
  renderBoardSkeleton();

  // View toggle (Board ↔ Available)
  container.querySelectorAll("#board-view-toggle .pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      viewMode = btn.dataset.view;
      container
        .querySelectorAll("#board-view-toggle .pill")
        .forEach((b) => b.classList.toggle("active", b === btn));
      applyViewMode(container);
    });
  });

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
    if (viewMode === "available") renderAvailable(container);
    else refresh();
  });

  renderTasks(tasks);
  applyViewMode(container);

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

/**
 * Toggle between the kanban board and the §10.G available feed.
 * Uses inline `display` rather than the `hidden` attribute: the
 * `.kanban-board { display: grid }` author rule outranks the UA
 * `[hidden] { display: none }` rule, so `hidden` alone wouldn't hide it.
 */
function applyViewMode(container) {
  const kanban = container.querySelector("#kanban-board");
  const avail = container.querySelector("#available-board");
  const isAvail = viewMode === "available";
  // Clear the initial `hidden` attribute on #available-board — otherwise
  // `[hidden]{display:none}` (UA) outranks our inline display:"".
  kanban.hidden = false;
  avail.hidden = false;
  kanban.style.display = isAvail ? "none" : "";
  avail.style.display = isAvail ? "" : "none";
  if (isAvail) renderAvailable(container);
}

/**
 * Wave 4 §10.G — "what can I work on now?" feed via
 * task_view(action='available'). Requires a specific project (the API
 * mandates projectId). Locked-by-other rows are dimmed + non-navigable.
 */
async function renderAvailable(container) {
  const host = container.querySelector("#available-board");
  if (!host) return;
  if (activeProjectId === "all") {
    host.innerHTML = `<div class="card"><p class="placeholder">Pick a project from the filter to see its available tasks.</p></div>`;
    return;
  }
  host.innerHTML = `<div class="card"><p class="placeholder tiny">Loading available tasks…</p></div>`;
  try {
    const res = await api.post("/api/tasks/view", {
      action: "available",
      projectId: activeProjectId,
    });
    const list = res.tasks || [];
    if (!list.length) {
      host.innerHTML = `<div class="card"><p class="placeholder">No available tasks. Try removing the group filter or finalizing in-progress tasks.</p></div>`;
      return;
    }
    host.innerHTML = `
      <div class="card">
        <h4>Available tasks (${list.length}${res.truncated ? "+" : ""})</h4>
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
      </div>`;
    host.querySelectorAll(".available-item:not(.is-locked)").forEach((li) => {
      li.addEventListener("click", () => {
        location.hash = `#/tasks/${encodeURIComponent(li.dataset.id)}`;
      });
    });
  } catch (err) {
    host.innerHTML = `<div class="card"><p class="placeholder error">Failed to load available tasks: ${escapeHtml(err.message)}</p></div>`;
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
    // feature-hierarchy Workstream C: a derived-blocked task (PENDING with
    // incomplete deps) carries effectiveStatus="Blocked" — bucket by that so
    // it lands in the Blocked column instead of Pending.
    const colStatus = t.effectiveStatus ?? t.status;
    let placed = false;
    for (const col of COLUMNS) {
      if (col.match(colStatus)) {
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
      // feature-hierarchy Workstream C: blocked cards can't be moved (status
      // change is gated server-side). Cancel the drag defensively even though
      // the element is also draggable="false".
      if (card.dataset.blocked === "true") {
        e.preventDefault();
        return;
      }
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
  const blocked = t.blocked === true;
  const num = t.displayNumber
    ? `<span class="kanban-card-num muted tiny">${escapeHtml(String(t.displayNumber))}</span> `
    : "";
  return `
    <div class="kanban-card ${blocked ? "is-blocked" : ""}" draggable="${blocked ? "false" : "true"}"
         data-id="${escapeHtml(t.id)}" data-blocked="${blocked ? "true" : "false"}"
         ${blocked ? `title="Blocked — prerequisites incomplete"` : ""}>
      <div class="kanban-card-title">${num}${escapeHtml(t.name)}</div>
      <div class="kanban-card-meta">
        ${blocked ? `<span class="badge badge-blocked">Blocked</span>` : ""}
        ${proj ? `<span>${escapeHtml(proj.name)}</span>` : ""}
        ${updated ? `<span>· ${escapeHtml(updated)}</span>` : ""}
      </div>
    </div>
  `;
}
