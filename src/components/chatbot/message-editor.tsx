"use client";

import type { UseChatHelpers } from "@ai-sdk/react";
import type { ChatMessage } from "@/lib/types";

export async function submitEditedMessage({
  message,
  text,
  setMessages,
  regenerate,
  basePath,
}: {
  message: ChatMessage;
  text: string;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  regenerate: UseChatHelpers<ChatMessage>["regenerate"];
  basePath: string;
}) {
  await fetch(`${basePath}/messages?messageId=${message.id}`, {
    method: "DELETE",
  });

  setMessages((messages) => {
    const index = messages.findIndex((m) => m.id === message.id);
    if (index === -1) {
      return messages;
    }

    return [
      ...messages.slice(0, index),
      { ...message, parts: [{ type: "text" as const, text }] },
    ];
  });

  regenerate();
}
