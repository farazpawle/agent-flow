import { api } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml, formatRelative, formatDate } from "../lib/utils.js";

let refreshTimer = null;

export async function mount(container) {
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Agents</h1>
        <div class="page-subtitle">MCP clients currently connected to this AgentFlow instance.</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" id="btn-refresh-agents">Refresh</button>
        <button class="btn btn-danger" id="btn-cleanup-agents">Cleanup Stale</button>
      </div>
    </div>
    <div id="agents-list"><p class="placeholder">Loading…</p></div>
  `;

  document.getElementById("btn-refresh-agents").addEventListener("click", () => refresh());
  document.getElementById("btn-cleanup-agents").addEventListener("click", async () => {
    if (
      !confirm(
        "Mark all clients inactive and delete the inactive ones? Active clients reconnect automatically."
      )
    )
      return;
    try {
      const res = await api.del("/api/clients/cleanup");
      toast.success(res.message || "Cleaned up");
      refresh();
    } catch (err) {
      toast.error("Cleanup failed: " + err.message);
    }
  });

  await refresh();
  refreshTimer = setInterval(refresh, 5000);
}

export function unmount() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

async function refresh() {
  try {
    const { clients } = await api.get("/api/clients");
    const wrap = document.getElementById("agents-list");
    if (!wrap) return;
    if (!clients.length) {
      wrap.innerHTML = `<p class="placeholder">No agents connected. Launch an MCP client (Claude Desktop, Cursor, etc.) to see it appear here.</p>`;
      return;
    }
    wrap.innerHTML = `
      <table class="table">
        <thead><tr><th>Status</th><th>Name</th><th>Type</th><th>Workspace</th><th>Connected</th><th>Last activity</th><th></th></tr></thead>
        <tbody>
          ${clients
            .map(
              (c) => `
            <tr>
              <td><span class="status-dot" style="background: ${c.isActive ? "var(--success)" : "var(--text-tertiary)"}; box-shadow: none;"></span> ${c.isActive ? "Active" : "Idle"}</td>
              <td>${escapeHtml(c.name || c.id)}</td>
              <td>${escapeHtml(c.type || "—")}</td>
              <td class="muted tiny">${escapeHtml(c.workspace || "—")}</td>
              <td class="muted tiny">${escapeHtml(formatDate(c.connectedAt))}</td>
              <td class="muted tiny">${escapeHtml(formatRelative(c.lastActivityAt))}</td>
              <td><button class="btn btn-sm btn-danger" data-id="${escapeHtml(c.id)}">Disconnect</button></td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
    wrap.querySelectorAll("button[data-id]").forEach((b) =>
      b.addEventListener("click", async () => {
        try {
          await api.del(`/api/clients/${encodeURIComponent(b.dataset.id)}/disconnect`);
          toast.success("Client disconnected");
          refresh();
        } catch (err) {
          toast.error("Failed: " + err.message);
        }
      })
    );
  } catch (err) {
    const wrap = document.getElementById("agents-list");
    if (wrap)
      wrap.innerHTML = `<p class="placeholder error">Failed to load: ${escapeHtml(err.message)}</p>`;
  }
}
