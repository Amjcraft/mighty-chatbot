import type { ResolvedChatbotConfig } from "../core/config";

type Ctx = { config: ResolvedChatbotConfig };

export function handleModelsGet(_request: Request, { config }: Ctx): Response {
  const models = config.models.map(({ id, name, provider, description }) => ({
    id,
    name,
    provider,
    description,
  }));
  return Response.json(models, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" },
  });
}
