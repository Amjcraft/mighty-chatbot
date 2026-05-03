"use client";

import type { z } from "zod";
import type { ArtifactDefinition } from "../artifacts/types";
import type { ActionEvent } from "../core/types";

export type ArtifactMessagePart = {
  type: string;
  data: unknown;
};

interface ArtifactRendererProps {
  artifacts: ArtifactDefinition<z.ZodType>[];
  part: ArtifactMessagePart;
  onConfirm: (action: ActionEvent) => void;
  onDismiss: () => void;
}

export function ArtifactRenderer({
  artifacts,
  part,
  onConfirm,
  onDismiss,
}: ArtifactRendererProps) {
  const def = artifacts.find((a) => a.type === part.type);

  if (!def) {
    return null;
  }

  const result = def.schema.safeParse(part.data);
  if (!result.success) {
    return null;
  }

  const Component = def.component;
  return (
    <Component data={result.data} onConfirm={onConfirm} onDismiss={onDismiss} />
  );
}
