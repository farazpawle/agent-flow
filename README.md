# AgentFlow 🚀

[![smithery badge](https://smithery.ai/badge/@farazpawle/agent-flow)](https://smithery.ai/server/@farazpawle/agent-flow)

AgentFlow is an MCP server for structured AI task execution with a built-in real-time web dashboard.

It combines:

- MCP tools for staged planning, task splitting, execution, and verification
- Local/remote persistence (SQLite or Supabase)
- A web UI with SSE live updates

---

## Features

- 🧠 Unified staged reasoning pipeline (`plan_idea` with `stage=plan|analyze|review`)
- 🧩 DAG-based task breakdown and dependency-aware execution
- ✅ Verification and completion workflow for reliable task closure
- 📁 Workspace-aware project context and project lifecycle tools
- 🎮 Real-time dashboard updates over Server-Sent Events (SSE)
- ⚛️ Pluggable persistence via SQLite or Supabase

---

## Installation

### Option 1: Smithery

```bash
npx -y @smithery/cli install agent-flow --client claude
```

### Option 2: Local development

```bash
git clone https://github.com/farazpawle/agent-flow.git
cd agent-flow
npm install
npm run build
```

---

## Run modes

### 1) GUI mode (web dashboard)

Starts the dashboard server.

> ✅ `npm run start` / `npm run gui` always starts the web UI server.

Recommended local startup sequence:

1. Build once: `npm run build`
2. Start GUI: `npm run start` (or `npm run gui`)

```bash
npm run start
```

or

```bash
npm run gui
```

### 2) MCP mode (tool server over stdio)

Starts AgentFlow for MCP clients. If GUI is enabled, it can also spawn/connect to the shared dashboard server.

If you want MCP + dashboard together, set `WEB_UI_ENABLED=true` in `.env` before running:

```bash
npm run mcp
```

### 3) Development mode

```bash
npm run dev
```

---

## Web UI access

By default, AgentFlow serves the dashboard on:

- **http://localhost:<WEB_UI_PORT>**

Port can be overridden with:

- set `WEB_UI_PORT` in `.env` (default: `54544`)

If `WEB_UI_ENABLED=true`, AgentFlow writes a file named `WebGUI.md` in `DATA_DIRECTORY` with the dashboard link.

---

## UI not opening? (Troubleshooting)

If you can't access the dashboard, check these in order:

1. **GUI is enabled**
   - For `npm run start` / `npm run gui`, this is **not required**.
   - For `npm run mcp`, set `.env` to `WEB_UI_ENABLED=true` if you want dashboard + MCP together.

2. **You built the project**
   - `npm run start` runs `dist/index.js`
   - Run `npm run build` first (especially in local dev)

3. **Correct port**
   - Default is `54544`, override via `WEB_UI_PORT`
   - Open `http://localhost:<WEB_UI_PORT>`

4. **Check generated UI link**
   - Open `WebGUI.md` inside your `DATA_DIRECTORY`
   - It contains the exact dashboard URL being served

5. **Port conflict / firewall checks (Windows)**
   - Check listener: `netstat -ano | findstr :54544`
   - If occupied, change `WEB_UI_PORT` in `.env` and restart
   - Allow Node.js through Windows Firewall for local network access

6. **Inspect logs**
   - `logs/spawn-server.log`
   - `server_stdio.log`

### Quick one-liner (Windows CMD)

```cmd
npm run build && npm run start
```

### Access from another device on same LAN

Use your machine IPv4 + port, e.g.:

- `http://192.168.1.178:54544`

---

## Configuration

Copy `.env.example` to `.env` and set values.

```env
DATA_DIRECTORY="C:/MyProject/agent-flow-data"
THOUGHT_CHAIN_ENABLED=true
PROMPT_TEMPLATE_SET=en
WEB_UI_ENABLED=true
DETAILED_MODE_ENABLED=false

DATABASE_PROVIDER=sqlite
# DATABASE_PROVIDER=supabase
# SUPABASE_PROJECT_URL="https://your-project.supabase.co"
# SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"

# Optional (default is 54544)
# WEB_UI_PORT=54544

# Browser auto-open behavior:
# Auto-open is enabled by default when the primary GUI server starts.
# Set to false to disable automatic browser launch.
AUTO_OPEN_WEB_UI=true
```

Legacy names are still accepted for backward compatibility.

### Important environment variables

- `DATA_DIRECTORY` (recommended): absolute path for persistent data
- `WEB_UI_ENABLED`: enable dashboard server
- `DETAILED_MODE_ENABLED`: per-task conversation history in UI
- `AUTO_OPEN_WEB_UI`: set `false` to prevent browser auto-open on first GUI server start
- `DATABASE_PROVIDER`: `sqlite` or `supabase`
- `SUPABASE_PROJECT_URL`, `SUPABASE_SERVICE_ROLE_KEY`: required when `DATABASE_PROVIDER=supabase`
- `WEB_UI_PORT`: web UI port (defaults to `54544`)

Legacy names still supported: `DATA_DIR`, `ENABLE_THOUGHT_CHAIN`, `TEMPLATES_USE`, `ENABLE_GUI`, `ENABLE_DETAILED_MODE`, `SERVER_PORT`, `ENABLE_AUTO_OPEN`, `DISABLE_AUTO_OPEN`, `DB_TYPE`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

---

## MCP client registration example

Example (Cursor MCP config):

```json
{
  "mcpServers": {
    "agent-flow": {
      "command": "npx",
      "args": ["-y", "agent-flow"]
    }
  }
}
```

You can also pass environment variables in your MCP client config if needed.

---

## Available MCP tools

Phase 1 reshaped the surface from 15 legacy tools to **12** (10 primary + 2
deprecation shims). Every primary tool uses a discriminated-union schema, so
the action you want to take is encoded in a single `action` / `mode` / `kind`
/ `workflow` discriminator value the client must supply.

### Read-only

- `project_view` — discriminated on `action`: `list` / `get` / `summary` / `active` (active is per-client via `client_active_project`).
- `task_view` — discriminated on `action`: `list` / `get` / `search` / `next_ready` / `by_status`. Every returned task includes `version` for use as `expectedVersion`.
- `context_get` — token-budgeted, LLM-free context bundles discriminated on `type`: `project_summary` / `implementation_context` / `verification_context` / `lessons` / `similar_tasks` / `decisions` / `findings`.

### Edits (non-destructive)

- `project_edit` — discriminated on `action`: `create` / `update` / `set_active` (client-scoped).
- `task_edit` — discriminated on `action`: `create` / `update` / `reorder` / `set_priority` / `set_dependency` / `clear_dependency` / `split` / `merge`. Single-task actions require `expectedVersion`; `reorder` + `merge` require an `expectedVersions` map.

### Destructive (dry-run / execute split)

- `project_delete` — `mode='dry_run'` shows affected counts; `mode='execute'` requires `reason ≥ 10` and `confirm: true`.
- `task_delete` — compound `op = <action>.<mode>`. `clear_all_for_project.execute` requires `reason ≥ 20`. Every execute writes an entry to the `destructive_audits` table.

### Lifecycle

- `task_lifecycle` — discriminated on `action`: `claim` / `start` / `block` / `unblock` / `request_review` / `finalize` / `reopen` / `archive`. Only `finalize` requires `expectedVersion`. `finalize.result` is itself a discriminated union on `verdict`: `pass` / `fail` / `partial` / `needs_review`, each branch with its own required fields enforced at the JSON Schema layer.

### Append-only history

- `artifact_record` — discriminated on `kind`: `finding` / `test_log` / `build_log` / `reference` / `commit` / `pull_request` / `evidence`. Returns `findingId` for use as evidence references downstream. No UPDATE/DELETE handler is exposed.

### Workflows

- `workflow_run` — discriminated on `workflow`. Eleven workflows available: `plan`, `analyze`, `review`, `split_plan`, `process_thought`, `record_decision`, `review_task_quality`, `build_context_pack`, `summarize_lessons`, `detect_duplicates`, `generate_release_summary`.
  - **Modes (`WORKFLOW_MODE` env, default `manual`):**
    - `manual` — returns the structured §4.4 contract (`purpose`, `inputRequired`, `steps`, `outputSchema`, `qualityChecklist`, `nextRecommendedCalls`) for the calling agent to execute. **No LLM key required.**
    - `agent` — calls the configured LLM provider (Phase 2 Group 15). When the provider is unset (`LLM_PROVIDER=none`), quota-exceeded, or the input is over the per-workflow token budget, the call falls back to the manual contract + an `agentFallback` envelope. Other provider errors (auth, network, content-filter, schema-failure-after-retry) propagate as tool errors — see `CHANGELOG.md` "Phase 2 Group 15" for the full contract.
    - `disabled` — returns a typed `WORKFLOW_DISABLED` payload without invoking any workflow.
  - Per-call `mode` field overrides the env default.
  - Same Zod schema validates both manual-mode `outputSchema` (via `zodToJsonSchema`) and agent-mode provider responses. The two surfaces cannot drift.

### LLM provider layer (Phase 2)

Four providers are wired through the [Vercel AI SDK](https://sdk.vercel.ai/):
**OpenAI**, **Anthropic**, **OpenRouter**, **DeepSeek**. Swap providers by
setting `LLM_PROVIDER` in env or via the GUI Settings panel — no code change
required. Model selection supports five strategies (`manual` / `latest_code` /
`latest_reasoning` / `cheapest` / `fastest`) over a live per-provider model
catalogue cached for `LLM_MODEL_REFRESH_TTL_HOURS` (default 24h, refreshable
via `POST /api/llm/model/refresh`).

**Security invariants:**

- **API keys are env-only.** They are never persisted to `llm_settings` (the column doesn't exist), never returned by `GET /api/llm/settings`, and never accepted by `POST /api/llm/settings` (the body schema is `.strict()`).
- `LLM_CONFIG_LOCK=true` makes the DB-backed settings effectively read-only — `POST /api/llm/settings` returns HTTP 403, and the GUI panel disables the Save button.
- Destructive workflows (`split_plan`, `detect_duplicates`) return proposals only. The agent must call `task_edit(action='split'|'merge')` to apply.

**HTTP surface (GUI mode):**

| Method + Path                     | Purpose                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------ |
| `GET  /api/llm/providers`         | Boolean `keyConfigured` per provider + env var name. Never returns key values. |
| `GET  /api/llm/models?provider=…` | Cached model catalogue (capabilities + pricing).                               |
| `POST /api/llm/model/refresh`     | Bypass TTL and refetch the catalogue.                                          |
| `GET  /api/llm/settings`          | Effective config + per-field source (`env` / `db` / `default`).                |
| `POST /api/llm/settings`          | Persist provider / model / strategy / mode. 403 when `LLM_CONFIG_LOCK=true`.   |

**Audit trail:** every LLM call writes a `workflow_steps` row with
`stepType='LLM_CALL'`, `toolName='workflow_run'`, `durationMs`, `inputTokens` /
`outputTokens`, `correlationId`, and a structured `content` JSON payload
containing `provider`, `model`, `selectionStrategy`, and `workflow`.

See `.env.example` for the full list of LLM env vars and their defaults.

### Deprecation shims (slated for removal in `1.2.0`)

- `verify_task` — routes to `task_lifecycle(action='request_review')` and writes a `kind='evidence'` finding. **Never advances a task to COMPLETED** — closes the legacy silent auto-pass bug by construction.
- `complete_task` — routes to `task_lifecycle(action='finalize', verdict='pass')`. Now requires `summary` (≥10 chars), `lessonsLearned` (≥10 chars), and `expectedVersion`.

Every shim call emits a `DEPRECATED` warning block on the response and a
`deprecation` SSE event for the GUI activity log. See `CHANGELOG.md`
"Migration guide (legacy tool → v2 equivalent)" for the full mapping.

---

## Supabase setup

If using Supabase:

1. Run SQL from `scripts/supabase-schema.sql` in Supabase SQL Editor.
2. Set `DATABASE_PROVIDER=supabase` and credentials in `.env`.
3. Validate setup:

```bash
npm run supabase:check
```

4. (Optional) migrate local SQLite data:

```bash
npm run supabase:migrate
```

---

## Development scripts

- `npm run build` – compile TypeScript and copy runtime assets
- `npm run dev` – run from source with tsx
- `npm run dev:watch` – run with nodemon watch
- `npm run start` / `npm run gui` – GUI mode
- `npm run mcp` – MCP stdio mode
- `npm run test` – run the Vitest suite (unit + integration)
- `npm run test:watch` – Vitest in watch mode
- `npm run test:coverage` – Vitest with coverage report (v8)
- `npm run test:legacy` – run the legacy `tsx tests/unit/test-rigorous.ts` harness
- `npm run lint` / `npm run lint:fix` – ESLint (typescript-eslint, flat config)
- `npm run format` / `npm run format:check` – Prettier
- `npm run typecheck` – `tsc --noEmit`

Git hooks: `npm install` invokes Husky's `prepare` script which installs the
`.husky/pre-commit` hook. The hook runs `lint-staged`, so staged TypeScript /
JavaScript files are lint-fixed and Prettier-formatted before each commit.

## Observability

All runtime logs go through a centralized [pino](https://github.com/pinojs/pino)
logger (`src/utils/logger.ts`). Output is always written to **stderr** so it
never collides with the MCP stdio protocol on stdout.

- `LOG_LEVEL` – `trace | debug | info | warn | error | fatal | silent`
- `AGENTFLOW_LOG_JSON=1` – force JSON output in development (pino-pretty is the default)

Each `/api/*` request is correlated with a short ID echoed back as
`X-Correlation-Id`; tool invocations emit a `tool_invocation` telemetry
event (see `src/utils/telemetry.ts`).

---

## License

MIT
