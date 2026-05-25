import { api, ApiError } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml } from "../lib/utils.js";

/**
 * Settings page — Appearance + LLM (Phase 2 Group 17) + Server + Runtime.
 *
 * The LLM card consumes the Group 16 routes:
 *   - GET  /api/llm/providers          → which keys are configured
 *   - GET  /api/llm/settings           → effective config + source labels
 *   - GET  /api/llm/models?provider=…  → cached model list
 *   - POST /api/llm/model/refresh      → force model-list refetch
 *   - POST /api/llm/settings           → persist provider/model/strategy/mode
 *
 * Save persists to `llm_settings`; the next `workflow_run(mode=agent)` picks
 * up the new config without a restart because `createLlmProvider` re-resolves
 * on every call (Group 13.4 deliberately avoids memoisation).
 */

const SELECTION_STRATEGIES = ["manual", "latest_code", "latest_reasoning", "cheapest", "fastest"];
const WORKFLOW_MODES = ["manual", "agent", "disabled"];

export async function mount(container) {
  const theme = document.documentElement.getAttribute("data-theme") || "dark";
  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Settings</h1>
        <div class="page-subtitle">Appearance, LLM provider, server controls, and runtime info.</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: var(--space-4);">
      <h3>Appearance</h3>
      <div class="field-block">
        <label class="label">Theme</label>
        <select class="select" id="theme-select" style="max-width: 220px;">
          <option value="dark"${theme === "dark" ? " selected" : ""}>Dark</option>
          <option value="light"${theme === "light" ? " selected" : ""}>Light</option>
        </select>
      </div>
    </div>

    <div class="card llm-card" id="llm-card" style="margin-bottom: var(--space-4);">
      <div class="llm-header">
        <h3>LLM provider</h3>
        <div class="muted tiny">
          Powers <code>workflow_run(mode=agent)</code>. Manual mode (the
          default) returns a structured contract without calling any LLM.
        </div>
      </div>
      <div id="llm-panel" class="llm-panel">
        <div class="placeholder muted">Loading LLM settings…</div>
      </div>
    </div>

    <div class="card" style="margin-bottom: var(--space-4);">
      <h3>Server</h3>
      <p class="muted tiny">The dashboard runs in the same Node process as your MCP server. Restart cleanly recycles the worker; Stop ends the process (use your launcher to bring it back).</p>
      <div class="page-actions">
        <button class="btn btn-secondary" id="btn-restart-server">🔄 Restart Server</button>
        <button class="btn btn-danger" id="btn-stop-server">🛑 Stop Server</button>
      </div>
    </div>

    <div class="card">
      <h3>Runtime info</h3>
      <table class="table">
        <tbody id="runtime-info">
          <tr><td colspan="2" class="muted tiny">Loading…</td></tr>
        </tbody>
      </table>
    </div>
  `;

  document.getElementById("theme-select").addEventListener("change", (e) => {
    const val = e.target.value;
    document.documentElement.setAttribute("data-theme", val);
    localStorage.setItem("agentflow.theme", val);
    toast.info(`Theme: ${val}`);
  });

  document.getElementById("btn-restart-server").addEventListener("click", async () => {
    if (!confirm("Restart the server now?")) return;
    try {
      await api.post("/api/server/restart");
      toast.info("Server restarting…");
    } catch (err) {
      toast.error("Restart failed: " + err.message);
    }
  });

  document.getElementById("btn-stop-server").addEventListener("click", async () => {
    if (!confirm("Stop the server? You'll need to relaunch it to bring it back.")) return;
    try {
      await api.post("/api/server/stop");
      toast.warn("Server stopping…");
    } catch (err) {
      toast.error("Stop failed: " + err.message);
    }
  });

  // Runtime info from response headers + UA
  try {
    const res = await fetch("/api/clients/count", { method: "GET" });
    const pid = res.headers.get("X-AgentFlow-PID") || "unknown";
    const dataDir = res.headers.get("X-AgentFlow-DATA-DIR") || "unknown";
    document.getElementById("runtime-info").innerHTML = `
      <tr><th>PID</th><td style="font-family: var(--font-mono);">${escapeHtml(pid)}</td></tr>
      <tr><th>Data directory</th><td style="font-family: var(--font-mono); font-size: 12px;">${escapeHtml(dataDir)}</td></tr>
      <tr><th>UI version</th><td>1.0.0 (vanilla SPA)</td></tr>
      <tr><th>User agent</th><td class="muted tiny">${escapeHtml(navigator.userAgent)}</td></tr>
    `;
  } catch (err) {
    document.getElementById("runtime-info").innerHTML =
      `<tr><td colspan="2" class="placeholder error">Failed to load runtime info: ${escapeHtml(err.message)}</td></tr>`;
  }

  // ────────────────────────────────────────────────────────────────────
  // LLM panel (Group 17)
  // ────────────────────────────────────────────────────────────────────
  await mountLlmPanel();
}

/**
 * Local state held inside the panel — kept on the closure so each
 * re-render of the panel sees the latest values without DOM hunting.
 */
function makePanelState() {
  return {
    providers: [], // ProviderStatus[]
    configLocked: false,
    settings: null, // LlmSettingsResponse
    models: [], // ModelInfo[] for currently-selected provider
    modelsAgeMs: null,
    modelsServedStale: false,
    selectedProvider: null,
    selectedModel: null,
    selectedStrategy: null,
    selectedMode: null,
    loadingModels: false,
    modelsError: null,
  };
}

async function mountLlmPanel() {
  const panel = document.getElementById("llm-panel");
  if (!panel) return;
  const state = makePanelState();

  async function loadInitial() {
    try {
      const [providers, settings] = await Promise.all([
        api.get("/api/llm/providers"),
        api.get("/api/llm/settings"),
      ]);
      state.providers = providers.providers;
      state.configLocked = providers.configLocked;
      state.settings = settings;
      state.selectedProvider = settings.provider ?? "none";
      state.selectedModel = settings.model ?? null;
      state.selectedStrategy = settings.selectionStrategy ?? "latest_code";
      state.selectedMode = settings.workflowMode ?? "manual";
      render();
      // Kick off the model list if the chosen provider has a fetcher.
      if (state.selectedProvider && state.selectedProvider !== "none") {
        loadModels(state.selectedProvider, { force: false }).then(render);
      }
    } catch (err) {
      panel.innerHTML = `<div class="placeholder error">Failed to load LLM settings: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadModels(provider, { force = false } = {}) {
    state.loadingModels = true;
    state.modelsError = null;
    state.models = [];
    render();
    try {
      const out = force
        ? await api.post("/api/llm/model/refresh", { provider })
        : await api.get(`/api/llm/models?provider=${encodeURIComponent(provider)}`);
      state.models = out.models;
      state.modelsAgeMs = out.ageMs;
      state.modelsServedStale = out.servedStale;
      // If the current selectedModel doesn't appear in the list, leave
      // it pinned — the runner will resolve via the env fallback path
      // (Group 14 §4.6 step 6). The UI flags this as "custom (not in list)".
    } catch (err) {
      state.modelsError = err instanceof ApiError ? err.message : String(err);
    } finally {
      state.loadingModels = false;
    }
  }

  function sourceBadge(source) {
    if (!source) return "";
    const labels = { env: "env", db: "db", default: "—" };
    const cls = source === "db" ? "src-db" : source === "env" ? "src-env" : "src-default";
    return `<span class="llm-source-badge ${cls}" title="Setting source">${labels[source] ?? source}</span>`;
  }

  function providerCard(p) {
    const checked = state.selectedProvider === p.provider ? "checked" : "";
    const disabled = state.configLocked ? "disabled" : "";
    const noneNote =
      p.provider === "none"
        ? `<div class="muted tiny">Manual-only — no LLM calls; <code>workflow_run(mode=agent)</code> degrades to manual.</div>`
        : "";
    const keyBadge =
      p.provider === "none"
        ? ""
        : p.keyConfigured
          ? `<span class="badge badge-completed" title="API key detected via env var ${escapeHtml(p.keyEnv)}">key configured</span>`
          : `<span class="badge badge-pending" title="No API key found in ${escapeHtml(p.keyEnv)}">key missing</span>`;
    const keyHint =
      p.provider === "none" || p.keyEnv == null
        ? ""
        : `<code class="muted tiny" title="API keys are env-only by design — never persisted in the database, never returned by the GET /api/llm/settings response.">${escapeHtml(p.keyEnv)} (env-only)</code>`;
    return `
      <label class="llm-provider-row" data-provider="${escapeHtml(p.provider)}">
        <input type="radio" name="llm-provider" value="${escapeHtml(p.provider)}" ${checked} ${disabled}>
        <div class="llm-provider-meta">
          <div class="llm-provider-name">${escapeHtml(p.provider)} ${keyBadge}</div>
          ${noneNote}
          <div class="llm-provider-key">${keyHint}</div>
        </div>
      </label>
    `;
  }

  function modelOption(m) {
    const ctx = m.contextTokens ? ` · ${Math.round(m.contextTokens / 1000)}k ctx` : "";
    const cost =
      m.pricing?.inputPerMillion != null ? ` · $${m.pricing.inputPerMillion.toFixed(2)}/M in` : "";
    const selected = m.id === state.selectedModel ? " selected" : "";
    return `<option value="${escapeHtml(m.id)}"${selected}>${escapeHtml(m.id)}${escapeHtml(ctx + cost)}</option>`;
  }

  function modelSection() {
    if (state.selectedProvider === "none") {
      return `<div class="muted tiny">No model selection — provider is <code>none</code>.</div>`;
    }
    if (state.loadingModels) {
      return `<div class="muted tiny">Loading models for <code>${escapeHtml(state.selectedProvider)}</code>…</div>`;
    }
    if (state.modelsError) {
      return `<div class="placeholder error">Model list unavailable: ${escapeHtml(state.modelsError)}</div>`;
    }
    if (state.models.length === 0) {
      return `<div class="muted tiny">No models in cache yet. Click <strong>Refresh</strong> to fetch.</div>`;
    }
    const hasCurrent =
      state.selectedModel && state.models.some((m) => m.id === state.selectedModel);
    const customRow =
      !hasCurrent && state.selectedModel
        ? `<option value="${escapeHtml(state.selectedModel)}" selected>${escapeHtml(state.selectedModel)} (custom — not in list)</option>`
        : "";
    const ageNote =
      state.modelsAgeMs != null
        ? `Cached ${Math.round(state.modelsAgeMs / 1000)}s ago${state.modelsServedStale ? " (served stale after fetch failure)" : ""}.`
        : "";
    const disabled = state.configLocked ? "disabled" : "";
    return `
      <select class="select" id="llm-model-select" ${disabled} style="max-width: 480px;">
        <option value="">— inherit env / pick strategy —</option>
        ${customRow}
        ${state.models.map(modelOption).join("")}
      </select>
      <div class="muted tiny llm-models-meta">${escapeHtml(ageNote)}</div>
    `;
  }

  function render() {
    const lockBanner = state.configLocked
      ? `<div class="llm-lock-banner" title="LLM_CONFIG_LOCK=true — settings are read-only">🔒 LLM_CONFIG_LOCK=true — settings are read-only. Persisted DB rows are ignored; env values win.</div>`
      : "";

    const providersHtml = state.providers.map(providerCard).join("");

    panel.innerHTML = `
      ${lockBanner}

      <div class="llm-grid">
        <div class="llm-section">
          <label class="label">Provider ${sourceBadge(state.settings?.providerSource)}</label>
          <div class="llm-provider-list">${providersHtml}</div>
        </div>

        <div class="llm-section">
          <label class="label" for="llm-model-select">Model ${sourceBadge(state.settings?.modelSource)}</label>
          <div class="llm-row">
            ${modelSection()}
            <button class="btn btn-secondary llm-refresh-btn" id="btn-llm-refresh-models" ${state.selectedProvider === "none" || state.configLocked ? "disabled" : ""}>
              ${state.loadingModels ? "Refreshing…" : "🔄 Refresh"}
            </button>
          </div>
        </div>

        <div class="llm-section">
          <label class="label" for="llm-strategy-select">Selection strategy</label>
          <select class="select" id="llm-strategy-select" ${state.configLocked ? "disabled" : ""} style="max-width: 280px;">
            ${SELECTION_STRATEGIES.map(
              (s) => `
              <option value="${s}"${state.selectedStrategy === s ? " selected" : ""}>${s}</option>
            `
            ).join("")}
          </select>
          <div class="muted tiny">
            <code>manual</code> uses the model you picked above; the other
            strategies let AgentFlow pick from the cached model list when
            the call fires.
          </div>
        </div>

        <div class="llm-section">
          <label class="label" for="llm-mode-select">Workflow mode</label>
          <select class="select" id="llm-mode-select" ${state.configLocked ? "disabled" : ""} style="max-width: 280px;">
            ${WORKFLOW_MODES.map(
              (m) => `
              <option value="${m}"${state.selectedMode === m ? " selected" : ""}>${m}</option>
            `
            ).join("")}
          </select>
          <div class="muted tiny">
            <code>manual</code> returns the structured contract; <code>agent</code>
            calls the provider; <code>disabled</code> short-circuits with a typed payload.
          </div>
        </div>
      </div>

      <div class="page-actions llm-actions">
        <button class="btn" id="btn-llm-save" ${state.configLocked ? "disabled title='Disabled while LLM_CONFIG_LOCK=true'" : ""}>💾 Save</button>
        <span class="muted tiny" id="llm-updated-at">
          ${state.settings?.updatedAt ? `Last saved: ${escapeHtml(new Date(state.settings.updatedAt).toLocaleString())}` : ""}
        </span>
      </div>
    `;

    // Wire events
    panel.querySelectorAll("input[name='llm-provider']").forEach((input) => {
      input.addEventListener("change", async (e) => {
        state.selectedProvider = e.target.value;
        // Reset the selected model when switching providers; the new
        // provider's list almost certainly doesn't share IDs with the
        // old one.
        state.selectedModel = null;
        if (state.selectedProvider && state.selectedProvider !== "none") {
          await loadModels(state.selectedProvider, { force: false });
        } else {
          state.models = [];
        }
        render();
      });
    });
    const modelSelect = document.getElementById("llm-model-select");
    if (modelSelect) {
      modelSelect.addEventListener("change", (e) => {
        state.selectedModel = e.target.value || null;
      });
    }
    const strategySelect = document.getElementById("llm-strategy-select");
    if (strategySelect) {
      strategySelect.addEventListener("change", (e) => {
        state.selectedStrategy = e.target.value;
      });
    }
    const modeSelect = document.getElementById("llm-mode-select");
    if (modeSelect) {
      modeSelect.addEventListener("change", (e) => {
        state.selectedMode = e.target.value;
      });
    }
    const refreshBtn = document.getElementById("btn-llm-refresh-models");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", async () => {
        if (state.selectedProvider === "none") return;
        await loadModels(state.selectedProvider, { force: true });
        render();
        toast.info(
          `Refreshed ${state.selectedProvider} model list (${state.models.length} entries).`
        );
      });
    }
    const saveBtn = document.getElementById("btn-llm-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", onSave);
    }
  }

  async function onSave() {
    const body = {
      provider: state.selectedProvider || null,
      model: state.selectedModel || null,
      selectionStrategy: state.selectedStrategy || null,
      workflowMode: state.selectedMode || null,
    };
    try {
      const updated = await api.post("/api/llm/settings", body);
      state.settings = updated;
      state.selectedProvider = updated.provider ?? state.selectedProvider;
      state.selectedModel = updated.model ?? state.selectedModel;
      toast.success("LLM settings saved. The next workflow_run(agent) will use this config.");
      render();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        toast.error(
          "Settings are locked (LLM_CONFIG_LOCK=true). Unset that env var to enable saves."
        );
      } else {
        toast.error("Save failed: " + err.message);
      }
    }
  }

  await loadInitial();
}
