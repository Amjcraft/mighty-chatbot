import type React from "react";
import type { ChatbotConfig, PanelProps, ResolvedChatbotConfig } from "./config";
import { createDispatcher } from "./dispatcher";

type RouteHandlerContext = { params: Promise<{ slug: string[] }> };
type RouteHandler = (
  request: Request,
  context: RouteHandlerContext,
) => Promise<Response>;

export type ChatbotInstance = {
  handlers: {
    GET: RouteHandler;
    POST: RouteHandler;
    DELETE: RouteHandler;
    PATCH: RouteHandler;
  };
  Panel: React.ComponentType<PanelProps>;
  config: ResolvedChatbotConfig;
};

function resolveConfig(config: ChatbotConfig): ResolvedChatbotConfig {
  return {
    auth: config.auth,
    storage: config.storage,
    getLanguageModel: config.getLanguageModel,
    defaultModel: config.defaultModel,
    models: config.models,
    systemPrompt: config.systemPrompt,
    artifacts: config.artifacts ?? [],
    name: config.name ?? "Chatbot",
    greeting: config.greeting ?? "Hello! How can I help you today?",
    greetingSubtext: config.greetingSubtext ?? "",
    features: {
      history: config.features?.history ?? true,
      fileUploads: config.features?.fileUploads ?? false,
      voting: config.features?.voting ?? true,
      guestMode: config.features?.guestMode ?? false,
    },
    maxMessagesPerHour: config.maxMessagesPerHour ?? 100,
  };
}

export function Chatbot(config: ChatbotConfig): ChatbotInstance {
  const resolved = resolveConfig(config);
  const dispatch = createDispatcher(resolved);
  const handler: RouteHandler = (req, ctx) => dispatch(req, ctx);

  return {
    handlers: {
      GET: handler,
      POST: handler,
      DELETE: handler,
      PATCH: handler,
    },
    Panel: null as unknown as React.ComponentType<PanelProps>,
    config: resolved,
  };
}
