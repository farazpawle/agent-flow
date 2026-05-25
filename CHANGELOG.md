[English](CHANGELOG.md)

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added — Phase 1 MCP tool surface redesign (2026-05-24)

The MCP tool surface has been reshaped from 15 legacy tools to **12** —
10 primary tools plus 2 deprecation shims. Every primary tool uses
discriminated unions where appropriate, optimistic concurrency on
mutating paths, and append-only history for findings/artifacts.

**Primary tools (10):**

| Tool              | Discriminator                                                                                                                                                                                       | Purpose                                                                           |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `project_view`    | `action` (list / get / summary / active)                                                                                                                                                            | Read-only project access                                                          |
| `task_view`       | `action` (list / get / search / next_ready / by_status)                                                                                                                                             | Read-only task access; every response includes `version`                          |
| `context_get`     | `type` (project_summary / implementation_context / verification_context / lessons / similar_tasks / decisions / findings)                                                                           | Token-budgeted, LLM-free context bundles                                          |
| `project_edit`    | `action` (create / update / set_active)                                                                                                                                                             | Non-destructive project edits; `set_active` is per-client                         |
| `task_edit`       | `action` (create / update / reorder / set_priority / set_dependency / clear_dependency / split / merge)                                                                                             | Non-destructive task edits with `expectedVersion` OCC                             |
| `project_delete`  | `mode` (dry_run / execute)                                                                                                                                                                          | Destructive project delete with `reason ≥ 10` + `confirm: true`                   |
| `task_delete`     | compound `op = <action>.<mode>` (delete_one / delete_many / clear_all_for_project × dry_run / execute)                                                                                              | Destructive task delete; `clear_all_for_project.execute` requires `reason ≥ 20`   |
| `task_lifecycle`  | `action` (claim / start / block / unblock / request_review / finalize / reopen / archive) + nested `result.verdict` (pass / fail / partial / needs_review)                                          | Unified lifecycle; only `finalize` requires `expectedVersion`                     |
| `artifact_record` | `kind` (finding / test_log / build_log / reference / commit / pull_request / evidence)                                                                                                              | Append-only artifact ingestion — no UPDATE/DELETE                                 |
| `workflow_run`    | `workflow` (plan / analyze / review / split_plan / process_thought / record_decision / review_task_quality / build_context_pack / summarize_lessons / detect_duplicates / generate_release_summary) | Structured workflow contract; manual mode in Phase 1, agent mode lands in Phase 2 |

**Compatibility shims (2)** — route through `task_lifecycle`, marked
`(DEPRECATED)` in their MCP description, slated for removal in `1.2.0`:

- `verify_task` → `task_lifecycle(action='request_review')` (records `kind='evidence'` finding; NEVER advances to COMPLETED)
- `complete_task` → `task_lifecycle(action='finalize', verdict='pass')` (now requires `summary`, `lessonsLearned`, `expectedVersion`)

**Removed tools (13):** `plan_idea`, `process_thought`, `split_tasks`,
`list_tasks`, `find_task`, `list_projects`, `get_project_context`,
`create_project`, `update_task`, `reorder_tasks`, `delete_task`,
`delete_project`, plus `execute_task` (subsumed by `task_lifecycle`).

#### Phase-1 cross-cutting work

- **Optimistic concurrency** on every mutating tool — `tasks.version` column
  is bumped atomically; CONFLICT responses include the full current task
  body so callers can render a diff (plan §6.4).
- **Append-only history** — `task_findings` (kind: finding / evidence /
  commit / pull_request / test_log / build_log / reference) survives task
  edits thanks to the new UPSERT path in `SQLiteAdapter.saveTask` (fixes a
  CASCADE-loss bug discovered during Group 9 testing).
- **Per-client active project** — `client_active_project` table; the
  legacy global pointer is gone. GUI topbar surfaces the per-client value.
- **Destructive audit log** — every `mode='execute'` write goes to
  `destructive_audits` with caller, reason, affected IDs, correlation ID.
