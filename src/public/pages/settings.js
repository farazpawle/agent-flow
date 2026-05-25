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

    <div class="card runtime-config-card" id="runtime-config-card" style="margin-bottom: var(--space-4);">
      <div class="runtime-config-header">
        <h3>Runtime configuration</h3>
        <div class="muted tiny">
          Every env var the server actually reads. Secret values (API keys, service-role keys) are redacted —
          the column shows only whether they're set. Edit <code>.env</code> at the project root and restart to change anything marked
          <span class="rt-badge rt-restart">restart</span>.
        </div>
      </div>
      <div id="runtime-config-body" class="runtime-config-body">
        <div class="placeholder muted">Loading runtime configuration…</div>
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

  // ────────────────────────────────────────────────────────────────────
  // Runtime configuration card
  // ────────────────────────────────────────────────────────────────────
  await mountRuntimeConfigCard();
}

/**
 * Pull `GET /api/settings/runtime` and render every env var grouped by
 * section. Secret fields show a "set"/"unset" pill; non-secret fields
 * show the actual value. `restartRequired` fields get a small badge so
 * the operator knows the GUI can't change them live.
 */
async function mountRuntimeConfigCard() {
  const body = document.getElementById("runtime-config-body");
  if (!body) return;

  let snapshot;
  try {
    snapshot = await api.get("/api/settings/runtime");
  } catch (err) {
    body.innerHTML = `<div class="placeholder error">Failed to load runtime configuration: ${escapeHtml(err.message)}</div>`;
    return;
  }

  const sectionsHtml = snapshot.sections
    .map((section) => {
      const rowsHtml = section.fields.map(renderRuntimeField).join("");
      return `
        <div class="runtime-section">
          <div class="runtime-section-header">
            <h4>${escapeHtml(section.title)}</h4>
            <div class="muted tiny">${escapeHtml(section.description)}</div>
          </div>
          <table class="table runtime-table">
            <thead>
              <tr>
                <th>Variable</th>
                <th>Value</th>
                <th></th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </div>
      `;
    })
    .join("");

  body.innerHTML = `
    ${sectionsHtml}
    <div class="muted tiny runtime-footer">
      Snapshot taken at ${escapeHtml(new Date(snapshot.fetchedAt).toLocaleString())}.
      Reload the page to refresh.
    </div>
  `;

  // Wire inline-edit handlers. Save sends a PATCH with the input's
  // current value; Clear sends a PATCH with value=null which writes
  // a commented placeholder back to .env.
  body.querySelectorAll(".rt-save-btn").forEach((btn) => {
    btn.addEventListener("click", () => onRuntimeSave(btn.getAttribute("data-rt-name")));
  });
  body.querySelectorAll(".rt-clear-btn").forEach((btn) => {
    btn.addEventListener("click", () => onRuntimeClear(btn.getAttribute("data-rt-name")));
  });
  body.querySelectorAll(".rt-input").forEach((input) => {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        onRuntimeSave(input.getAttribute("data-rt-name"));
      }
    });
  });
}

async function onRuntimeSave(name) {
  if (!name) return;
  const input = document.querySelector(`.rt-input[data-rt-name="${cssEscape(name)}"]`);
  if (!input) return;
  const value = input.value.trim();
  await patchRuntimeField(name, value === "" ? null : value);
}

async function onRuntimeClear(name) {
  if (!name) return;
  if (!confirm(`Clear ${name}? This rewrites the line in .env as a commented placeholder.`)) return;
  await patchRuntimeField(name, null);
}

async function patchRuntimeField(name, value) {
  try {
    const out = await api.patch("/api/settings/runtime", { name, value });
    const liveNote = out.liveApplied
      ? "applied to the running process."
      : "saved to .env; takes effect after restart.";
    toast.success(`${name} ${value === null ? "cleared" : "saved"} — ${liveNote}`);
    // Re-fetch the snapshot so badges + values reflect the new state.
    await mountRuntimeConfigCard();
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) {
      toast.error(`${name}: settings are locked (LLM_CONFIG_LOCK=true).`);
    } else if (err instanceof ApiError && err.body && typeof err.body.hint === "string") {
      toast.error(`${name}: ${err.message}\n→ ${err.body.hint}`, { ttl: 10000 });
    } else {
      toast.error(`${name}: ${err.message}`);
    }
  }
}

function cssEscape(s) {
  // CSS.escape isn't on older browsers; a small subset is enough for
  // attribute-selector use since env var names are [A-Z_][A-Z0-9_]*.
  return String(s).replace(/[^A-Za-z0-9_]/g, "\\$&");
}

