/**
 * Project Skill page — Wave 4 §10.B (4.13).
 *
 * Skills are per-project, so the page carries a project selector
 * (deep-linkable via `#/skills?project=<id>`). Renders the compiled
 * skill's frontmatter + body from context_get(type='skill_index');
 * reference sections are collapsible and lazy-fetch their body via
 * context_get(type='skill_section'). "Recompile" calls
 * POST /api/skill/compile and is disabled when no LLM provider is set.
 */

import { api, isLlmConfigured } from "../lib/api.js";
import { toast } from "../lib/toast.js";
import { escapeHtml, formatDate } from "../lib/utils.js";

let llmReady = false;

export async function mount(container, { query } = {}) {
  container.innerHTML = `<div class="placeholder">Loading…</div>`;

  const [{ projects }, ready] = await Promise.all([
    api.get("/api/projects").catch(() => ({ projects: [] })),
    isLlmConfigured(),
  ]);
  llmReady = ready;

  if (!projects.length) {
    container.innerHTML = `<div class="page-empty"><h2>No projects</h2><p>Create a project first, then compile its Skill.</p><a class="btn btn-primary" href="#/projects">Projects</a></div>`;
    return;
  }

  const selected =
    query && query.project && projects.some((p) => p.id === query.project)
      ? query.project
      : projects[0].id;

  container.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Project Skill</h1>
        <div class="page-subtitle">Compiled lessons + decisions distilled into a reusable skill.</div>
      </div>
      <div class="page-actions">
        <select class="select" id="skill-project" style="width: 240px;">
          ${projects
            .map(
              (p) =>
                `<option value="${escapeHtml(p.id)}" ${p.id === selected ? "selected" : ""}>${escapeHtml(p.name)}</option>`
            )
            .join("")}
        </select>
        <button class="btn btn-primary" id="skill-recompile"
          ${llmReady ? "" : `disabled title="Recompile needs an LLM provider. Configure one in Settings."`}>
          Recompile
        </button>
      </div>
    </div>
    <div id="skill-body"><div class="placeholder">Loading skill…</div></div>`;

  const sel = container.querySelector("#skill-project");
  sel.addEventListener("change", () => loadSkill(container, sel.value));
  container
    .querySelector("#skill-recompile")
    .addEventListener("click", () => recompile(container, sel.value));

  await loadSkill(container, selected);
}

async function loadSkill(container, projectId) {
  const body = container.querySelector("#skill-body");
  body.innerHTML = `<div class="placeholder">Loading skill…</div>`;
  let res;
  try {
    res = await api.post("/api/context", { type: "skill_index", projectId });
  } catch (err) {
    body.innerHTML = `<div class="page-empty error"><p>Failed to load skill: ${escapeHtml(err.message)}</p></div>`;
    return;
  }

  if (!res.skill) {
    body.innerHTML = `
      <div class="card">
        <h4>No skill compiled yet</h4>
        <p class="muted">${escapeHtml(res.note || "Run a compile once at least 2 lessons/decisions have been recorded.")}</p>
        ${
          llmReady
            ? `<button class="btn btn-primary" id="skill-recompile-empty">Compile now</button>`
            : `<p class="muted tiny">Configure an LLM provider in Settings to enable compilation.</p>`
        }
      </div>`;
    const btn = body.querySelector("#skill-recompile-empty");
    if (btn) btn.addEventListener("click", () => recompile(container, projectId));
    return;
  }

  const s = res.skill;
  const refs = res.references || [];
  body.innerHTML = `
    <div class="card">
      <div class="page-actions" style="justify-content: space-between; align-items: center;">
        <h4 style="margin:0;">Skill</h4>
        <span class="muted tiny">Compiled ${escapeHtml(formatDate(s.compiledAt))} · ${escapeHtml(String(s.tokenCount ?? "?"))} tokens</span>
      </div>
      ${s.frontmatter ? `<pre class="skill-frontmatter">${escapeHtml(typeof s.frontmatter === "string" ? s.frontmatter : JSON.stringify(s.frontmatter, null, 2))}</pre>` : ""}
      <pre class="skill-body-text">${escapeHtml(s.body || "")}</pre>
      ${s.bodyTruncated ? `<p class="muted tiny">Body truncated for display.</p>` : ""}
    </div>

    ${
      refs.length
        ? `<h3 style="margin-top: var(--space-5);">Reference sections (${refs.length})</h3>
           <div class="skill-refs">
             ${refs
               .map(
                 (r) => `
               <details class="skill-ref" data-topic="${escapeHtml(r.topic)}">
                 <summary>${escapeHtml(r.topic)} <span class="muted tiny">(${(r.sourceFindingIds || []).length} sources)</span></summary>
                 <div class="skill-ref-body"><span class="placeholder tiny">Expand to load…</span></div>
               </details>`
               )
               .join("")}
           </div>`
        : `<p class="muted tiny" style="margin-top: var(--space-4);">No overflowed topics — everything fits inline above.</p>`
    }`;

  // Lazy-load reference bodies on first expand.
  body.querySelectorAll(".skill-ref").forEach((det) => {
    det.addEventListener(
      "toggle",
      async () => {
        if (!det.open || det.dataset.loaded === "true") return;
        det.dataset.loaded = "true";
        const slot = det.querySelector(".skill-ref-body");
        try {
          const sec = await api.post("/api/context", {
            type: "skill_section",
            projectId,
            topic: det.dataset.topic,
          });
          slot.innerHTML = `<pre class="skill-body-text">${escapeHtml(sec.content || "")}</pre>${sec.truncated ? `<p class="muted tiny">Truncated.</p>` : ""}`;
        } catch (err) {
          det.dataset.loaded = "false";
          slot.innerHTML = `<p class="placeholder tiny error">Failed to load: ${escapeHtml(err.message)}</p>`;
        }
      },
      { passive: true }
    );
  });
}

async function recompile(container, projectId) {
  if (!llmReady) {
    toast.error("No LLM provider configured — set one in Settings.");
    return;
  }
  const btns = container.querySelectorAll("#skill-recompile, #skill-recompile-empty");
  btns.forEach((b) => (b.disabled = true));
  toast.info?.("Recompiling skill…");
  try {
    const result = await api.post("/api/skill/compile", { projectId });
    toast.success(
      `Skill recompiled — ${result.topicsWritten} topics, ${result.referencesWritten} references.`
    );
    await loadSkill(container, projectId);
  } catch (err) {
    const code = err.body?.details?.code || err.body?.code;
    if (err.status === 503 || code === "LLM_NOT_CONFIGURED") {
      toast.error("No LLM provider configured — set one in Settings.");
    } else if (code === "SKILL_INSUFFICIENT_SOURCES") {
      toast.error("Not enough lessons/decisions yet to compile a skill.");
    } else {
      toast.error("Recompile failed: " + err.message);
    }
  } finally {
    btns.forEach((b) => (b.disabled = false));
  }
}
