import type React from "react";
import type { z } from "zod";
import type { ActionEvent } from "../core/types";

export interface ArtifactDefinition<T extends z.ZodType> {
  type: string;
  schema: T;
  component: React.ComponentType<{
    data: z.infer<T>;
    onConfirm: (action: ActionEvent) => void;
    onDismiss: () => void;
  }>;
}

export function defineArtifact<T extends z.ZodType>(
  def: ArtifactDefinition<T>,
): ArtifactDefinition<T> {
  return def;
}
