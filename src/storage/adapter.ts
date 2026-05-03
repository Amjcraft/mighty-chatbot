import type { Chat, Document, Message, Vote } from "../core/types";

export type PaginationOptions = {
  limit?: number;
  startingAfter?: string | null;
  endingBefore?: string | null;
};

export interface StorageAdapter {
  // Chats
  getChat(id: string, userId: string): Promise<Chat | null>;
  getChatsByUserId(userId: string, options?: PaginationOptions): Promise<Chat[]>;
  saveChat(chat: Chat): Promise<void>;
  deleteChat(id: string): Promise<void>;

  // Messages
  getMessagesByChatId(chatId: string): Promise<Message[]>;
  saveMessages(messages: Message[]): Promise<void>;

  // Optional — implement to enable
  updateChatTitle?(chatId: string, title: string): Promise<void>;
  updateMessage?(id: string, parts: unknown): Promise<void>;
  getMessageCountByUserId?(userId: string, windowHours: number): Promise<number>;

  // Voting — implement both to enable voting feature
  voteMessage?(chatId: string, messageId: string, isUpvoted: boolean): Promise<void>;
  getVotesByChatId?(chatId: string): Promise<Vote[]>;

  // Documents — implement to enable artifact persistence
  saveDocument?(doc: Document): Promise<void>;
  getDocumentById?(id: string): Promise<Document | null>;
  getDocumentsById?(id: string): Promise<Document[]>;
  updateDocumentContent?(id: string, content: string): Promise<void>;
  deleteDocumentsByIdAfterTimestamp?(id: string, timestamp: Date): Promise<void>;

  // Bulk operations
  deleteAllChatsByUserId?(userId: string): Promise<void>;
}