function renderRuntimeField(f) {
  const restartBadge = f.restartRequired
    ? `<span class="rt-badge rt-restart" title="Requires a server restart to take effect">restart</span>`
    : "";
  const defaultBadge =
    f.default !== undefined
      ? `<span class="rt-badge rt-default" title="Default applied when unset">default: ${escapeHtml(String(f.default))}</span>`
      : "";

  let valueCell;
  if (f.secret) {
    valueCell = f.set
      ? `<span class="rt-badge rt-set" title="Value is redacted — never returned by this endpoint">set (redacted)</span>`
      : `<span class="rt-badge rt-unset">unset</span>`;
  } else if (f.editable) {
    // Inline-editable: text input + Save/Clear buttons. The Save button
    // sends a PATCH; success replaces the row with the new state.
    const current = f.set ? String(f.value ?? "") : "";
    const restartHint = f.restartRequired
      ? `<span class="muted tiny rt-inline-hint">— takes effect after restart</span>`
      : `<span class="muted tiny rt-inline-hint">— applied live on save</span>`;
    valueCell = `
      <div class="rt-edit-row">
        <input
          class="input rt-input"
          type="text"
          data-rt-name="${escapeAttr(f.name)}"
          value="${escapeAttr(current)}"
          placeholder="${escapeAttr(f.default ? `default: ${f.default}` : "(unset)")}"
        />
        <button class="btn btn-secondary btn-sm rt-save-btn" data-rt-name="${escapeAttr(f.name)}" type="button">💾</button>
        <button class="btn btn-ghost btn-sm rt-clear-btn" data-rt-name="${escapeAttr(f.name)}" type="button" title="Clear (writes a commented placeholder to .env)">✖</button>
        ${restartHint}
      </div>
    `;
  } else if (f.set) {
    valueCell = `<code class="rt-value" title="${escapeAttr(String(f.value ?? ""))}">${escapeHtml(truncateForDisplay(String(f.value ?? "")))}</code>`;
  } else {
    valueCell = `<span class="rt-badge rt-unset">unset</span>`;
  }

  return `
    <tr>
      <td class="rt-name"><code>${escapeHtml(f.name)}</code></td>
      <td class="rt-value-cell">${valueCell}</td>
      <td class="rt-badges">${restartBadge}${defaultBadge}</td>
    </tr>
    <tr class="rt-desc">
      <td colspan="3" class="muted tiny">${escapeHtml(f.description)}</td>
    </tr>
  `;
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/`/g, "&#96;");
}

function truncateForDisplay(s, max = 64) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
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

  /**
   * Clickable provider card — replaces the radio-list row. The whole
   * card is the click target (data-provider tells the handler which
   * one was clicked), with a key-status chip in the top right and the
   * env var name in monospace at the bottom.
   */
  function providerCard(p) {
    const isActive = state.selectedProvider === p.provider;
    const locked = state.configLocked;
    const keyChip =
      p.provider === "none"
        ? `<span class="llm-pcard-chip llm-pcard-chip-none">no key needed</span>`
        : p.keyConfigured
          ? `<span class="llm-pcard-chip llm-pcard-chip-ok" title="API key detected via env var ${escapeHtml(p.keyEnv)}">key set</span>`
          : `<span class="llm-pcard-chip llm-pcard-chip-missing" title="No API key found in ${escapeHtml(p.keyEnv)}">key missing</span>`;
    const keyHint =
      p.provider === "none" || p.keyEnv == null
        ? `<span class="llm-pcard-hint muted">manual-only</span>`
        : `<code class="llm-pcard-hint" title="API keys are env-only — never persisted to the DB.">${escapeHtml(p.keyEnv)}</code>`;
    return `
      <button type="button"
        class="llm-pcard ${isActive ? "is-active" : ""} ${locked ? "is-locked" : ""}"
        data-provider="${escapeHtml(p.provider)}"
        ${locked ? "disabled" : ""}
        aria-pressed="${isActive ? "true" : "false"}">
        <div class="llm-pcard-head">
          <span class="llm-pcard-name">${escapeHtml(p.provider)}</span>
          ${keyChip}
        </div>
        ${keyHint}
      </button>
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

    // Active-state banner: one line summary so the user sees the
    // current effective config without scanning the form.
    const activeProvider = state.selectedProvider ?? "(unset)";
    const activeModel = state.selectedModel ?? "(strategy-decides)";
    const activeStrategy = state.selectedStrategy ?? "(unset)";
    const activeMode = state.selectedMode ?? "manual";
    const activeBanner = `
      <div class="llm-active-banner">
        <span class="llm-active-label">Active</span>
        <code class="llm-active-pill llm-active-provider">${escapeHtml(activeProvider)}</code>
        <span class="llm-active-sep">·</span>
        <code class="llm-active-pill llm-active-model" title="${escapeAttr(activeModel)}">${escapeHtml(activeModel)}</code>
        <span class="llm-active-sep">·</span>
        <code class="llm-active-pill">strategy=${escapeHtml(activeStrategy)}</code>
        <span class="llm-active-sep">·</span>
        <code class="llm-active-pill">mode=${escapeHtml(activeMode)}</code>
        ${state.settings?.updatedAt ? `<span class="llm-active-saved muted">· last saved ${escapeHtml(new Date(state.settings.updatedAt).toLocaleString())}</span>` : ""}
      </div>
    `;

    const providersHtml = state.providers.map(providerCard).join("");

    panel.innerHTML = `
      ${lockBanner}
      ${activeBanner}

      <div class="llm-section llm-section-providers">
        <div class="llm-section-head">
          <span class="llm-section-title">Provider</span>
          ${sourceBadge(state.settings?.providerSource)}
        </div>
        <div class="llm-pcard-grid">${providersHtml}</div>
      </div>

      <div class="llm-row-grid">
        <div class="llm-section">
          <div class="llm-section-head">
            <span class="llm-section-title">Model</span>
            ${sourceBadge(state.settings?.modelSource)}
          </div>
          <div class="llm-row">
            ${modelSection()}
            <button class="btn btn-secondary btn-sm llm-refresh-btn" id="btn-llm-refresh-models" ${state.selectedProvider === "none" || state.configLocked ? "disabled" : ""}>
              ${state.loadingModels ? "…" : "🔄"}
            </button>
          </div>
        </div>

        <div class="llm-section">
          <div class="llm-section-head"><span class="llm-section-title">Selection strategy</span></div>
          <select class="select" id="llm-strategy-select" ${state.configLocked ? "disabled" : ""}>
            ${SELECTION_STRATEGIES.map(
              (s) =>
                `<option value="${s}"${state.selectedStrategy === s ? " selected" : ""}>${s}</option>`
            ).join("")}
          </select>
        </div>

        <div class="llm-section">
          <div class="llm-section-head"><span class="llm-section-title">Workflow mode</span></div>
          <select class="select" id="llm-mode-select" ${state.configLocked ? "disabled" : ""}>
            ${WORKFLOW_MODES.map(
              (m) =>
                `<option value="${m}"${state.selectedMode === m ? " selected" : ""}>${m}</option>`
            ).join("")}
          </select>
        </div>
      </div>

      <div class="llm-actions-sticky">
        <button class="btn btn-primary" id="btn-llm-save" ${state.configLocked ? "disabled title='Disabled while LLM_CONFIG_LOCK=true'" : ""}>💾 Save settings</button>
        <span class="muted tiny llm-actions-hint">
          ${
            state.configLocked
              ? "🔒 Locked"
              : "Saves to <code>llm_settings</code>; the next <code>workflow_run(agent)</code> picks it up without restart."
          }
        </span>
      </div>
    `;

    // Wire events. Provider selection is now a clickable card grid
    // (.llm-pcard) instead of a radio list. Clicks bubble up to the
    // <button> element which carries the data-provider attribute.
    panel.querySelectorAll(".llm-pcard").forEach((card) => {
      card.addEventListener("click", async () => {
        if (card.hasAttribute("disabled")) return;
        const provider = card.getAttribute("data-provider");
        if (!provider || provider === state.selectedProvider) return;
        state.selectedProvider = provider;
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
        // Surface server-side `hint` when present — that's where we
        // tell the user how to fix the most common cause (missing
        // Supabase tables → "apply scripts/supabase-remediation-3.sql").
        const hint =
          err instanceof ApiError && err.body && typeof err.body.hint === "string"
            ? err.body.hint
            : null;
        const detailCode =
          err instanceof ApiError &&
          err.body &&
          err.body.details &&
          typeof err.body.details.code === "string"
            ? err.body.details.code
            : null;
        const lines = ["Save failed: " + err.message];
        if (detailCode) lines.push(`(${detailCode})`);
        if (hint) lines.push("→ " + hint);
        toast.error(lines.join("\n"), { ttl: 12000 });
      }
    }
  }

  await loadInitial();
}
