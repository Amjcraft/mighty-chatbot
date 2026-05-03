import type { z } from "zod";
import type { ArtifactDefinition } from "../artifacts/types";
import type { StorageAdapter } from "../storage/adapter";
import type { ActionEvent } from "./types";

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

export type ChatbotFeatures = {
  history?: boolean;
  fileUploads?: boolean;
  voting?: boolean;
  guestMode?: boolean;
};

export type ResolvedFeatures = {
  history: boolean;
  fileUploads: boolean;
  voting: boolean;
  guestMode: boolean;
};

export type ChatbotConfig = {
  storage: StorageAdapter;
  defaultModel: string;
  models: ChatModel[];
  systemPrompt: string;
  artifacts?: ArtifactDefinition<z.ZodType>[];
  name?: string;
  greeting?: string;
  greetingSubtext?: string;
  features?: ChatbotFeatures;
};

export type ResolvedChatbotConfig = {
  storage: StorageAdapter;
  defaultModel: string;
  models: ChatModel[];
  systemPrompt: string;
  artifacts: ArtifactDefinition<z.ZodType>[];
  name: string;
  greeting: string;
  greetingSubtext: string;
  features: ResolvedFeatures;
};

export type PanelProps = {
  context?: Record<string, unknown>;
  onAction?: (action: ActionEvent) => void;
  className?: string;
};
