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
 *   2. Editable plan-upload preview (planUpload) — fed the
 *      `{ feature, groups, tasks }` payload from POST /api/plan/upload/preview
 *      where each task is { name, description, verificationCriteria?,
 *      dependsOnIndexes, groupIndex }. `mountPlanEditTree` (feature-hierarchy)
 *      renders Feature → section Groups → Tasks, lets the user rename / edit /
 *      drop rows + rename the feature/groups, and emits the `edits` object the
 *      commit route expects:
 *        { feature?:{drop?,name?,description?},
 *          groups?:[{index,name?,description?}],
 *          tasks?:[{index,drop?,name?,description?,verificationCriteria?}] }.
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
  // feature-hierarchy: show the derived `<g>.<t>` number when present.
  const num = node.displayNumber
    ? `<span class="tree-num muted tiny">${escapeHtml(String(node.displayNumber))}</span> `
    : "";
  return `
    <li class="tree-node" data-id="${escapeHtml(node.id || "")}">
      <span class="tree-row">
        <span class="tree-marker tree-marker-${sKey}" aria-hidden="true">${markerFor(node.status)}</span>
        ${num}<span class="tree-label">${label}</span>
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
 * Mount an editable preview tree into `container` (feature-hierarchy).
 *
 * @param {HTMLElement} container
 * @param {{
 *   feature: {name:string,description?:string}|null,
 *   groups: Array<{name:string,description?:string}>,
 *   tasks: Array<{name:string,description?:string,verificationCriteria?:string,groupIndex:number}>
 * }} preview
 * @returns {{ getEdits: () => object, hasSurvivors: () => boolean }}
 *   getEdits() returns the minimal `edits` object for the commit route
 *   (only changed fields + drops); hasSurvivors() is false when every
 *   task is dropped (commit would 400 on a zero-task tree).
 */
export function mountPlanEditTree(container, preview) {
  const originalFeature = preview.feature ? { ...preview.feature } : null;
  const originalGroups = (preview.groups || []).map((g) => ({ ...g }));
  const originalTasks = (preview.tasks || []).map((t) => ({ ...t }));

  // Working model — index-stable clones the user edits in place.
  const feature = originalFeature ? { ...originalFeature, dropped: false } : null;
  const groups = originalGroups.map((g) => ({ name: g.name, description: g.description ?? "" }));
  const model = originalTasks.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    verificationCriteria: t.verificationCriteria ?? "",
    groupIndex: typeof t.groupIndex === "number" ? t.groupIndex : 0,
    dropped: false,
  }));

  function render() {
    // Bucket tasks by their section group.
    const tasksByGroup = new Map();
    model.forEach((t, i) => {
      const arr = tasksByGroup.get(t.groupIndex) || [];
      arr.push(i);
      tasksByGroup.set(t.groupIndex, arr);
    });

    const featureHtml = feature
      ? `
      <div class="tree-feature-card ${feature.dropped ? "tree-dropped" : ""}" data-feature-card>
        <div class="tree-row">
          <span class="badge badge-default">feature</span>
          <input class="input tree-edit-name" data-feature-name value="${escapeHtml(feature.name)}" ${feature.dropped ? "disabled" : ""} />
          <button type="button" class="btn btn-sm ${feature.dropped ? "btn-secondary" : "btn-danger"}" data-feature-drop>
            ${feature.dropped ? "Restore" : "Use default name"}
          </button>
        </div>
        <textarea class="textarea tree-edit-desc" data-feature-desc rows="2" placeholder="Feature description (optional)" ${feature.dropped ? "disabled" : ""}>${escapeHtml(feature.description ?? "")}</textarea>
      </div>`
      : "";

    const groupsHtml = groups
      .map((g, gi) => {
        const taskIdx = tasksByGroup.get(gi) || [];
        const tasksHtml = taskIdx.map((i, pos) => editTaskHtml(i, `${gi + 1}.${pos + 1}`)).join("");
        return `
        <li class="tree-group-section" data-group-idx="${gi}">
          <div class="tree-row">
            <span class="badge badge-default">${gi + 1}</span>
            <input class="input tree-edit-name" data-group-name value="${escapeHtml(g.name)}" />
          </div>
          <ul>${tasksHtml || `<li class="placeholder tiny">No tasks in this section.</li>`}</ul>
        </li>`;
      })
      .join("");

    container.innerHTML = `
      ${featureHtml}
      <ul class="tree-view tree-edit">
        ${groupsHtml}
      </ul>`;
    attachHandlers();
  }

  function editTaskHtml(i, displayNumber) {
    const t = model[i];
    return `
      <li class="tree-node tree-edit-node ${t.dropped ? "tree-dropped" : ""}" data-idx="${i}">
        <div class="tree-row">
          <span class="tree-marker tree-marker-pending" aria-hidden="true">[ ]</span>
          <span class="tree-num muted tiny">${escapeHtml(displayNumber)}</span>
          <input class="input tree-edit-name" data-name value="${escapeHtml(t.name)}" ${t.dropped ? "disabled" : ""} />
          <button type="button" class="btn btn-sm ${t.dropped ? "btn-secondary" : "btn-danger"}" data-drop>
            ${t.dropped ? "Restore" : "Remove"}
          </button>
        </div>
        <textarea class="textarea tree-edit-desc" data-desc rows="2" placeholder="Description" ${t.dropped ? "disabled" : ""}>${escapeHtml(t.description)}</textarea>
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
          render();
        });
    });

    // Per-group rename.
    container.querySelectorAll(".tree-group-section").forEach((li) => {
      const gi = Number(li.dataset.groupIdx);
      const gName = li.querySelector(":scope > .tree-row > [data-group-name]");
      if (gName) gName.addEventListener("input", () => (groups[gi].name = gName.value));
    });

    if (feature) {
      const fName = container.querySelector("[data-feature-name]");
      const fDesc = container.querySelector("[data-feature-desc]");
      const fDrop = container.querySelector("[data-feature-drop]");
      if (fName) fName.addEventListener("input", () => (feature.name = fName.value));
      if (fDesc) fDesc.addEventListener("input", () => (feature.description = fDesc.value));
      if (fDrop)
        fDrop.addEventListener("click", () => {
          feature.dropped = !feature.dropped;
          render();
        });
    }
  }

  function getEdits() {
    const edits = {};

    if (feature) {
      const f = {};
      if (feature.dropped) f.drop = true;
      else {
        if (feature.name !== originalFeature.name) f.name = feature.name;
        if ((feature.description ?? "") !== (originalFeature.description ?? ""))
          f.description = feature.description ?? "";
      }
      if (Object.keys(f).length) edits.feature = f;
    }

    const groupEdits = [];
    groups.forEach((g, gi) => {
      const o = originalGroups[gi];
      const patch = { index: gi };
      let touched = false;
      if (g.name !== o.name && g.name.trim()) {
        patch.name = g.name;
        touched = true;
      }
      if ((g.description ?? "") !== (o.description ?? "")) {
        patch.description = g.description ?? "";
        touched = true;
      }
      if (touched) groupEdits.push(patch);
    });
    if (groupEdits.length) edits.groups = groupEdits;

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
