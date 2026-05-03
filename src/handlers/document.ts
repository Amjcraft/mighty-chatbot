import { z } from "zod";
import type { ResolvedChatbotConfig } from "../core/config";
import {
  badRequest,
  forbidden,
  notFound,
  notImplemented,
  unauthorized,
} from "./utils";

const documentSchema = z.object({
  content: z.string(),
  title: z.string(),
  kind: z.string(),
  isManualEdit: z.boolean().optional(),
});

type Ctx = { config: ResolvedChatbotConfig };

export async function handleDocumentGet(
  request: Request,
  { config }: Ctx
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return badRequest("Parameter id is missing");
  }

  const user = await config.auth(request);
  if (!user) {
    return unauthorized();
  }

  if (!config.storage.getDocumentsById) {
    return notImplemented();
  }

  const documents = await config.storage.getDocumentsById(id);
  const [document] = documents;
  if (!document) {
    return notFound("Document not found");
  }
  if (document.userId !== user.id) {
    return forbidden();
  }

  return Response.json(documents, { status: 200 });
}

export async function handleDocumentPost(
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

  if (!config.storage.saveDocument || !config.storage.getDocumentsById) {
    return notImplemented();
  }

  let body: z.infer<typeof documentSchema>;
  try {
    body = documentSchema.parse(await request.json());
  } catch {
    return badRequest("Invalid request body.");
  }

  const documents = await config.storage.getDocumentsById(id);
  if (documents.length > 0 && documents[0].userId !== user.id) {
    return forbidden();
  }

  if (
    body.isManualEdit &&
    documents.length > 0 &&
    config.storage.updateDocumentContent
  ) {
    const result = await config.storage.updateDocumentContent(id, body.content);
    return Response.json(result, { status: 200 });
  }

  const document = await config.storage.saveDocument({
    id,
    content: body.content,
    title: body.title,
    kind: body.kind,
    userId: user.id,
    createdAt: new Date(),
  });

  return Response.json(document, { status: 200 });
}

export async function handleDocumentDelete(
  request: Request,
  { config }: Ctx
): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const timestamp = searchParams.get("timestamp");

  if (!id) {
    return badRequest("Parameter id is required.");
  }
  if (!timestamp) {
    return badRequest("Parameter timestamp is required.");
  }

  const user = await config.auth(request);
  if (!user) {
    return unauthorized();
  }

  if (
    !config.storage.getDocumentsById ||
    !config.storage.deleteDocumentsByIdAfterTimestamp
  ) {
    return notImplemented();
  }

  const documents = await config.storage.getDocumentsById(id);
  const [document] = documents;
  if (!document) {
    return notFound("Document not found");
  }
  if (document.userId !== user.id) {
    return forbidden();
  }

  const parsedTimestamp = new Date(timestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    return badRequest("Invalid timestamp.");
  }

  const deleted = await config.storage.deleteDocumentsByIdAfterTimestamp(
    id,
    parsedTimestamp
  );
  return Response.json(deleted, { status: 200 });
}
