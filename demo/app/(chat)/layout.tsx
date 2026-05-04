"use client";

import { chatbot } from "../../chatbot.config";

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <chatbot.Panel>{children}</chatbot.Panel>;
}
