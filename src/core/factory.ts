import type React from "react";
import type { ChatbotConfig, PanelProps, ResolvedChatbotConfig } from "./config";

type RouteHandler = (
  request: Request,
  context?: unknown,
) => Promise<Response> | Response;

export type ChatbotInstance = {
  handlers: { GET: RouteHandler; POST: RouteHandler };
  Panel: React.ComponentType<PanelProps>;
  config: ResolvedChatbotConfig;
};

export function Chatbot(_config: ChatbotConfig): ChatbotInstance {
  throw new Error("Not implemented — coming in Phase 4");
}
