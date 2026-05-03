import { tool, type UIMessageStreamWriter } from "ai";
import { z } from "zod";
import type { ArtifactRegistry } from "../../artifacts/registry";

const proposeActionInputSchema = z.object({
  type: z.string().describe("The artifact type to propose."),
  // biome-ignore lint/suspicious/noExplicitAny: tool input data is validated at runtime against the artifact's Zod schema
  data: z.any().describe("The artifact data matching the type's schema."),
});

export type ProposeActionInput = z.infer<typeof proposeActionInputSchema>;

type BuildProposeActionToolProps = {
  registry: ArtifactRegistry;
  dataStream: UIMessageStreamWriter;
};

export function buildProposeActionTool({
  registry,
  dataStream,
}: BuildProposeActionToolProps) {
  const availableTypes = [...registry.keys()].join(", ");

  return tool({
    description: `Propose a structured action to the user. Available types: ${availableTypes}. The 'data' field must match the JSON Schema for the given type.`,
    inputSchema: proposeActionInputSchema,
    execute: async ({
      type,
      data,
    }: ProposeActionInput): Promise<{
      type: string;
      data: unknown;
    }> => {
      const def = registry.get(type);
      if (!def) {
        throw new Error(
          `Unknown artifact type "${type}". Available: ${availableTypes}`
        );
      }

      const result = def.schema.safeParse(data);
      if (!result.success) {
        throw new Error(
          `Invalid data for type "${type}": ${result.error.message}`
        );
      }

      dataStream.write({
        type: "data-proposed-action",
        data: { type, data: result.data },
      });

      return { type, data: result.data };
    },
  });
}
