// To-do: Not a huge fan of this memory adapter. Definitely let's look into replacing this in the future.

import type { Chat, Document, Message, Vote } from "../core/types";
import type { PaginationOptions, StorageAdapter } from "./adapter";

export function MemoryAdapter(): StorageAdapter {
  const chats = new Map<string, Chat>();
  const messages = new Map<string, Message[]>(); // keyed by chatId
  const votes = new Map<string, Vote[]>(); // keyed by chatId
  const documents = new Map<string, Document[]>(); // keyed by doc id, array for versioning

  return {
    getChat(id: string, userId: string): Promise<Chat | null> {
      const c = chats.get(id);
      if (!c || c.userId !== userId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(c);
    },

    getChatById(id: string): Promise<Chat | null> {
      return Promise.resolve(chats.get(id) ?? null);
    },

    getChatsByUserId(
      userId: string,
      options: PaginationOptions = {}
    ): Promise<Chat[]> {
      const { limit = 20 } = options;
      const all = Array.from(chats.values())
        .filter((c) => c.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      if (options.startingAfter) {
        const cursor = chats.get(options.startingAfter);
        if (!cursor) {
          return Promise.resolve([]);
        }
        return Promise.resolve(
          all.filter((c) => c.createdAt > cursor.createdAt).slice(0, limit)
        );
      }

      if (options.endingBefore) {
        const cursor = chats.get(options.endingBefore);
        if (!cursor) {
          return Promise.resolve([]);
        }
        return Promise.resolve(
          all.filter((c) => c.createdAt < cursor.createdAt).slice(0, limit)
        );
      }

      return Promise.resolve(all.slice(0, limit));
    },

    saveChat(chat: Chat): Promise<void> {
      chats.set(chat.id, chat);
      return Promise.resolve();
    },

    deleteChat(id: string): Promise<void> {
      chats.delete(id);
      messages.delete(id);
      votes.delete(id);
      return Promise.resolve();
    },

    getMessagesByChatId(chatId: string): Promise<Message[]> {
      return Promise.resolve(
        (messages.get(chatId) ?? []).sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        )
      );
    },

    saveMessages(newMessages: Message[]): Promise<void> {
      for (const msg of newMessages) {
        const existing = messages.get(msg.chatId) ?? [];
        existing.push(msg);
        messages.set(msg.chatId, existing);
      }
      return Promise.resolve();
    },

    updateChatTitle(chatId: string, title: string): Promise<void> {
      const c = chats.get(chatId);
      if (c) {
        chats.set(chatId, { ...c, title });
      }
      return Promise.resolve();
    },

    updateMessage(id: string, parts: unknown): Promise<void> {
      for (const [chatId, msgs] of messages) {
        const idx = msgs.findIndex((m) => m.id === id);
        if (idx !== -1) {
          msgs[idx] = { ...msgs[idx], parts };
          messages.set(chatId, msgs);
          return Promise.resolve();
        }
      }
      return Promise.resolve();
    },

    getMessageCountByUserId(
      userId: string,
      windowHours: number
    ): Promise<number> {
      const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      let count = 0;
      for (const [chatId, msgs] of messages) {
        const chat = chats.get(chatId);
        if (!chat || chat.userId !== userId) {
          continue;
        }
        count += msgs.filter(
          (m) => m.role === "user" && m.createdAt >= cutoff
        ).length;
      }
      return Promise.resolve(count);
    },

    voteMessage(
      chatId: string,
      messageId: string,
      isUpvoted: boolean
    ): Promise<void> {
      const existing = votes.get(chatId) ?? [];
      const idx = existing.findIndex((v) => v.messageId === messageId);
      if (idx === -1) {
        existing.push({ chatId, messageId, isUpvoted });
      } else {
        existing[idx] = { chatId, messageId, isUpvoted };
      }
      votes.set(chatId, existing);
      return Promise.resolve();
    },

    getVotesByChatId(chatId: string): Promise<Vote[]> {
      return Promise.resolve(votes.get(chatId) ?? []);
    },

    saveDocument(doc: Document): Promise<void> {
      const versions = documents.get(doc.id) ?? [];
      versions.push(doc);
      documents.set(doc.id, versions);
      return Promise.resolve();
    },

    getDocumentById(id: string): Promise<Document | null> {
      const versions = documents.get(id);
      if (!versions || versions.length === 0) {
        return Promise.resolve(null);
      }
      return Promise.resolve(versions.at(-1) ?? null);
    },

    getDocumentsById(id: string): Promise<Document[]> {
      return Promise.resolve(
        (documents.get(id) ?? []).sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        )
      );
    },

    updateDocumentContent(id: string, content: string): Promise<void> {
      const versions = documents.get(id);
      if (!versions || versions.length === 0) {
        return Promise.resolve();
      }
      const latest = versions.at(-1);
      if (latest) {
        versions[versions.length - 1] = { ...latest, content };
        documents.set(id, versions);
      }
      return Promise.resolve();
    },

    deleteDocumentsByIdAfterTimestamp(
      id: string,
      timestamp: Date
    ): Promise<void> {
      const versions = documents.get(id);
      if (!versions) {
        return Promise.resolve();
      }
      documents.set(
        id,
        versions.filter((d) => d.createdAt <= timestamp)
      );
      return Promise.resolve();
    },

    deleteAllChatsByUserId(userId: string): Promise<void> {
      for (const [id, c] of chats) {
        if (c.userId === userId) {
          chats.delete(id);
          messages.delete(id);
          votes.delete(id);
        }
      }
      return Promise.resolve();
    },
  };
}
