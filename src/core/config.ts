import type { LanguageModel } from "ai";
import type React from "react";
import type { z } from "zod";
import type { ArtifactDefinition } from "../artifacts/types";
import type { StorageAdapter } from "../storage/adapter";
import type { ActionEvent } from "./types";

export type AuthUser = { id: string; type?: string };
export type AuthResolver = (request: Request) => Promise<AuthUser | null>;

export type ChatUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  image?: string | null;
  isGuest?: boolean;
};

export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
  reasoning?: boolean;
  tools?: boolean;
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
  auth: AuthResolver;
  storage: StorageAdapter;
  getLanguageModel: (modelId: string) => LanguageModel;
  defaultModel: string;
  models: ChatModel[];
  systemPrompt: string;
  artifacts?: ArtifactDefinition<z.ZodType>[];
  name?: string;
  greeting?: string;
  greetingSubtext?: string;
  features?: ChatbotFeatures;
  maxMessagesPerHour?: number;
  basePath?: string;
};

export type ResolvedChatbotConfig = {
  auth: AuthResolver;
  storage: StorageAdapter;
  getLanguageModel: (modelId: string) => LanguageModel;
  defaultModel: string;
  models: ChatModel[];
  systemPrompt: string;
  artifacts: ArtifactDefinition<z.ZodType>[];
  name: string;
  greeting: string;
  greetingSubtext: string;
  features: ResolvedFeatures;
  maxMessagesPerHour: number;
  basePath: string;
};

export type PanelProps = {
  user?: ChatUser;
  onSignOut?: () => Promise<void>;
  context?: Record<string, unknown>;
  onAction?: (action: ActionEvent) => void;
  className?: string;
  children?: React.ReactNode;
};
