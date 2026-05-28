/**
 * Shared todo-marker tree component — Wave 4 §10.B (4.3).
 *
 * Two consumers, one styling vocabulary:
 *   1. Read-only task tree (groupDetail, taskDetail subtasks) — fed the
 *      `roots` shape returned by `task_view(action='tree')`:
 *        { id, name, status, groupId, parentTaskId, children:[…] }
 *      Rendered as a nested <ul> with todo markers; rows link to the
 *      task detail page. `treeToMarkdown` serialises the same shape to a
 *      `- [ ]` / `- [x]` checkbox list (4.3.5).
 *
 *   2. Editable plan-upload preview (planUpload) — fed the FLAT
 *      `{ group, tasks }` payload from POST /api/plan/upload/preview
 *      where each task is { name, description, verificationCriteria?,
 *      dependsOnPreviousIndex, parentIndex? }. `mountPlanEditTree`
 *      builds a one-level nest from `parentIndex`, lets the user rename
 *      / edit / drop rows + the group, and emits the `edits` object the
 *      commit route expects: { group?:{drop?,name?,description?},
 *      tasks?:[{index,drop?,name?,description?,verificationCriteria?}] }.
 *
 *      The commit API only supports patch + drop on existing preview
 *      indices — there is no "add" verb — so the edit tree deliberately
 *      offers rename / edit / remove only.
 */

import { escapeHtml, statusLabel, statusKey } from "../lib/utils.js";

// ── Status → todo marker (4.3.2) ──────────────────────────────────────
// [ ] PENDING/BLOCKED · [~] IN_PROGRESS · [x] COMPLETED
const STATUS_MARKER = {
  pending: "[ ]",
  blocked: "[ ]",
  in_progress: "[~]",
  completed: "[x]",
};

export function markerFor(status) {
  return STATUS_MARKER[statusKey(status)] ?? "[ ]";
}

// ── Read-only render ──────────────────────────────────────────────────

/**
 * Build nested-<ul> HTML for `task_view(action='tree')` roots.
 * @param {Array} roots
 * @param {{ linkTasks?: boolean }} [opts]
 */
export function renderTaskTree(roots, opts = {}) {
  const linkTasks = opts.linkTasks !== false;
  if (!Array.isArray(roots) || roots.length === 0) {
    return `<p class="placeholder tiny">No tasks in this view.</p>`;
  }
  return `<ul class="tree-view">${roots.map((n) => taskNodeHtml(n, linkTasks)).join("")}</ul>`;
}

function taskNodeHtml(node, linkTasks) {
  const sKey = statusKey(node.status);
  const label =
    linkTasks && node.id
      ? `<a class="tree-link" href="#/tasks/${encodeURIComponent(node.id)}">${escapeHtml(node.name)}</a>`
      : escapeHtml(node.name);
  const kids =
    Array.isArray(node.children) && node.children.length
      ? `<ul>${node.children.map((c) => taskNodeHtml(c, linkTasks)).join("")}</ul>`
      : "";
  return `
    <li class="tree-node" data-id="${escapeHtml(node.id || "")}">
      <span class="tree-row">
        <span class="tree-marker tree-marker-${sKey}" aria-hidden="true">${markerFor(node.status)}</span>
        <span class="tree-label">${label}</span>
        ${node.status ? `<span class="tree-status muted tiny">${escapeHtml(statusLabel(node.status))}</span>` : ""}
      </span>
      ${kids}
    </li>`;
}

/**
 * Serialise a tree (read-only node shape) to an indented Markdown
 * checkbox list (4.3.5). COMPLETED → `[x]`, everything else → `[ ]`.
 */
export function treeToMarkdown(roots, depth = 0) {
  let out = "";
  for (const n of roots || []) {
    const box = statusKey(n.status) === "completed" ? "[x]" : "[ ]";
    out += `${"  ".repeat(depth)}- ${box} ${n.name}\n`;
    if (Array.isArray(n.children) && n.children.length) {
      out += treeToMarkdown(n.children, depth + 1);
    }
  }
  return out;
}

// ── Editable plan-upload preview ──────────────────────────────────────

/**
 * Mount an editable preview tree into `container`.
 *
 * @param {HTMLElement} container
 * @param {{ group: {name:string,description?:string}|null, tasks: Array }} preview
 * @returns {{ getEdits: () => object, hasSurvivors: () => boolean }}
 *   getEdits() returns the minimal `edits` object for the commit route
 *   (only changed fields + drops); hasSurvivors() is false when every
 *   task is dropped (commit would 400 on a zero-task tree).
 */
