/**
 * MCP tool `inputSchema` builder.
 *
 * Two independent validators must accept every tool's advertised
 * `inputSchema`, and their rules conflict for union schemas:
 *
 *   1. The MCP SDK client requires a top-level `"type": "object"`.
 *   2. The Anthropic Messages API requires the top level to be a plain
 *      object schema and **rejects `anyOf`/`oneOf`/`allOf` at the top
 *      level** — returning
 *      `400 tools.N.custom.input_schema: input_schema does not support
 *      oneOf, allOf, or anyOf at the top level`. This fails the WHOLE
 *      request, so attaching the MCP server breaks every Claude turn.
 *
 * All of AgentFlow's v2 tools (`task_view`, `task_lifecycle`,
 * `workflow_run`, …) are top-level `z.discriminatedUnion`s, which
 * `zod-to-json-schema` emits as a bare `{ anyOf: [...] }`. Simply bolting
 * on `type: "object"` satisfies (1) but still trips (2).
 *
 * The fix FLATTENS a top-level union into a single object schema:
 *   - merge the `properties` of every branch into one object,
 *   - collapse each discriminator literal (`const`) into an `enum` of all
 *     its branch values,
 *   - keep as root `required` only the fields required in EVERY branch
 *     (i.e. the discriminator(s)).
 *
 * This only loosens the *advertised* contract — the server still validates
 * each call against the original Zod discriminated union via
 * `safeParseTool`, so exactly one branch must match at runtime. Nested
 * unions that live under `properties` (e.g. `task_lifecycle`'s
 * `finalize.result`) are left untouched: the Anthropic restriction applies
 * to the top level only.
 */

import type { ZodTypeAny } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

export type JsonSchemaObject = Record<string, unknown>;

interface SchemaBranch {
  properties?: Record<string, JsonSchemaObject>;
  required?: string[];
  [key: string]: unknown;
}

function isPlainObject(value: unknown): value is JsonSchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert a Zod schema into a JSON Schema safe to advertise as an MCP
 * tool's `inputSchema`. Plain object schemas pass through (gaining a root
 * `type: "object"` if missing); top-level discriminated/plain unions are
 * flattened into a single object schema with the discriminator surfaced as
 * an enum.
 */
export function toMcpInputSchema(schema: ZodTypeAny): JsonSchemaObject {
  const json = zodToJsonSchema(schema, { $refStrategy: "none" }) as JsonSchemaObject;

  // The `$schema` dialect annotation is noise for an advertised payload.
  delete json.$schema;

  const branches = (json.anyOf ?? json.oneOf) as SchemaBranch[] | undefined;

  if (!Array.isArray(branches) || branches.length === 0) {
    // Already a plain schema. Guarantee a root object type for the MCP SDK.
    if (json.type !== "object") {
      return { type: "object", ...json };
    }
    return json;
  }

  // --- Flatten the union into one object schema ---------------------------
  const mergedProperties: Record<string, JsonSchemaObject> = {};
  const discriminatorValues: Record<string, unknown[]> = {};
  const requiredCounts: Record<string, number> = {};

  for (const branch of branches) {
    const properties = branch.properties ?? {};

    for (const [key, value] of Object.entries(properties)) {
      if (isPlainObject(value) && "const" in value) {
        // Discriminator literal — accumulate its value into an enum and
        // keep the rest of the keyword set (type, description, …) once.
        const bucket = (discriminatorValues[key] ??= []);
        if (!bucket.includes(value.const)) {
          bucket.push(value.const);
        }
        if (!mergedProperties[key]) {
          const { const: _const, ...rest } = value;
          mergedProperties[key] = { ...rest };
        }
      } else if (!mergedProperties[key]) {
        // First definition of a non-discriminator property wins; the
        // server-side Zod union remains the source of truth for the rest.
        mergedProperties[key] = isPlainObject(value) ? { ...value } : (value as JsonSchemaObject);
      }
    }

    for (const requiredKey of branch.required ?? []) {
      requiredCounts[requiredKey] = (requiredCounts[requiredKey] ?? 0) + 1;
    }
  }

  // Surface discriminators as enums (the model needs to see every legal value).
  for (const [key, values] of Object.entries(discriminatorValues)) {
    const target = (mergedProperties[key] ??= {});
    target.enum = values;
    if (!("type" in target)) {
      const valueTypes = new Set(values.map((v) => typeof v));
      if (valueTypes.size === 1) {
        target.type = valueTypes.has("number") || valueTypes.has("bigint") ? "number" : "string";
      }
    }
  }

  // Only fields required by EVERY branch can be required at the root.
  const required = Object.keys(requiredCounts).filter(
    (key) => requiredCounts[key] === branches.length
  );

  const flattened: JsonSchemaObject = {
    type: "object",
    properties: mergedProperties,
    additionalProperties: false,
  };
  if (required.length > 0) {
    flattened.required = required;
  }
  if (typeof json.description === "string") {
    flattened.description = json.description;
  }

  return flattened;
}
