/**
 * Plan-upload widget — Wave 4 §10.B (4.15).
 *
 * Two-step UI over the Wave 3 routes:
 *   drop .md/.txt → POST /api/plan/upload/preview → editable tree
 *   → POST /api/plan/upload/commit → onCommitted({ groupId, taskIds, … }).
 *
 * Project-scoped: mounted inside projectDetail (you need a project to
 * upload into). Disabled with a tooltip when no LLM provider is
 * configured — the server returns 503 LLM_NOT_CONFIGURED in that state
 * and there is no regex fallback (CLAUDE.md "Plan upload (10.A)").
 */

import { api, ApiError } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml } from "../lib/utils.js";
import { mountPlanEditTree } from "./treeView.js";

const MAX_BYTES = 200 * 1024; // mirrors PLAN_UPLOAD_MAX_BYTES
const ACCEPT_EXT = /\.(md|markdown|txt)$/i;

/**
 * @param {HTMLElement} container
 * @param {{
 *   projectId: string,
 *   providerConfigured: boolean,
 *   onCommitted?: (result: { featureId: string, groupIds: string[], taskIds: string[], insertedCount: number }) => void
 * }} opts
 */
export function mountPlanUpload(container, opts) {
  const { projectId, providerConfigured } = opts;
  const onCommitted = opts.onCommitted || (() => {});

  let preview = null; // { previewId, feature, groups, tasks, expiresAt }
  let editTree = null; // handle from mountPlanEditTree

  function renderDropzone() {
    const disabled = !providerConfigured;
    container.innerHTML = `
      <div class="plan-dropzone ${disabled ? "is-disabled" : ""}"
           id="plan-dropzone"
           ${disabled ? `title="Plan upload needs an LLM provider. Configure one in Settings."` : `title="Drop a .md or .txt plan, or click to choose a file"`}>
        <div class="plan-dropzone-inner">
          <div class="plan-dropzone-icon">⬆️</div>
          <div class="plan-dropzone-text">
            ${
              disabled
                ? `Plan upload disabled — no LLM provider configured.`
                : `<strong>Drop a plan</strong> (.md / .txt, ≤200&nbsp;KB) or <span class="plan-dropzone-browse">browse</span>`
            }
          </div>
        </div>
        <input type="file" id="plan-file-input" accept=".md,.markdown,.txt" hidden ${disabled ? "disabled" : ""} />
      </div>`;

    if (disabled) return;

    const zone = container.querySelector("#plan-dropzone");
    const input = container.querySelector("#plan-file-input");

    zone.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
      if (input.files && input.files[0]) handleFile(input.files[0]);
    });

    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("plan-dropzone-active");
      })
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove("plan-dropzone-active");
      })
    );
    zone.addEventListener("drop", (e) => {
      const file = e.dataTransfer?.files?.[0];
      if (file) handleFile(file);
    });
  }

  async function handleFile(file) {
    if (!ACCEPT_EXT.test(file.name)) {
      toast.error("Unsupported file type — use .md, .markdown, or .txt.");
      return;
    }
    if (file.size > MAX_BYTES) {
      toast.error(`File too large (${Math.round(file.size / 1024)} KB). Limit is 200 KB.`);
      return;
    }
    const contentType = /\.txt$/i.test(file.name) ? "text/plain" : "text/markdown";
    let text;
    try {
      text = await file.text();
    } catch (err) {
      toast.error("Could not read file: " + (err?.message || err));
      return;
    }

    renderParsing();
    try {
      preview = await api.post("/api/plan/upload/preview", {
        projectId,
        planMarkdown: text,
        filename: file.name,
        contentType,
      });
      renderPreview();
    } catch (err) {
      reportError(err, "Preview failed");
      renderDropzone();
    }
  }

  function renderParsing() {
    container.innerHTML = `
      <div class="plan-progress">
        <span class="spinner"></span>
        <span>Parsing plan with the LLM…</span>
      </div>`;
  }

  function renderPreview() {
    const taskCount = preview.tasks?.length ?? 0;
    const groupCount = preview.groups?.length ?? 0;
    container.innerHTML = `
      <div class="plan-preview">
        <div class="plan-preview-header">
          <h4>Preview — ${groupCount} group${groupCount === 1 ? "" : "s"}, ${taskCount} task${taskCount === 1 ? "" : "s"}</h4>
          <p class="muted tiny">Rename the feature/groups, edit or remove tasks below, then commit. Emptying a group drops it. (Adding new rows isn't supported — re-upload an edited plan instead.)</p>
        </div>
        <div id="plan-edit-tree"></div>
        <div class="page-actions" style="justify-content:flex-end; margin-top: var(--space-3);">
          <button class="btn btn-secondary" id="plan-cancel">Cancel</button>
          <button class="btn btn-primary" id="plan-commit">Commit to project</button>
        </div>
      </div>`;

    editTree = mountPlanEditTree(container.querySelector("#plan-edit-tree"), {
      feature: preview.feature,
      groups: preview.groups,
      tasks: preview.tasks,
    });

    container.querySelector("#plan-cancel").addEventListener("click", () => {
      preview = null;
      editTree = null;
      renderDropzone(); // server TTL will sweep the orphaned preview
    });

    container.querySelector("#plan-commit").addEventListener("click", commit);
  }

  async function commit() {
    if (!editTree.hasSurvivors()) {
      toast.error("Every task is removed — nothing to commit.");
      return;
    }
    const btn = container.querySelector("#plan-commit");
    btn.disabled = true;
    btn.textContent = "Committing…";
    try {
      const result = await api.post("/api/plan/upload/commit", {
        previewId: preview.previewId,
        projectId,
        edits: editTree.getEdits(),
      });
      toast.success(
        `Created ${result.insertedCount} task${result.insertedCount === 1 ? "" : "s"}.`
      );
      preview = null;
      editTree = null;
      onCommitted(result);
    } catch (err) {
      reportError(err, "Commit failed");
      btn.disabled = false;
      btn.textContent = "Commit to project";
    }
  }

  function reportError(err, prefix) {
    if (err instanceof ApiError) {
      const code = err.body?.details?.code || err.body?.code;
      if (err.status === 503 || code === "LLM_NOT_CONFIGURED") {
        toast.error("No LLM provider configured — set one in Settings.");
        return;
      }
      if (err.status === 413 || code === "FILE_TOO_LARGE") {
        toast.error("File exceeds the 200 KB limit.");
        return;
      }
      if (err.status === 415 || code === "UNSUPPORTED_MIME") {
        toast.error("Unsupported file type — use .md or .txt.");
        return;
      }
      if (err.status === 410 || code === "PREVIEW_EXPIRED") {
        toast.error("Preview expired — drop the plan again.");
        preview = null;
        editTree = null;
        renderDropzone();
        return;
      }
      toast.error(`${prefix}: ${escapeHtml(err.message)}`);
      return;
    }
    toast.error(`${prefix}: ${err?.message || err}`);
  }

  renderDropzone();
}
