import { Suspense } from "react";
import { Toaster } from "sonner";
import type { PanelProps, ResolvedChatbotConfig } from "../core/config";
import { ChatbotProvider } from "../core/context";
import { ActiveChatProvider } from "../hooks/use-active-chat";
import { AppSidebar } from "./chatbot/app-sidebar";
import { DataStreamProvider } from "./chatbot/data-stream-provider";
import { ChatShell } from "./chatbot/shell";
import { SidebarInset, SidebarProvider } from "./ui/sidebar";

export function createPanel(config: ResolvedChatbotConfig) {
  return function Panel({ user, onSignOut, className, children }: PanelProps) {
    return (
      <ChatbotProvider config={config}>
        <DataStreamProvider>
          <Suspense fallback={<div className="flex h-dvh bg-sidebar" />}>
            <SidebarProvider>
              <AppSidebar onSignOut={onSignOut} user={user} />
              <SidebarInset className={className}>
                <Toaster
                  position="top-center"
                  theme="system"
                  toastOptions={{
                    className:
                      "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]",
                  }}
                />
                <Suspense fallback={<div className="flex h-dvh" />}>
                  <ActiveChatProvider>
                    <ChatShell />
                  </ActiveChatProvider>
                </Suspense>
                {children}
              </SidebarInset>
            </SidebarProvider>
          </Suspense>
        </DataStreamProvider>
      </ChatbotProvider>
    );
  };
}
