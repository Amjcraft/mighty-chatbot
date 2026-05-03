import { gateway } from "ai";
import { Chatbot, MemoryAdapter } from "mighty-chatbot";

export const chatbot = Chatbot({
  auth: async () => ({ id: "demo-user" }),

  storage: MemoryAdapter(),

  getLanguageModel: (modelId: string) => gateway.languageModel(modelId),

  defaultModel: "moonshotai/kimi-k2.5",

  models: [
    {
      id: "deepseek/deepseek-v3.2",
      name: "DeepSeek V3.2",
      provider: "deepseek",
      description: "Fast and capable model with tool use",
      gatewayOrder: ["bedrock", "deepinfra"],
    },
    {
      id: "moonshotai/kimi-k2.5",
      name: "Kimi K2.5",
      provider: "moonshotai",
      description: "Moonshot AI flagship model",
      gatewayOrder: ["fireworks", "bedrock"],
    },
    {
      id: "xai/grok-4.1-fast-non-reasoning",
      name: "Grok 4.1 Fast",
      provider: "xai",
      description: "Fast non-reasoning model with tool use",
      gatewayOrder: ["xai"],
    },
  ],

  name: "Assistant",
  greeting: "What can I help with?",
  greetingSubtext: "Ask a question, write code, or explore ideas.",

  systemPrompt: `You are a helpful assistant. Keep responses concise and direct.

When asked to write, create, or build something, do it immediately. Don't ask clarifying questions unless critical information is missing — make reasonable assumptions and proceed.`,

  features: {
    history: true,
    fileUploads: false,
    guestMode: false,
    voting: false,
  },

  basePath: "/api/chatbot",
});