- **Deprecation SSE channel** — shim calls emit `event: deprecation` on
  `/api/tasks/stream`; the dashboard activity log renders them live.
- **Telemetry coverage** — every new tool handler is wrapped with
  `withToolTelemetry`; every new `/api/*` route gets `X-Correlation-Id`,
  rate-limiting (300 req/min), and Zod body validation through
  `safeParseTool` / `viewBodyRoute`.
- **CI hardening** — schema golden fixtures (`tests/fixtures/schemas/*.json`)
  asserted by `npm run schemas:check`; `audit:hardcoded-prompts`,
  `audit:prompt-tools`, `audit:superrefine` all wired into the CI workflow.
- **GUI Phase-1 refresh** — task detail page now uses a 5-section layout
  (Summary / Work Definition / Result / Context / Advanced); CONFLICT
  responses render a side-by-side diff modal with cancel / reload / retry
  actions (never blind-retries); project and task delete flows now require
  a dry-run preview before execute; new findings panel inside the Advanced
  section pulls from `context_get(type='findings')`.

### Added — Phase 2 Group 15 LLM workflow implementations (2026-05-25)

- **Agent mode for `workflow_run`** — when `WORKFLOW_MODE=agent` (and an
  LLM provider is configured), the 11 workflows route to the configured
  provider via `src/llm/workflows/runner.ts`. Manual mode remains the
  default and is unchanged. Per-call `mode` still overrides env.
- **Single-source-of-truth Zod schemas** (`src/llm/workflows/_schemas.ts`)
  drive **both** the manual-mode `outputSchema` JSON Schema (derived via
  `zodToJsonSchema` in `src/tools/workflows/definitions.ts`) **and** the
  agent-mode response validation. The two surfaces can never drift.
- **Per-workflow modules** under `src/llm/workflows/<name>.ts` carry the
  system prompt, user-prompt template, output schema reference, and
  input/output token budgets. Adding a workflow is one file + a
  registry entry.
- **Generation strategy** — runner tries `LlmProvider.generateObject(schema)`
  first; on Zod-validation failure it issues **exactly one** retry via
  `generateText` with the validation errors embedded in the prompt.
  A retry that also fails to parse surfaces an `ExternalServiceError`
  rather than recursing.
- **Input token-budget gate** — every call estimates `system + user`
  prompt tokens via the existing `tokenBudget.estimateTokens` heuristic
  and rejects oversize calls **before** any provider client is built or
  network traffic flows. Oversize errors carry `details.code =
TOKEN_BUDGET_EXCEEDED`.
- **Graceful fallback envelope** — `workflow_run(mode=agent)` returns
  the manual contract + an `agentFallback: { reason, note, providerError }`
  block when the failure is one of:
  - `PROVIDER_NOT_CONFIGURED` (LLM_PROVIDER unset or `none`)
  - `QUOTA_EXCEEDED` (provider returned 429 / `insufficient_quota` /
    `quota_exceeded`)
  - `TOKEN_BUDGET_EXCEEDED` (input over the workflow budget)

  Other provider errors (auth, network, content-filter, schema failure
  after retry) propagate as tool errors — they are real failures the
  caller must see, not silently masked.

- **Proposal-only safety guarantee** — `split_plan` and
  `detect_duplicates` return proposals; the runner imports nothing from
  `models/taskModel`, `tools/edits`, `tools/deletes`, or
  `tools/lifecycle` (structurally enforced; regression-tested by a
  source grep).
- **Telemetry** — every provider call goes through `withLlmTelemetry`,
  recording `{provider, model, selectionStrategy, modelListAge,
inputTokens, outputTokens, latencyMs, outcome}` in `workflow_steps`
  with `stepType='LLM_CALL'`.

### Added — Phase 2 Group 16 LLM HTTP API + audit surface (2026-05-25)

