import type { ChatbotConfig } from "@/lib/chatbot/config";

export const config: ChatbotConfig = {
  name: "Assistant",
  greeting: "What can I help with?",
  greetingSubtext: "Ask a question, write code, or explore ideas.",

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
      id: "mistral/codestral",
      name: "Codestral",
      provider: "mistral",
      description: "Code-focused model with tool use",
      gatewayOrder: ["mistral"],
    },
    {
      id: "mistral/mistral-small",
      name: "Mistral Small",
      provider: "mistral",
      description: "Fast vision model with tool use",
      gatewayOrder: ["mistral"],
    },
    {
      id: "moonshotai/kimi-k2.5",
      name: "Kimi K2.5",
      provider: "moonshotai",
      description: "Moonshot AI flagship model",
      gatewayOrder: ["fireworks", "bedrock"],
    },
    {
      id: "openai/gpt-oss-20b",
      name: "GPT OSS 20B",
      provider: "openai",
      description: "Compact reasoning model",
      gatewayOrder: ["groq", "bedrock"],
      reasoningEffort: "low",
    },
    {
      id: "openai/gpt-oss-120b",
      name: "GPT OSS 120B",
      provider: "openai",
      description: "Open-source 120B parameter model",
      gatewayOrder: ["fireworks", "bedrock"],
      reasoningEffort: "low",
    },
    {
      id: "xai/grok-4.1-fast-non-reasoning",
      name: "Grok 4.1 Fast",
      provider: "xai",
      description: "Fast non-reasoning model with tool use",
      gatewayOrder: ["xai"],
    },
  ],

  systemPrompt: `You are a helpful assistant. Keep responses concise and direct.

When asked to write, create, or build something, do it immediately. Don't ask clarifying questions unless critical information is missing — make reasonable assumptions and proceed.`,

  features: {
    history: true,
    fileUploads: true,
    guestMode: true,
    voting: false,
  },
};
