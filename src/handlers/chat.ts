import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import { z } from "zod";
import { buildSystemPrompt } from "../ai/prompts";
import { buildProposeActionTool } from "../ai/tools/propose-action";
import { buildRegistry } from "../artifacts/registry";
import type { ResolvedChatbotConfig } from "../core/config";
import type { Message } from "../core/types";
import { badRequest, forbidden, notFound, unauthorized } from "./utils";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(2000),
});
const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const postBodySchema = z.object({
  id: z.string().uuid(),
  message: z
    .object({
      id: z.string().uuid(),
      role: z.enum(["user"]),
      parts: z.array(z.union([textPartSchema, filePartSchema])),
    })
    .optional(),
  messages: z
    .array(
      z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        parts: z.array(z.record(z.unknown())),
      })
    )
    .optional(),
  selectedChatModel: z.string(),
  selectedVisibilityType: z.enum(["public", "private"]),
});

type Ctx = { config: ResolvedChatbotConfig };

function dbToUIMessages(messages: Message[]): UIMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system",
    content: "",
    parts: m.parts as UIMessage["parts"],
    metadata: {
      createdAt:
        m.createdAt instanceof Date
          ? m.createdAt.toISOString()
          : String(m.createdAt),
    },
  }));
}

function titleFromParts(parts: Array<{ type: string; text?: string }>): string {
  const text = parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
  return text.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
}

export async function handleChatPost(
  request: Request,
  { config }: Ctx
): Promise<Response> {
  let body: z.infer<typeof postBodySchema>;
  try {
    body = postBodySchema.parse(await request.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  const { id, message, messages, selectedChatModel, selectedVisibilityType } =
    body;

  const user = await config.auth(request);
  if (!user) {
    return unauthorized();
  }

  const chatModelId = config.models.some((m) => m.id === selectedChatModel)
    ? selectedChatModel
    : config.defaultModel;

  if (config.storage.getMessageCountByUserId) {
    const count = await config.storage.getMessageCountByUserId(user.id, 1);
    if (count > config.maxMessagesPerHour) {
      return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  }

  const isToolApprovalFlow = Boolean(messages);

  // Use raw lookup so we can distinguish "not found" from "wrong owner"
  const { getChatById } = config.storage;
  const fetchChat = getChatById
    ? (chatId: string) => getChatById(chatId)
    : (chatId: string) => config.storage.getChat(chatId, user.id);

  const existingChat = await fetchChat(id);
  let title: string | null = null;

  if (existingChat) {
    if (existingChat.userId !== user.id) {
      return forbidden();
    }
  } else if (message?.role === "user") {
    title = titleFromParts(message.parts);
    await config.storage.saveChat({
      id,
      userId: user.id,
      title: "New chat",
      visibility: selectedVisibilityType,
      createdAt: new Date(),
    });
  }

  const dbMessages = await config.storage.getMessagesByChatId(id);
  let uiMessages: UIMessage[];

  if (isToolApprovalFlow && messages) {
    const base = dbToUIMessages(dbMessages);
    const approvalStates = new Map(
      messages.flatMap((m) =>
        (m.parts as Record<string, unknown>[])
          .filter(
            (p) =>
              p.state === "approval-responded" || p.state === "output-denied"
          )
          .map((p) => [String(p.toolCallId ?? ""), p])
      )
    );
    uiMessages = base.map((msg) => ({
      ...msg,
      parts: msg.parts.map((part) => {
        const p = part as Record<string, unknown>;
        if ("toolCallId" in p && approvalStates.has(String(p.toolCallId))) {
          return {
            ...part,
            ...approvalStates.get(String(p.toolCallId)),
          } as typeof part;
        }
        return part;
      }),
    }));
  } else {
    uiMessages = [
      ...dbToUIMessages(dbMessages),
      message as unknown as UIMessage,
    ];
  }

  if (message?.role === "user") {
    await config.storage.saveMessages([
      {
        chatId: id,
        id: message.id,
        role: "user",
        parts: message.parts,
        attachments: [],
        createdAt: new Date(),
      },
    ]);
  }

  const modelRecord = config.models.find((m) => m.id === chatModelId);
  const isReasoningModel = modelRecord?.reasoning === true;

  const modelMessages = await convertToModelMessages(uiMessages);

  const registry =
    config.artifacts.length > 0 ? buildRegistry(config.artifacts) : null;
  const systemPrompt = registry
    ? buildSystemPrompt(config.systemPrompt, registry)
    : config.systemPrompt;

  const stream = createUIMessageStream({
    originalMessages: isToolApprovalFlow ? uiMessages : undefined,
    execute: async ({ writer: dataStream }) => {
      const proposeActionTool = registry
        ? buildProposeActionTool({ registry, dataStream })
        : null;

      const result = streamText({
        model: config.getLanguageModel(chatModelId),
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: stepCountIs(5),
        tools: proposeActionTool
          ? { "propose-action": proposeActionTool }
          : undefined,
        experimental_telemetry: { isEnabled: false },
      });

      dataStream.merge(
        result.toUIMessageStream({ sendReasoning: isReasoningModel })
      );

      if (title) {
        dataStream.write({ type: "data-chat-title", data: title });
        if (config.storage.updateChatTitle) {
          await config.storage.updateChatTitle(id, title);
        }
      }
    },
    generateId,
    onFinish: async ({ messages: finishedMessages }) => {
      if (isToolApprovalFlow) {
        for (const msg of finishedMessages) {
          const alreadyExists = uiMessages.some((m) => m.id === msg.id);
          if (alreadyExists && config.storage.updateMessage) {
            await config.storage.updateMessage(msg.id, msg.parts);
          } else {
            await config.storage.saveMessages([
              {
                id: msg.id,
                role: msg.role as string,
                parts: msg.parts,
                createdAt: new Date(),
                attachments: [],
                chatId: id,
              },
            ]);
          }
        }
      } else if (finishedMessages.length > 0) {
        await config.storage.saveMessages(
          finishedMessages.map((m) => ({
            id: m.id,
            role: m.role as string,
            parts: m.parts,
            createdAt: new Date(),
            attachments: [],
            chatId: id,
          }))
        );
      }
    },
    onError: () => "Oops, an error occurred!",
  });

  return createUIMessageStreamResponse({ stream });
}

export async function handleChatDelete(
  request: Request,
  { config }: Ctx
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return badRequest("Parameter id is required.");
  }

  const user = await config.auth(request);
  if (!user) {
    return unauthorized();
  }

  const chat = await config.storage.getChat(id, user.id);
  if (!chat) {
    return notFound("Chat not found");
  }
  if (chat.userId !== user.id) {
    return forbidden();
  }

  await config.storage.deleteChat(id);
  return Response.json({ id }, { status: 200 });
}