Five new Express routes under `/api/llm/*` expose the Group 13/14
provider and model layers to the GUI. Handlers live in
`src/llm/http/handlers.ts` so they can be unit-tested without spinning
Express.

- `GET /api/llm/providers` — boolean `keyConfigured` flag per provider
  plus the env var name the key is read from. API key values themselves
  are never returned.
- `GET /api/llm/models?provider=<id>` — cached model list (capabilities
  - pricing). Bypasses the cache only via the refresh route.
- `POST /api/llm/model/refresh` — force a re-fetch. Body validated via
  `safeParseTool(llmModelRefreshBodySchema)`. Subject to the existing
  `/api` `mutationLimiter` (300 req/min).
- `GET /api/llm/settings` — effective `provider` / `model` /
  `selectionStrategy` / `workflowMode` plus `providerSource` and
  `modelSource` labels (`env` | `db` | `default`) so the GUI can render
  per-field origin badges. **Never** includes API keys.
- `POST /api/llm/settings` — persist provider / model / strategy /
  mode. Body schema is `.strict()`, rejecting `apiKey` /
  `OPENAI_API_KEY` / any other unknown field at parse time. `null`
  values clear a column; `undefined` leaves it alone.

**Security invariants enforced in code, not in convention:**

- `LLM_CONFIG_LOCK=true` → `POST /api/llm/settings` returns HTTP 403
  with `details.code = 'LLM_CONFIG_LOCKED'`. The guard runs BEFORE the
  body parse so a locked instance can't be probed for valid shapes
  via 400s.
- API key columns do not exist in the `llm_settings` table — keys are
  env-only by construction.

**Audit trail (`workflow_steps`)** — already wired by Group 14.5's
`withLlmTelemetry`. Group 16 testing asserts row coverage on every
LLM call: `stepType='LLM_CALL'`, `toolName='workflow_run'`,
`durationMs`, `inputTokens` / `outputTokens`, `correlationId`, and a
structured `content` JSON payload with `{provider, model,
selectionStrategy, workflow}`.

### Added — Phase 2 Group 17 GUI LLM Settings panel (2026-05-25)

A new "LLM provider" card in the Settings page (`src/public/pages/
settings.js`) consumes the Group 16 routes and lets the user manage the
provider/model/strategy/workflow-mode without a restart.

- **Provider selector** — radio list of every supported provider with
  per-provider `keyConfigured` / `key missing` badge plus the env var
  name (in monospace) the key is read from. There is intentionally **no
  input field for an API key** — keys are env-only by design, and the
  strict POST body schema rejects any `apiKey`-shaped field at parse
  time even if a future change tried to send one.
- **Model selector** — populated from `GET /api/llm/models?provider=…`;
  each option shows `<id> · <ctx>k ctx · $<x>/M in` when the provider
  reports it. A `Refresh` button calls `POST /api/llm/model/refresh` to
  bypass the TTL cache and re-fetch. If the persisted model is not in
  the list (e.g. env-fallback path), the panel still surfaces it tagged
  `(custom — not in list)` rather than silently dropping the value.
- **Source badges** — `env` / `db` / `default` chip rendered next to
  the Provider and Model labels using the `providerSource` and
  `modelSource` fields returned by `GET /api/llm/settings`. The GUI
  no longer guesses where a value came from.
- **Selection strategy** — `manual | latest_code | latest_reasoning |
cheapest | fastest`.
- **Workflow mode** — `manual | agent | disabled` (the same enum
  `workflow_run` accepts).
- **`LLM_CONFIG_LOCK=true` handling** — when locked, every field is
  disabled (with explanatory banner + tooltip) and the Save button is
  inert. The server-side guard (Group 16.5, HTTP 403) is still the
  load-bearing check; the client disable just removes the click
  affordance.
- **No-restart save flow** — Save posts to `POST /api/llm/settings`;
  on success the panel re-renders with the new `updatedAt` and the
  next `workflow_run(mode=agent)` reads the freshly persisted row
  because `createLlmProvider` re-resolves on every call (Group 13.4
  deliberately does not memoise).

