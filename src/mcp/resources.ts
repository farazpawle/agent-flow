/**
 * MCP Resources surface (Phase 3 Group 19.2).
 *
 * Re-exposes the three read-only view tools (`project_view`, `task_view`,
 * `context_get`) as MCP Resources. The underlying handlers are reused
 * verbatim — this module is a transport layer:
 *
 *   - `resources/list`           → returns a small set of static
 *                                  "starter" resources clients can read
 *                                  immediately (the full surface lives
 *                                  behind resource templates).
 *   - `resources/templates/list` → returns URI templates so clients can
 *                                  parameterise reads (`agentflow://
 *                                  views/task_view?action=get&taskId={
 *                                  taskId}`).
 *   - `resources/read`           → parses the URI's query string into
 *                                  the discriminated-union input, runs
 *                                  the existing tool handler, returns
 *                                  the inner JSON payload as
 *                                  `contents[0].text` with
 *                                  `mimeType=application/json`.
 *
 * URI grammar — kept deliberately ASCII-greppable so an MCP client can
 * hand-construct a URI from the tool docs:
 *
 *     agentflow://views/<tool>?<query>
 *
 *     <tool>  ∈ project_view | task_view | context_get
 *     <query> = URL-encoded key/value pairs matching the tool's input
 *               schema (e.g. action=get&taskId=t1).
 *
 * Why URI templates over hand-rolled URIs per action: each view tool is
 * a discriminated union over `action` / `type`, so wiring one URI
 * template per branch would mean ~15 templates for marginal value. A
 * single template with a `query` placeholder per tool surfaces the
 * shape without burying the discriminator vocabulary.
 */

import type { ZodTypeAny } from "zod";
import { safeParseTool } from "../utils/schemaParse.js";
import { toAppError } from "../utils/errors.js";
import {
  projectView,
  projectViewSchema,
  taskView,
  taskViewSchema,
  contextGet,
  contextGetSchema,
} from "../tools/views/index.js";

export const RESOURCE_URI_SCHEME = "agentflow";
export const RESOURCE_URI_PREFIX = `${RESOURCE_URI_SCHEME}://views/`;

interface ViewBinding {
  tool: string;
  schema: ZodTypeAny;
  handler: (input: unknown) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
  /** Human-readable description for `resources/list` / `templates/list`. */
  description: string;
  /** Example URI for `resources/list` quick-start. */
  exampleUri: string;
}

const VIEW_BINDINGS: Record<string, ViewBinding> = {
  project_view: {
    tool: "project_view",
    schema: projectViewSchema,
    handler: projectView as (
      i: unknown
    ) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
    description:
      "Read-only project view. Query keys: action ∈ list|get|summary|active; projectId; clientId (for action=active).",
    exampleUri: `${RESOURCE_URI_PREFIX}project_view?action=list`,
  },
  task_view: {
    tool: "task_view",
    schema: taskViewSchema,
    handler: taskView as (
      i: unknown
    ) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
    description:
      "Read-only task view. Query keys: action ∈ list|get|search|next_ready|by_status; projectId; taskId; status; query.",
    exampleUri: `${RESOURCE_URI_PREFIX}task_view?action=list`,
  },
  context_get: {
    tool: "context_get",
    schema: contextGetSchema,
    handler: contextGet as (
      i: unknown
    ) => Promise<{ content: Array<{ type: "text"; text: string }> }>,
    description:
      "Token-budgeted context bundle. Query keys: type ∈ project_summary|implementation_context|verification_context|lessons|similar_tasks|decisions|findings; projectId; taskId; maxTokens.",
    exampleUri: `${RESOURCE_URI_PREFIX}context_get?type=project_summary&projectId=p1`,
  },
};

export const VIEW_TOOL_NAMES = Object.freeze(Object.keys(VIEW_BINDINGS));

export interface ResourceListEntry {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceTemplateEntry {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface ResourceReadContent {
  uri: string;
  mimeType: string;
  text: string;
}

/**
 * `resources/list` response — the lightweight starter set. Clients
 * wanting to construct parameterised URIs read `templates/list`
 * instead.
 */
export function listResources(): ResourceListEntry[] {
  return Object.values(VIEW_BINDINGS).map((b) => ({
    uri: b.exampleUri,
    name: b.tool,
    description: b.description,
    mimeType: "application/json",
  }));
}

/**
 * `resources/templates/list` response — RFC 6570 URI templates so
 * clients can construct calls programmatically.
 */
export function listResourceTemplates(): ResourceTemplateEntry[] {
  return Object.values(VIEW_BINDINGS).map((b) => ({
    // RFC 6570 query-string expansion: {?query*} — single opaque
    // string placeholder for the full query, since each tool
    // expresses its own discriminated-union vocabulary inside the
    // schema. Documenting each branch as a separate template
    // would obscure the discriminator pattern that's already in
    // the description.
    uriTemplate: `${RESOURCE_URI_PREFIX}${b.tool}{?query*}`,
    name: b.tool,
    description: b.description,
    mimeType: "application/json",
  }));
}

/**
 * Parse `?key=value&...` into a typed input the view tool expects.
 * Discriminated-union keys like `action` and `type` are kept as raw
 * strings; the schema's `.safeParse` will narrow them. Numeric-looking
 * values stay strings — the view tool schemas all use string fields
 * or `.coerce.number()` where they accept numbers (e.g. `maxTokens`).
 */
function parseQuery(rawQuery: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!rawQuery) return out;
  // URL constructor handles encoding without our needing to roll a
  // parser, but it requires a base.
  const params = new URLSearchParams(rawQuery);
  for (const [k, v] of params) out[k] = v;
  return out;
}

export class UnknownResourceError extends Error {
  readonly status = 404;
  constructor(uri: string) {
    super(`Unknown resource URI '${uri}'. Expected ${RESOURCE_URI_PREFIX}<tool>?…`);
  }
}

/**
 * Implements `resources/read`. Returns the tool's MCP-shape inner JSON
 * as a single content block with `mimeType=application/json`. Errors
 * propagate as the existing `AppError` hierarchy so the index.ts
 * wrapper can translate to MCP error envelopes consistently.
 */
export async function readResource(uri: string): Promise<{
  contents: ResourceReadContent[];
}> {
  if (!uri.startsWith(RESOURCE_URI_PREFIX)) {
    throw new UnknownResourceError(uri);
  }
  const rest = uri.slice(RESOURCE_URI_PREFIX.length);
  const qIndex = rest.indexOf("?");
  const tool = qIndex === -1 ? rest : rest.slice(0, qIndex);
  const query = qIndex === -1 ? "" : rest.slice(qIndex + 1);

  const binding = VIEW_BINDINGS[tool];
  if (!binding) throw new UnknownResourceError(uri);

  const args = parseQuery(query);
  const parsed = safeParseTool(binding.tool, binding.schema, args);
  if (!parsed.ok) {
    // Surface as the same typed AppError the MCP error envelope
    // already knows how to render.
    throw parsed.error;
  }

  try {
    const result = await binding.handler(parsed.data);
    const text = result.content?.[0]?.text ?? "{}";
    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text,
        },
      ],
    };
  } catch (err) {
    // Re-throw as AppError so the index.ts wrapper renders an MCP
    // error consistently.
    throw toAppError(err);
  }
}
