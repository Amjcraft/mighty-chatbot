import { handleChatDelete, handleChatPost } from "../handlers/chat";
import {
  handleDocumentDelete,
  handleDocumentGet,
  handleDocumentPost,
} from "../handlers/document";
import { handleHistoryDelete, handleHistoryGet } from "../handlers/history";
import { handleMessagesGet } from "../handlers/messages";
import { handleModelsGet } from "../handlers/models";
import { handleVoteGet, handleVotePatch } from "../handlers/vote";
import type { ResolvedChatbotConfig } from "./config";

type DispatchContext = { params: Promise<{ slug: string[] }> };

export function createDispatcher(config: ResolvedChatbotConfig) {
  const ctx = { config };

  return async function dispatch(
    request: Request,
    context: DispatchContext
  ): Promise<Response> {
    const { slug } = await context.params;
    const [route] = slug;
    const method = request.method.toUpperCase();

    switch (route) {
      case "chat":
        if (method === "POST") {
          return handleChatPost(request, ctx);
        }
        if (method === "DELETE") {
          return handleChatDelete(request, ctx);
        }
        break;
      case "history":
        if (method === "GET") {
          return handleHistoryGet(request, ctx);
        }
        if (method === "DELETE") {
          return handleHistoryDelete(request, ctx);
        }
        break;
      case "messages":
        if (method === "GET") {
          return handleMessagesGet(request, ctx);
        }
        break;
      case "vote":
        if (method === "GET") {
          return handleVoteGet(request, ctx);
        }
        if (method === "PATCH") {
          return handleVotePatch(request, ctx);
        }
        break;
      case "document":
        if (method === "GET") {
          return handleDocumentGet(request, ctx);
        }
        if (method === "POST") {
          return handleDocumentPost(request, ctx);
        }
        if (method === "DELETE") {
          return handleDocumentDelete(request, ctx);
        }
        break;
      case "models":
        if (method === "GET") {
          return handleModelsGet(request, ctx);
        }
        break;
      default:
        break;
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  };
}
