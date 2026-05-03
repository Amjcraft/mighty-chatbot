"use client";

import { createContext, useContext } from "react";
import type { ResolvedChatbotConfig } from "./config";

const ChatbotContext = createContext<ResolvedChatbotConfig | null>(null);

export function ChatbotProvider({
  config,
  children,
}: {
  config: ResolvedChatbotConfig;
  children: React.ReactNode;
}) {
  return (
    <ChatbotContext.Provider value={config}>{children}</ChatbotContext.Provider>
  );
}

export function useChatbotConfig(): ResolvedChatbotConfig {
  const ctx = useContext(ChatbotContext);
  if (!ctx) {
    throw new Error("useChatbotConfig must be used within ChatbotProvider");
  }
  return ctx;
}
