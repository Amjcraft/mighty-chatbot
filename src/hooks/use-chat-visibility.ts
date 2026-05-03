"use client";

import { useMemo } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
import {
  type ChatHistory,
  getChatHistoryPaginationKey,
} from "@/components/chatbot/sidebar-history";
import type { VisibilityType } from "@/components/chatbot/visibility-selector";
import { useChatbotConfig } from "@/src/core/context";

export function useChatVisibility({
  chatId,
  initialVisibilityType,
}: {
  chatId: string;
  initialVisibilityType: VisibilityType;
}) {
  const { basePath } = useChatbotConfig();
  const { mutate, cache } = useSWRConfig();
  const history: ChatHistory = cache.get(`${basePath}/history`)?.data;

  const { data: localVisibility, mutate: setLocalVisibility } = useSWR(
    `${chatId}-visibility`,
    null,
    {
      fallbackData: initialVisibilityType,
    }
  );

  const visibilityType = useMemo(() => {
    if (!history) {
      return localVisibility;
    }
    const chat = history.chats.find((currentChat) => currentChat.id === chatId);
    if (!chat) {
      return "private";
    }
    return chat.visibility;
  }, [history, chatId, localVisibility]);

  const setVisibilityType = (updatedVisibilityType: VisibilityType) => {
    setLocalVisibility(updatedVisibilityType);
    mutate(
      unstable_serialize((pageIndex, prev) =>
        getChatHistoryPaginationKey(basePath, pageIndex, prev)
      )
    );

    fetch(`${basePath}/chat`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, visibility: updatedVisibilityType }),
    });
  };

  return { visibilityType, setVisibilityType };
}