export function mountPlanEditTree(container, preview) {
  const originalGroup = preview.group ? { ...preview.group } : null;
  const originalTasks = (preview.tasks || []).map((t) => ({ ...t }));

  // Working model — index-stable clone the user edits in place.
  const group = originalGroup ? { ...originalGroup, dropped: false } : null;
  const model = originalTasks.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    verificationCriteria: t.verificationCriteria ?? "",
    parentIndex: t.parentIndex,
    dropped: false,
  }));

  function render() {
    const rootIdx = [];
    const childrenOf = new Map();
    model.forEach((t, i) => {
      if (t.parentIndex === undefined || t.parentIndex === null) rootIdx.push(i);
      else {
        const arr = childrenOf.get(t.parentIndex) || [];
        arr.push(i);
        childrenOf.set(t.parentIndex, arr);
      }
    });

    const groupHtml = group
      ? `
      <div class="tree-group-card ${group.dropped ? "tree-dropped" : ""}" data-group-card>
        <div class="tree-row">
          <span class="badge badge-default">group</span>
          <input class="input tree-edit-name" data-group-name value="${escapeHtml(group.name)}" ${group.dropped ? "disabled" : ""} />
          <button type="button" class="btn btn-sm ${group.dropped ? "btn-secondary" : "btn-danger"}" data-group-drop>
            ${group.dropped ? "Restore" : "Drop group"}
          </button>
        </div>
        <textarea class="textarea tree-edit-desc" data-group-desc rows="2" placeholder="Group description (optional)" ${group.dropped ? "disabled" : ""}>${escapeHtml(group.description ?? "")}</textarea>
      </div>`
      : "";

    container.innerHTML = `
      ${groupHtml}
      <ul class="tree-view tree-edit">
        ${rootIdx.map((i) => editNodeHtml(i, childrenOf)).join("")}
      </ul>`;
    attachHandlers();
  }

  function editNodeHtml(i, childrenOf) {
    const t = model[i];
    const kidsIdx = childrenOf.get(i) || [];
    const kids = kidsIdx.length
      ? `<ul>${kidsIdx.map((k) => editNodeHtml(k, childrenOf)).join("")}</ul>`
      : "";
    return `
      <li class="tree-node tree-edit-node ${t.dropped ? "tree-dropped" : ""}" data-idx="${i}">
        <div class="tree-row">
          <span class="tree-marker tree-marker-pending" aria-hidden="true">[ ]</span>
          <input class="input tree-edit-name" data-name value="${escapeHtml(t.name)}" ${t.dropped ? "disabled" : ""} />
          <button type="button" class="btn btn-sm ${t.dropped ? "btn-secondary" : "btn-danger"}" data-drop>
            ${t.dropped ? "Restore" : "Remove"}
          </button>
        </div>
        <textarea class="textarea tree-edit-desc" data-desc rows="2" placeholder="Description" ${t.dropped ? "disabled" : ""}>${escapeHtml(t.description)}</textarea>
        ${kids}
      </li>`;
  }

  function attachHandlers() {
    // Per-task name / description live-binding.
    container.querySelectorAll(".tree-edit-node").forEach((li) => {
      const idx = Number(li.dataset.idx);
      const nameEl = li.querySelector(":scope > .tree-row > [data-name]");
      const descEl = li.querySelector(":scope > [data-desc]");
      const dropEl = li.querySelector(":scope > .tree-row > [data-drop]");
      if (nameEl) nameEl.addEventListener("input", () => (model[idx].name = nameEl.value));
      if (descEl) descEl.addEventListener("input", () => (model[idx].description = descEl.value));
      if (dropEl)
        dropEl.addEventListener("click", () => {
          model[idx].dropped = !model[idx].dropped;
          render(); // re-render so dropping a parent visually cascades
        });
    });

    if (group) {
      const gName = container.querySelector("[data-group-name]");
      const gDesc = container.querySelector("[data-group-desc]");
      const gDrop = container.querySelector("[data-group-drop]");
      if (gName) gName.addEventListener("input", () => (group.name = gName.value));
      if (gDesc) gDesc.addEventListener("input", () => (group.description = gDesc.value));
      if (gDrop)
        gDrop.addEventListener("click", () => {
          group.dropped = !group.dropped;
          render();
        });
    }
  }

  function getEdits() {
    const edits = {};

    if (group) {
      const g = {};
      if (group.dropped) g.drop = true;
      else {
        if (group.name !== originalGroup.name) g.name = group.name;
        if ((group.description ?? "") !== (originalGroup.description ?? ""))
          g.description = group.description ?? "";
      }
      if (Object.keys(g).length) edits.group = g;
    }

    const taskEdits = [];
    model.forEach((t, i) => {
      const o = originalTasks[i];
      const patch = { index: i };
      let touched = false;
      if (t.dropped) {
        patch.drop = true;
        touched = true;
      } else {
        if (t.name !== o.name && t.name.trim()) {
          patch.name = t.name;
          touched = true;
        }
        if (t.description !== (o.description ?? "") && t.description.trim()) {
          patch.description = t.description;
          touched = true;
        }
      }
      if (touched) taskEdits.push(patch);
    });
    if (taskEdits.length) edits.tasks = taskEdits;

    return edits;
  }

  function hasSurvivors() {
    return model.some((t) => !t.dropped);
  }

  render();
  return { getEdits, hasSurvivors };
}
