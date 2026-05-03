import "server-only";

import type { Chat, Document, Message } from "../../core/types";
import type { PaginationOptions, StorageAdapter } from "../adapter";

export type DrizzleDocumentKind = "text" | "code" | "image" | "sheet";

export type DrizzleQueryFns = {
  getChatById(params: { id: string }): Promise<Chat | null>;
  getChatsByUserId(params: {
    id: string;
    limit: number;
    startingAfter: string | null;
    endingBefore: string | null;
  }): Promise<{ chats: Chat[] }>;
  saveChat(chat: Chat): Promise<unknown>;
  deleteChatById(params: { id: string }): Promise<unknown>;
  getMessagesByChatId(params: { id: string }): Promise<Message[]>;
  saveMessages(params: { messages: Message[] }): Promise<unknown>;
  updateChatTitleById(params: {
    chatId: string;
    title: string;
  }): Promise<unknown>;
  updateMessage(params: { id: string; parts: unknown }): Promise<unknown>;
  getMessageCountByUserId(params: {
    id: string;
    differenceInHours: number;
  }): Promise<number>;
  voteMessage(params: {
    chatId: string;
    messageId: string;
    type: "up" | "down";
  }): Promise<unknown>;
  getVotesByChatId(params: {
    id: string;
  }): Promise<Array<{ chatId: string; messageId: string; isUpvoted: boolean }>>;
  saveDocument(params: {
    id: string;
    title: string;
    kind: DrizzleDocumentKind;
    content: string;
    userId: string;
  }): Promise<unknown>;
  getDocumentById(params: { id: string }): Promise<Document | null>;
  getDocumentsById(params: { id: string }): Promise<Document[]>;
  updateDocumentContent(params: {
    id: string;
    content: string;
  }): Promise<unknown>;
  deleteDocumentsByIdAfterTimestamp(params: {
    id: string;
    timestamp: Date;
  }): Promise<unknown>;
  deleteAllChatsByUserId(params: { userId: string }): Promise<unknown>;
};

export function DrizzleAdapter(queries: DrizzleQueryFns): StorageAdapter {
  return {
    async getChat(id: string, userId: string) {
      const c = await queries.getChatById({ id });
      if (!c || c.userId !== userId) {
        return null;
      }
      return c;
    },

    async getChatById(id: string) {
      const c = await queries.getChatById({ id });
      return c ?? null;
    },

    async getChatsByUserId(userId: string, options: PaginationOptions = {}) {
      const { limit = 20, startingAfter = null, endingBefore = null } = options;
      const { chats } = await queries.getChatsByUserId({
        id: userId,
        limit,
        startingAfter: startingAfter ?? null,
        endingBefore: endingBefore ?? null,
      });
      return chats;
    },

    async saveChat(c: Chat) {
      await queries.saveChat(c);
    },

    async deleteChat(id: string) {
      await queries.deleteChatById({ id });
    },

    async getMessagesByChatId(chatId: string) {
      return await queries.getMessagesByChatId({ id: chatId });
    },

    async saveMessages(messages: Message[]) {
      await queries.saveMessages({ messages });
    },

    async updateChatTitle(chatId: string, title: string) {
      await queries.updateChatTitleById({ chatId, title });
    },

    async updateMessage(id: string, parts: unknown) {
      await queries.updateMessage({ id, parts });
    },

    async getMessageCountByUserId(userId: string, windowHours: number) {
      return await queries.getMessageCountByUserId({
        id: userId,
        differenceInHours: windowHours,
      });
    },

    async voteMessage(chatId: string, messageId: string, isUpvoted: boolean) {
      await queries.voteMessage({
        chatId,
        messageId,
        type: isUpvoted ? "up" : "down",
      });
    },

    async getVotesByChatId(chatId: string) {
      return await queries.getVotesByChatId({ id: chatId });
    },

    async saveDocument(doc: Document) {
      await queries.saveDocument({
        id: doc.id,
        title: doc.title,
        kind: doc.kind as DrizzleDocumentKind,
        content: doc.content ?? "",
        userId: doc.userId,
      });
    },

    async getDocumentById(id: string) {
      const doc = await queries.getDocumentById({ id });
      return doc ?? null;
    },

    async getDocumentsById(id: string) {
      return await queries.getDocumentsById({ id });
    },

    async updateDocumentContent(id: string, content: string) {
      await queries.updateDocumentContent({ id, content });
    },

    async deleteDocumentsByIdAfterTimestamp(id: string, timestamp: Date) {
      await queries.deleteDocumentsByIdAfterTimestamp({ id, timestamp });
    },

    async deleteAllChatsByUserId(userId: string) {
      await queries.deleteAllChatsByUserId({ userId });
    },
  };
}
