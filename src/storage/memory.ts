import type { Chat, Document, Message, Vote } from "../core/types";
import type { StorageAdapter, PaginationOptions } from "./adapter";

export function MemoryAdapter(): StorageAdapter {
  const chats = new Map<string, Chat>();
  const messages = new Map<string, Message[]>(); // keyed by chatId
  const votes = new Map<string, Vote[]>(); // keyed by chatId
  const documents = new Map<string, Document[]>(); // keyed by doc id, array for versioning

  return {
    async getChat(id: string, userId: string) {
      const c = chats.get(id);
      if (!c || c.userId !== userId) return null;
      return c;
    },

    async getChatsByUserId(userId: string, options: PaginationOptions = {}) {
      const { limit = 20 } = options;
      const all = Array.from(chats.values())
        .filter((c) => c.userId === userId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      if (options.startingAfter) {
        const cursor = chats.get(options.startingAfter);
        if (!cursor) return [];
        return all
          .filter((c) => c.createdAt > cursor.createdAt)
          .slice(0, limit);
      }

      if (options.endingBefore) {
        const cursor = chats.get(options.endingBefore);
        if (!cursor) return [];
        return all
          .filter((c) => c.createdAt < cursor.createdAt)
          .slice(0, limit);
      }

      return all.slice(0, limit);
    },

    async saveChat(chat: Chat) {
      chats.set(chat.id, chat);
    },

    async deleteChat(id: string) {
      chats.delete(id);
      messages.delete(id);
      votes.delete(id);
    },

    async getMessagesByChatId(chatId: string) {
      return (messages.get(chatId) ?? []).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
    },

    async saveMessages(newMessages: Message[]) {
      for (const msg of newMessages) {
        const existing = messages.get(msg.chatId) ?? [];
        existing.push(msg);
        messages.set(msg.chatId, existing);
      }
    },

    async updateChatTitle(chatId: string, title: string) {
      const c = chats.get(chatId);
      if (c) chats.set(chatId, { ...c, title });
    },

    async updateMessage(id: string, parts: unknown) {
      for (const [chatId, msgs] of messages) {
        const idx = msgs.findIndex((m) => m.id === id);
        if (idx !== -1) {
          msgs[idx] = { ...msgs[idx], parts };
          messages.set(chatId, msgs);
          return;
        }
      }
    },

    async getMessageCountByUserId(userId: string, windowHours: number) {
      const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
      let count = 0;
      for (const [chatId, msgs] of messages) {
        const chat = chats.get(chatId);
        if (!chat || chat.userId !== userId) continue;
        count += msgs.filter(
          (m) => m.role === "user" && m.createdAt >= cutoff,
        ).length;
      }
      return count;
    },

    async voteMessage(chatId: string, messageId: string, isUpvoted: boolean) {
      const existing = votes.get(chatId) ?? [];
      const idx = existing.findIndex((v) => v.messageId === messageId);
      if (idx !== -1) {
        existing[idx] = { chatId, messageId, isUpvoted };
      } else {
        existing.push({ chatId, messageId, isUpvoted });
      }
      votes.set(chatId, existing);
    },

    async getVotesByChatId(chatId: string) {
      return votes.get(chatId) ?? [];
    },

    async saveDocument(doc: Document) {
      const versions = documents.get(doc.id) ?? [];
      versions.push(doc);
      documents.set(doc.id, versions);
    },

    async getDocumentById(id: string) {
      const versions = documents.get(id);
      if (!versions || versions.length === 0) return null;
      return versions[versions.length - 1];
    },

    async getDocumentsById(id: string) {
      return (documents.get(id) ?? []).sort(
        (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
      );
    },

    async updateDocumentContent(id: string, content: string) {
      const versions = documents.get(id);
      if (!versions || versions.length === 0) return;
      const latest = versions[versions.length - 1];
      versions[versions.length - 1] = { ...latest, content };
      documents.set(id, versions);
    },

    async deleteDocumentsByIdAfterTimestamp(id: string, timestamp: Date) {
      const versions = documents.get(id);
      if (!versions) return;
      documents.set(
        id,
        versions.filter((d) => d.createdAt <= timestamp),
      );
    },

    async deleteAllChatsByUserId(userId: string) {
      for (const [id, c] of chats) {
        if (c.userId === userId) {
          chats.delete(id);
          messages.delete(id);
          votes.delete(id);
        }
      }
    },
  };
}
