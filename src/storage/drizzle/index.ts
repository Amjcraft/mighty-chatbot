import "server-only";

import {
  deleteChatById,
  deleteAllChatsByUserId,
  deleteDocumentsByIdAfterTimestamp,
  getChatById as getChatByIdQuery,
  getChatsByUserId,
  getDocumentById,
  getDocumentsById,
  getMessageCountByUserId,
  getMessagesByChatId,
  getVotesByChatId,
  saveChat as saveChatQuery,
  saveDocument as saveDocumentQuery,
  saveMessages as saveMessagesQuery,
  updateChatTitleById,
  updateDocumentContent,
  updateMessage as updateMessageQuery,
  voteMessage as voteMessageQuery,
} from "@/lib/db/queries";
import type { ArtifactKind } from "@/components/chatbot/artifact";
import type { Chat, Document, Message } from "../../core/types";
import type { StorageAdapter, PaginationOptions } from "../adapter";

export function DrizzleAdapter(): StorageAdapter {
  return {
    async getChat(id: string, userId: string) {
      const c = await getChatByIdQuery({ id });
      if (!c || c.userId !== userId) return null;
      return c;
    },

    async getChatById(id: string) {
      const c = await getChatByIdQuery({ id });
      return c ?? null;
    },

    async getChatsByUserId(userId: string, options: PaginationOptions = {}) {
      const { limit = 20, startingAfter = null, endingBefore = null } = options;
      const { chats } = await getChatsByUserId({
        id: userId,
        limit,
        startingAfter: startingAfter ?? null,
        endingBefore: endingBefore ?? null,
      });
      return chats;
    },

    async saveChat(c: Chat) {
      await saveChatQuery(c);
    },

    async deleteChat(id: string) {
      await deleteChatById({ id });
    },

    async getMessagesByChatId(chatId: string) {
      return getMessagesByChatId({ id: chatId });
    },

    async saveMessages(messages: Message[]) {
      await saveMessagesQuery({ messages });
    },

    async updateChatTitle(chatId: string, title: string) {
      await updateChatTitleById({ chatId, title });
    },

    async updateMessage(id: string, parts: unknown) {
      await updateMessageQuery({ id, parts });
    },

    async getMessageCountByUserId(userId: string, windowHours: number) {
      return getMessageCountByUserId({ id: userId, differenceInHours: windowHours });
    },

    async voteMessage(chatId: string, messageId: string, isUpvoted: boolean) {
      await voteMessageQuery({ chatId, messageId, type: isUpvoted ? "up" : "down" });
    },

    async getVotesByChatId(chatId: string) {
      return getVotesByChatId({ id: chatId });
    },

    async saveDocument(doc: Document) {
      await saveDocumentQuery({
        id: doc.id,
        title: doc.title,
        kind: doc.kind as ArtifactKind,
        content: doc.content ?? "",
        userId: doc.userId,
      });
    },

    async getDocumentById(id: string) {
      const doc = await getDocumentById({ id });
      return doc ?? null;
    },

    async getDocumentsById(id: string) {
      return getDocumentsById({ id });
    },

    async updateDocumentContent(id: string, content: string) {
      await updateDocumentContent({ id, content });
    },

    async deleteDocumentsByIdAfterTimestamp(id: string, timestamp: Date) {
      await deleteDocumentsByIdAfterTimestamp({ id, timestamp });
    },

    async deleteAllChatsByUserId(userId: string) {
      await deleteAllChatsByUserId({ userId });
    },
  };
}