#### Migration guide (legacy tool → v2 equivalent)

| Removed tool                              | Replacement                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `plan_idea(stage='plan')`                 | `workflow_run(workflow='plan')`                                                                                                     |
| `plan_idea(stage='analyze')`              | `workflow_run(workflow='analyze')`                                                                                                  |
| `plan_idea(stage='review')`               | `workflow_run(workflow='review')`                                                                                                   |
| `process_thought`                         | `workflow_run(workflow='process_thought')`                                                                                          |
| `split_tasks`                             | `workflow_run(workflow='split_plan')` → `task_edit(action='create')` per proposal                                                   |
| `split_tasks(updateMode='clearAllTasks')` | `task_delete(action='clear_all_for_project', mode='execute', reason ≥ 20, confirm: true)`                                           |
| `list_tasks`                              | `task_view(action='list')`                                                                                                          |
| `find_task`                               | `task_view(action='search')` or `task_view(action='get', taskId)`                                                                   |
| `list_projects`                           | `project_view(action='list')`                                                                                                       |
| `get_project_context`                     | `project_view(action='active', clientId)`                                                                                           |
| `create_project`                          | `project_edit(action='create')`                                                                                                     |
| `update_task` / `update_task_content`     | `task_edit(action='update', expectedVersion)`                                                                                       |
| `reorder_tasks`                           | `task_edit(action='reorder', expectedVersions)`                                                                                     |
| `delete_task`                             | `task_delete(action='delete_one', mode='dry_run')` → `task_delete(action='delete_one', mode='execute', reason ≥ 10, confirm: true)` |
| `delete_project`                          | `project_delete(mode='dry_run')` → `project_delete(mode='execute', reason ≥ 10, confirm: true)`                                     |
| `execute_task`                            | `task_lifecycle(action='start')`                                                                                                    |
| `verify_task` (legacy)                    | `task_lifecycle(action='request_review')` + `artifact_record(kind='evidence')` — or use the `verify_task` shim through `1.1.x`      |
| `complete_task` (legacy)                  | `task_lifecycle(action='finalize', expectedVersion, result.verdict=…)` — or use the `complete_task` shim through `1.1.x`            |

### Deprecated — Phase 1 Group 8 (2026-05-24)

- **`verify_task` and `complete_task`** are now compatibility shims that
  route through `task_lifecycle`. **Slated for removal in `1.2.0`.**
  - `verify_task` now writes a `kind='evidence'` finding and routes to
    `task_lifecycle(action='request_review')`. The shim NEVER advances a
    task to COMPLETED — the silent auto-pass bug of the legacy tool is
    closed by construction.
  - `complete_task` now requires `summary` (≥10 chars), `lessonsLearned`
    (≥10 chars), and `expectedVersion`, then routes to
    `task_lifecycle(action='finalize', result.verdict='pass')`.
  - Every shim response carries a `warning.DEPRECATED:true` block with
    the replacement call and removal version. A `deprecation` SSE event
    fires alongside the response so the GUI activity log surfaces a
    warning row.
  - Migration: replace `verify_task` + `complete_task` flows with
    `task_lifecycle(action='request_review')` followed by
    `task_lifecycle(action='finalize', result.verdict=…)`. The new
    surface supports failure verdicts (`fail` / `partial` /
    `needs_review`) the legacy tools could not express.

### Removed

- **Knowledge base (RAG) feature**: removed the crawler, OpenAI embedding provider, vector/hybrid search, the 5 MCP tools (`add_knowledge_source`, `list_knowledge_sources`, `delete_knowledge_source`, `search_knowledge`, `get_knowledge_page`), the `/api/knowledge` Express router, the Sources / Source detail / Page viewer / Knowledge search SPA pages, related env vars (`EMBEDDING_*`, `OPENAI_API_KEY`, `CRAWL_*`, `RAG_USE_HYBRID_SEARCH`), DB tables (`knowledge_sources`, `knowledge_pages`, `knowledge_chunks`, `rag_query_log`) and dependencies (`cheerio`, `fast-xml-parser`, `openai`, `sqlite-vec`, `turndown`).

