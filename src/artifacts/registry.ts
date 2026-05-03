import type { z } from "zod";
import type { ArtifactDefinition } from "./types";

export type ArtifactRegistry = Map<string, ArtifactDefinition<z.ZodType>>;

export function buildRegistry(
  artifacts: ArtifactDefinition<z.ZodType>[]
): ArtifactRegistry {
  const registry: ArtifactRegistry = new Map();
  for (const artifact of artifacts) {
    if (registry.has(artifact.type)) {
      console.warn(
        `[mighty-chatbot] Duplicate artifact type "${artifact.type}" — last registration wins.`
      );
    }
    registry.set(artifact.type, artifact);
  }
  return registry;
}
