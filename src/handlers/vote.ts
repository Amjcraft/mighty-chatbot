import { z } from "zod";
import type { ResolvedChatbotConfig } from "../core/config";
import {
  badRequest,
  forbidden,
  notFound,
  notImplemented,
  unauthorized,
} from "./utils";

const voteSchema = z.object({
  chatId: z.string(),
  messageId: z.string(),
  type: z.enum(["up", "down"]),
});

type Ctx = { config: ResolvedChatbotConfig };

export async function handleVoteGet(
  request: Request,
  { config }: Ctx,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");
  if (!chatId) return badRequest("Parameter chatId is required.");

  const user = await config.auth(request);
  if (!user) return unauthorized();

  const chat = await config.storage.getChat(chatId, user.id);
  if (!chat) return notFound("Chat not found");
  if (chat.userId !== user.id) return forbidden();

  if (!config.storage.getVotesByChatId) return notImplemented();

  const votes = await config.storage.getVotesByChatId(chatId);
  return Response.json(votes, { status: 200 });
}

export async function handleVotePatch(
  request: Request,
  { config }: Ctx,
): Promise<Response> {
  let body: z.infer<typeof voteSchema>;
  try {
    body = voteSchema.parse(await request.json());
  } catch {
    return badRequest("Parameters chatId, messageId, and type are required.");
  }

  const user = await config.auth(request);
  if (!user) return unauthorized();

  const chat = await config.storage.getChat(body.chatId, user.id);
  if (!chat) return notFound("Chat not found");
  if (chat.userId !== user.id) return forbidden();

  if (!config.storage.voteMessage) return notImplemented();

  await config.storage.voteMessage(body.chatId, body.messageId, body.type === "up");
  return new Response("Message voted", { status: 200 });
}
