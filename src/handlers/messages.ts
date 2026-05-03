import type { ResolvedChatbotConfig } from "../core/config";
import { badRequest } from "./utils";

type Ctx = { config: ResolvedChatbotConfig };

export async function handleMessagesGet(
  request: Request,
  { config }: Ctx
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");
  if (!chatId) {
    return badRequest("chatId required");
  }

  const user = await config.auth(request);

  const { getChatById } = config.storage;
  const fetchChat = getChatById
    ? (id: string) => getChatById(id)
    : (_id: string) => Promise.resolve(null);

  const [chat, messages] = await Promise.all([
    fetchChat(chatId),
    config.storage.getMessagesByChatId(chatId),
  ]);

  if (!chat) {
    return Response.json({
      messages: [],
      visibility: "private",
      userId: null,
      isReadonly: false,
    });
  }

  if (chat.visibility === "private" && (!user || user.id !== chat.userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const isReadonly = !user || user.id !== chat.userId;

  const uiMessages = messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system",
    parts: m.parts,
    metadata: {
      createdAt:
        m.createdAt instanceof Date
          ? m.createdAt.toISOString()
          : String(m.createdAt),
    },
  }));

  return Response.json({
    messages: uiMessages,
    visibility: chat.visibility,
    userId: chat.userId,
    isReadonly,
  });
}
