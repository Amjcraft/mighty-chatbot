import type { ResolvedChatbotConfig } from "../core/config";
import { badRequest, notImplemented, unauthorized } from "./utils";

type Ctx = { config: ResolvedChatbotConfig };

export async function handleHistoryGet(
  request: Request,
  { config }: Ctx,
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(Number.parseInt(searchParams.get("limit") ?? "10", 10), 1),
    50,
  );
  const startingAfter = searchParams.get("starting_after") ?? undefined;
  const endingBefore = searchParams.get("ending_before") ?? undefined;

  if (startingAfter && endingBefore) {
    return badRequest(
      "Only one of starting_after or ending_before can be provided.",
    );
  }

  const user = await config.auth(request);
  if (!user) return unauthorized();

  const chats = await config.storage.getChatsByUserId(user.id, {
    limit,
    startingAfter: startingAfter ?? null,
    endingBefore: endingBefore ?? null,
  });
  return Response.json(chats);
}

export async function handleHistoryDelete(
  request: Request,
  { config }: Ctx,
): Promise<Response> {
  const user = await config.auth(request);
  if (!user) return unauthorized();

  if (!config.storage.deleteAllChatsByUserId) return notImplemented();

  await config.storage.deleteAllChatsByUserId(user.id);
  return new Response(null, { status: 204 });
}