## [2.0.0] - 2025-12-25

### Added

- **Light Theme Support**: Introduced a modern light theme with a toggle button in the header.
- **Title Animation**: Added a sleek gradient flow animation to the "AgentFlow" title.

### Changed

- **Rebranding**: Renamed the project to **AgentFlow** to reflect its expanded agentic workflow capabilities.
- **UI Improvements**: Updated the header, footer, and task cards for better aesthetics in both light and dark modes.
- **package.json**: Updated package name and description.
- **Localization**: Updated `locales/en.json` to reflect the new branding and fix i18n overrides.

## [1.5.0] - 2025-12-25

- Initial rebranding to "AgentFlow" and documentation cleanup.

## [Unreleased]

### Added — Tier 1 & 2 hardening (2026-05-20)

- **Structured logging** via pino (`src/utils/logger.ts`). All output to stderr so MCP stdio stays clean. `LOG_LEVEL` + `AGENTFLOW_LOG_JSON` env knobs.
- **Typed error hierarchy** (`src/utils/errors.ts`): `AppError`, `ValidationError`, `NotFoundError`, `ConflictError`, `AuthError`, `RagError`, `DatabaseError`. Helpers `toToolErrorResponse` (MCP) and `toHttpErrorBody` (Express). `errorResponse.ts` now re-exports the typed surface.
- **HTTP validation + auth** (`src/utils/httpValidation.ts`): Zod-validated `PATCH /api/tasks/:id` body (whitelist + size caps), `POST /api/tasks/reorder` body, and optional `?clientId=` validation on the SSE stream. `express-rate-limit` applied to mutating `/api/*` routes (300 req/min). Per-request correlation ID echoed as `X-Correlation-Id`.
- **Vitest test suite** (replaces `tests/unit/test-rigorous.ts` as the default `npm test`): `errors`, `httpValidation`, `taskGraph`, `promptLoader`, `telemetry`. `npm run test:legacy` still runs the old harness. GitHub Actions CI workflow at `.github/workflows/ci.yml`.
- **Telemetry**: `src/utils/telemetry.ts` with `withToolTelemetry` (tool invocation timing/outcome) and `recordRagQuery` (search outcome). Persisted to `workflow_steps` (new columns: `tool_name`, `duration_ms`, `input_tokens`, `output_tokens`, `outcome`, `error_code`, `correlation_id`) and to the new `rag_query_log` table; both SQLite and Supabase adapters write the rows.
- **Soft-delete columns** (`deleted_at`) on `tasks`, `projects`, `knowledge_sources` (both SQLite ALTER and Supabase schema).
- **Lint / format / hooks**: ESLint flat config (`eslint.config.mjs`), Prettier (`.prettierrc.json`, `.prettierignore`), Husky `pre-commit` running `lint-staged`. New scripts: `lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `test:watch`, `test:coverage`.

### Changed — Tier 1 & 2 hardening

- **Supabase RLS**: removed permissive "Allow all access" policies on `projects`, `tasks`, `workflow_steps`, `clients`, `knowledge_*`. Service-role-only policies replace them; anon/authenticated keys are denied (defense in depth — server uses the service-role key which bypasses RLS).
- `src/models/dbFactory.ts`: removed `dbInstance!` non-null assertion in favour of a type-guarded helper.
- `src/index.ts`: `app.use("/api", ...)` request logger + rate limiter; PATCH and reorder handlers use Zod validators; SSE endpoint validates `clientId` if provided.
- `src/tools/rag/search.ts`: calls `recordRagQuery` on success and failure (durations, hit counts, top score).

## [1.0.0] - 2025-05-05

### Changed

- Updated package.json and related configuration files
