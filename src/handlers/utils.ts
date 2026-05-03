function err(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

export const badRequest = (msg = "Bad request") => err(400, msg);
export const unauthorized = () => err(401, "Unauthorized");
export const forbidden = () => err(403, "Forbidden");
export const notFound = (msg = "Not found") => err(404, msg);
export const methodNotAllowed = () => err(405, "Method not allowed");
export const notImplemented = () => err(501, "Not implemented");
