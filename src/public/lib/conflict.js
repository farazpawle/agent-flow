/**
 * GUI CONFLICT-resolution helper — Phase 1 Group 11.4.
 *
 * When a mutating call (`task_edit`, `task_lifecycle(finalize)`) returns
 * a CONFLICT, the server attaches the §6.4 details block with the
 * `currentTask` (or `currentTasks` + `conflicts`) bodies. This module
 * renders a diff modal and asks the user to choose:
 *
 *   - reload     — discard local edits, refresh from server
 *   - retry      — re-apply local edits on top of the new version
 *   - cancel     — keep local edits dirty, do nothing
 *
 * The modal NEVER auto-retries — that's the silent-overwrite bug the
 * plan explicitly forbids in §11.4.
 */

import { api, ApiError } from "./api.js";
import { escapeHtml } from "./utils.js";

/**
 * Was the error a CONFLICT body from the new v2 surface?
 * (HTTP 409 with details containing `code:"CONFLICT"`.)
 */
export function isConflict(err) {
  if (!(err instanceof ApiError)) return false;
  if (err.status !== 409) return false;
  const d = err.body?.details;
  return !!d && d.code === "CONFLICT";
}

/**
 * Render the modal and return the user's chosen action.
 *
 * @param {object} opts
 * @param {object} opts.localTask     The task the user was editing (their copy).
 * @param {object} opts.conflictBody  The `details` block from the error.
 * @param {string[]} [opts.fieldsToCompare]  Whitelist of keys to diff.
 *
 * @returns {Promise<"reload"|"retry"|"cancel">}
 */
export function showConflictModal({ localTask, conflictBody, fieldsToCompare }) {
  return new Promise((resolve) => {
    const root = document.getElementById("modal-root");
    const wrap = document.createElement("div");
    wrap.className = "modal-backdrop";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");

    const single = conflictBody.currentTask || null;
    const isMulti = Array.isArray(conflictBody.conflicts);

    let bodyHtml = "";
    if (single) {
      bodyHtml = renderSingleDiff(localTask, single, fieldsToCompare);
    } else if (isMulti) {
      bodyHtml = renderMultiSummary(conflictBody);
    } else {
      bodyHtml = `<p class="muted">The server rejected the write because the task version is stale. No diff data was returned.</p>`;
    }

    wrap.innerHTML = `
            <div class="modal modal-md">
                <div class="modal-header">
                    <h3>Another writer changed this task</h3>
                </div>
                <div class="modal-body">
                    <p class="muted">
                        Your edit was rejected because the server's copy is newer than yours.
                        Pick how you want to resolve it — the app will never silently overwrite the other write.
                    </p>
                    ${bodyHtml}
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" data-action="cancel">Cancel — keep my unsaved changes</button>
                    <button class="btn btn-secondary" data-action="reload">Discard mine — reload server copy</button>
                    <button class="btn btn-primary" data-action="retry">Retry on top of server copy</button>
                </div>
            </div>
        `;

    function finish(action) {
      wrap.remove();
      resolve(action);
    }

    wrap.querySelectorAll("button[data-action]").forEach((b) => {
      b.addEventListener("click", () => finish(b.dataset.action));
    });
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) finish("cancel");
    });

    root.appendChild(wrap);
  });
}

function renderSingleDiff(local, server, fieldsToCompare) {
  const keys = fieldsToCompare ?? guessFields(local, server);
  const rows = keys
    .map((k) => {
      const a = local?.[k];
      const b = server?.[k];
      if (eqShallow(a, b)) return "";
      return `
                <tr>
                    <td class="muted tiny">${escapeHtml(k)}</td>
                    <td><pre class="diff-cell mine">${escapeHtml(stringify(a))}</pre></td>
                    <td><pre class="diff-cell theirs">${escapeHtml(stringify(b))}</pre></td>
                </tr>
            `;
    })
    .filter(Boolean)
    .join("");

  return `
        <p>
            <strong>Server version:</strong> ${escapeHtml(String(server.version ?? "?"))}
            &middot; <strong>Your version:</strong> ${escapeHtml(String(local?.version ?? "?"))}
        </p>
        <table class="diff-table">
            <thead><tr><th>Field</th><th>Your copy</th><th>Server copy</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" class="muted">No field-level differences detected — likely a non-visible bump (metadata, dependencies).</td></tr>'}</tbody>
        </table>
    `;
}

function renderMultiSummary(body) {
  const rows = body.conflicts
    .map(
      (c) => `
            <tr>
                <td class="muted tiny">${escapeHtml(c.taskId)}</td>
                <td>${escapeHtml(String(c.expectedVersion))}</td>
                <td>${escapeHtml(String(c.currentVersion ?? "deleted"))}</td>
            </tr>
        `
    )
    .join("");
  return `
        <p>Multiple tasks had stale versions; none of the writes were applied (atomic rollback).</p>
        <table class="diff-table">
            <thead><tr><th>Task</th><th>You sent</th><th>Server has</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function guessFields(a, b) {
  const keys = new Set();
  for (const o of [a, b]) {
    if (!o) continue;
    for (const k of Object.keys(o)) {
      if (
        k === "id" ||
        k === "createdAt" ||
        k === "updatedAt" ||
        k === "version" ||
        k === "completedAt"
      )
        continue;
      if (typeof o[k] === "function") continue;
      keys.add(k);
    }
  }
  return Array.from(keys);
}

function eqShallow(a, b) {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function stringify(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

/**
 * Wrap a mutating POST so CONFLICT bodies invoke the resolution modal.
 * Caller supplies `buildBody(currentTaskFromServer)` so retry can re-issue
 * the same mutation against the freshly-loaded version.
 *
 * @returns {Promise<{ status: "ok", result: any } | { status: "cancelled" | "reloaded" }>}
 */
export async function postWithConflictResolution(
  url,
  body,
  { localTask, fieldsToCompare, buildRetryBody } = {}
) {
  try {
    const result = await api.post(url, body);
    return { status: "ok", result };
  } catch (err) {
    if (!isConflict(err)) throw err;
    const choice = await showConflictModal({
      localTask,
      conflictBody: err.body.details,
      fieldsToCompare,
    });
    if (choice === "cancel") return { status: "cancelled" };
    if (choice === "reload") return { status: "reloaded" };
    // retry: use the server's fresh version, build a new payload, single attempt.
    const serverTask = err.body.details.currentTask;
    if (!serverTask || typeof buildRetryBody !== "function") {
      return { status: "cancelled" };
    }
    const nextBody = buildRetryBody(serverTask);
    try {
      const result = await api.post(url, nextBody);
      return { status: "ok", result };
    } catch (retryErr) {
      if (isConflict(retryErr)) {
        // A second race in a row — bail out, let the user re-try
        // manually rather than enter a retry loop.
        return { status: "cancelled" };
      }
      throw retryErr;
    }
  }
}
