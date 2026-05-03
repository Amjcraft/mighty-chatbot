export type ChatModel = {
  id: string;
  name: string;
  provider: string;
  description: string;
  gatewayOrder?: string[];
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";
};

export type ChatbotConfig = {
  name: string;
  greeting: string;
  greetingSubtext?: string;
  defaultModel: string;
  models: ChatModel[];
  systemPrompt: string;
  features: {
    history: boolean;
    fileUploads: boolean;
    guestMode: boolean;
    voting: boolean;
  };
};
