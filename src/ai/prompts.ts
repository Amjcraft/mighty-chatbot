// To-do: Not a huge fan of this approach. Maybe looking to refactor at some point.

import type { z } from "zod";
import type { ArtifactRegistry } from "../artifacts/registry";

// ---------------------------------------------------------------------------
// Minimal Zod → JSON Schema converter (handles the common subset used in
// artifact definitions). Not exhaustive — just enough for prompt injection.
// ---------------------------------------------------------------------------

type JsonSchemaNode = Record<string, unknown>;

function zodDefToJsonSchema(def: z.ZodTypeAny["_def"]): JsonSchemaNode {
  const typeName: string = (def as { typeName?: string }).typeName ?? "";

  switch (typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodLiteral": {
      const value = (def as { value?: unknown }).value;
      return { type: typeof value, enum: [value] };
    }
    case "ZodEnum": {
      const values: unknown[] = (def as { values?: unknown[] }).values ?? [];
      return { type: "string", enum: values };
    }
    case "ZodArray": {
      const inner = (def as { type?: z.ZodTypeAny }).type;
      return {
        type: "array",
        items: inner ? zodDefToJsonSchema(inner._def) : {},
      };
    }
    case "ZodOptional":
    case "ZodNullable": {
      const inner = (def as { innerType?: z.ZodTypeAny }).innerType;
      return inner ? zodDefToJsonSchema(inner._def) : {};
    }
    case "ZodObject": {
      const shape: Record<string, z.ZodTypeAny> =
        (def as { shape?: () => Record<string, z.ZodTypeAny> }).shape?.() ?? {};
      const properties: Record<string, JsonSchemaNode> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodDefToJsonSchema(value._def);
        const inner = (value._def as { innerType?: unknown }).innerType;
        const isOptional =
          value._def.typeName === "ZodOptional" ||
          value._def.typeName === "ZodNullable" ||
          inner !== undefined;
        if (!isOptional) {
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }
    default:
      return {};
  }
}

function zodToJsonSchema(schema: z.ZodTypeAny): JsonSchemaNode {
  return zodDefToJsonSchema(schema._def);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildSystemPrompt(
  base: string,
  registry: ArtifactRegistry
): string {
  if (registry.size === 0) {
    return base;
  }

  const lines: string[] = [
    "",
    "## Available Artifact Types",
    "",
    "You can propose structured actions to the user by calling the `propose-action` tool.",
    "Each call must use one of the registered types below.",
    "Produce data that matches the JSON Schema exactly.",
    "",
  ];

  for (const [type, def] of registry) {
    const schema = zodToJsonSchema(def.schema);
    lines.push(`### ${type}`);
    lines.push("```json");
    lines.push(JSON.stringify(schema, null, 2));
    lines.push("```");
    lines.push("");
  }

  return `${base.trimEnd()}\n${lines.join("\n")}`;
}
