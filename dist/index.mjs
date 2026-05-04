// src/ai/prompts.ts
function zodDefToJsonSchema(def) {
  const typeName = def.typeName ?? "";
  switch (typeName) {
    case "ZodString":
      return { type: "string" };
    case "ZodNumber":
      return { type: "number" };
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodNull":
      return { type: "null" };
    case "ZodLiteral": {
      const value = def.value;
      return { type: typeof value, enum: [value] };
    }
    case "ZodEnum": {
      const values = def.values ?? [];
      return { type: "string", enum: values };
    }
    case "ZodArray": {
      const inner = def.type;
      return {
        type: "array",
        items: inner ? zodDefToJsonSchema(inner._def) : {}
      };
    }
    case "ZodOptional":
    case "ZodNullable": {
      const inner = def.innerType;
      return inner ? zodDefToJsonSchema(inner._def) : {};
    }
    case "ZodObject": {
      const shape = def.shape?.() ?? {};
      const properties = {};
      const required = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodDefToJsonSchema(value._def);
        const inner = value._def.innerType;
        const isOptional = value._def.typeName === "ZodOptional" || value._def.typeName === "ZodNullable" || inner !== void 0;
        if (!isOptional) {
          required.push(key);
        }
      }
      return {
        type: "object",
        properties,
        ...required.length > 0 ? { required } : {}
      };
    }
    default:
      return {};
  }
}
function zodToJsonSchema(schema3) {
  return zodDefToJsonSchema(schema3._def);
}
function buildSystemPrompt(base, registry) {
  if (registry.size === 0) {
    return base;
  }
  const lines = [
    "",
    "## Available Artifact Types",
    "",
    "You can propose structured actions to the user by calling the `propose-action` tool.",
    "Each call must use one of the registered types below.",
    "Produce data that matches the JSON Schema exactly.",
    ""
  ];
  for (const [type, def] of registry) {
    const schema3 = zodToJsonSchema(def.schema);
    lines.push(`### ${type}`);
    lines.push("```json");
    lines.push(JSON.stringify(schema3, null, 2));
    lines.push("```");
    lines.push("");
  }
  return `${base.trimEnd()}
${lines.join("\n")}`;
}

// src/ai/tools/propose-action.ts
import { tool } from "ai";
import { z } from "zod";
var proposeActionInputSchema = z.object({
  type: z.string().describe("The artifact type to propose."),
  data: z.any().describe("The artifact data matching the type's schema.")
});
function buildProposeActionTool({
  registry,
  dataStream
}) {
  const availableTypes = [...registry.keys()].join(", ");
  return tool({
    description: `Propose a structured action to the user. Available types: ${availableTypes}. The 'data' field must match the JSON Schema for the given type.`,
    inputSchema: proposeActionInputSchema,
    execute: ({
      type,
      data
    }) => {
      const def = registry.get(type);
      if (!def) {
        throw new Error(
          `Unknown artifact type "${type}". Available: ${availableTypes}`
        );
      }
      const result = def.schema.safeParse(data);
      if (!result.success) {
        throw new Error(
          `Invalid data for type "${type}": ${result.error.message}`
        );
      }
      dataStream.write({
        type: "data-proposed-action",
        data: { type, data: result.data }
      });
      return Promise.resolve({ type, data: result.data });
    }
  });
}

// src/artifacts/registry.ts
function buildRegistry(artifacts) {
  const registry = /* @__PURE__ */ new Map();
  for (const artifact of artifacts) {
    if (registry.has(artifact.type)) {
      console.warn(
        `[mighty-chatbot] Duplicate artifact type "${artifact.type}" \u2014 last registration wins.`
      );
    }
    registry.set(artifact.type, artifact);
  }
  return registry;
}

// src/artifacts/types.ts
function defineArtifact(def) {
  return def;
}

// src/components/artifact-renderer.tsx
import { jsx } from "react/jsx-runtime";
function ArtifactRenderer({
  artifacts,
  part,
  onConfirm,
  onDismiss
}) {
  const def = artifacts.find((a) => a.type === part.type);
  if (!def) {
    return null;
  }
  const result = def.schema.safeParse(part.data);
  if (!result.success) {
    return null;
  }
  const Component = def.component;
  return /* @__PURE__ */ jsx(Component, { data: result.data, onConfirm, onDismiss });
}

// src/components/theme-provider.tsx
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { jsx as jsx2 } from "react/jsx-runtime";
function ThemeProvider({ children, ...props }) {
  return /* @__PURE__ */ jsx2(NextThemesProvider, { ...props, children });
}

// src/components/ui/tooltip.tsx
import { Tooltip as TooltipPrimitive } from "radix-ui";

// lib/utils.ts
import { clsx } from "clsx";
import { formatISO } from "date-fns";
import { twMerge } from "tailwind-merge";

// lib/errors.ts
var visibilityBySurface = {
  database: "log",
  chat: "response",
  auth: "response",
  stream: "response",
  api: "response",
  history: "response",
  vote: "response",
  document: "response",
  suggestions: "response",
  activate_gateway: "response"
};
var ChatbotError = class extends Error {
  type;
  surface;
  statusCode;
  constructor(errorCode, cause) {
    super();
    const [type, surface] = errorCode.split(":");
    this.type = type;
    this.cause = cause;
    this.surface = surface;
    this.message = getMessageByErrorCode(errorCode);
    this.statusCode = getStatusCodeByType(this.type);
  }
  toResponse() {
    const code3 = `${this.type}:${this.surface}`;
    const visibility = visibilityBySurface[this.surface];
    const { message: message2, cause, statusCode } = this;
    if (visibility === "log") {
      console.error({
        code: code3,
        message: message2,
        cause
      });
      return Response.json(
        { code: "", message: "Something went wrong. Please try again later." },
        { status: statusCode }
      );
    }
    return Response.json({ code: code3, message: message2, cause }, { status: statusCode });
  }
};
function getMessageByErrorCode(errorCode) {
  if (errorCode.includes("database")) {
    return "An error occurred while executing a database query.";
  }
  switch (errorCode) {
    case "bad_request:api":
      return "The request couldn't be processed. Please check your input and try again.";
    case "bad_request:activate_gateway":
      return "AI Gateway requires a valid credit card on file to service requests. Please visit https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card to add a card and unlock your free credits.";
    case "unauthorized:auth":
      return "You need to sign in before continuing.";
    case "forbidden:auth":
      return "Your account does not have access to this feature.";
    case "rate_limit:chat":
      return "You've reached the message limit. Come back in 1 hour to continue chatting.";
    case "not_found:chat":
      return "The requested chat was not found. Please check the chat ID and try again.";
    case "forbidden:chat":
      return "This chat belongs to another user. Please check the chat ID and try again.";
    case "unauthorized:chat":
      return "You need to sign in to view this chat. Please sign in and try again.";
    case "offline:chat":
      return "We're having trouble sending your message. Please check your internet connection and try again.";
    case "not_found:document":
      return "The requested document was not found. Please check the document ID and try again.";
    case "forbidden:document":
      return "This document belongs to another user. Please check the document ID and try again.";
    case "unauthorized:document":
      return "You need to sign in to view this document. Please sign in and try again.";
    case "bad_request:document":
      return "The request to create or update the document was invalid. Please check your input and try again.";
    default:
      return "Something went wrong. Please try again later.";
  }
}
function getStatusCodeByType(type) {
  switch (type) {
    case "bad_request":
      return 400;
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "rate_limit":
      return 429;
    case "offline":
      return 503;
    default:
      return 500;
  }
}

// lib/utils.ts
function cn(...inputs) {
  return twMerge(clsx(inputs));
}
var fetcher = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    const { code: code3, cause } = await response.json();
    throw new ChatbotError(code3, cause);
  }
  return response.json();
};
async function fetchWithErrorHandlers(input, init) {
  try {
    const response = await fetch(input, init);
    if (!response.ok) {
      const { code: code3, cause } = await response.json();
      throw new ChatbotError(code3, cause);
    }
    return response;
  } catch (error) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      throw new ChatbotError("offline:chat");
    }
    throw error;
  }
}
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
}
function getDocumentTimestampByIndex(documents, index) {
  if (!documents) {
    return /* @__PURE__ */ new Date();
  }
  if (index > documents.length) {
    return /* @__PURE__ */ new Date();
  }
  return documents[index].createdAt;
}
function sanitizeText(text2) {
  return text2.replace("<has_function_call>", "");
}

// src/components/ui/tooltip.tsx
import { jsx as jsx3, jsxs } from "react/jsx-runtime";
function TooltipProvider({
  delayDuration = 0,
  ...props
}) {
  return /* @__PURE__ */ jsx3(
    TooltipPrimitive.Provider,
    {
      "data-slot": "tooltip-provider",
      delayDuration,
      ...props
    }
  );
}
function Tooltip({
  ...props
}) {
  return /* @__PURE__ */ jsx3(TooltipPrimitive.Root, { "data-slot": "tooltip", ...props });
}
function TooltipTrigger({
  ...props
}) {
  return /* @__PURE__ */ jsx3(TooltipPrimitive.Trigger, { "data-slot": "tooltip-trigger", ...props });
}
function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}) {
  return /* @__PURE__ */ jsx3(TooltipPrimitive.Portal, { children: /* @__PURE__ */ jsxs(
    TooltipPrimitive.Content,
    {
      className: cn(
        "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-2xl bg-foreground px-3 py-1.5 text-xs text-background has-data-[slot=kbd]:pr-1.5 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 **:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-4xl data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      ),
      "data-slot": "tooltip-content",
      sideOffset,
      ...props,
      children: [
        children,
        /* @__PURE__ */ jsx3(TooltipPrimitive.Arrow, { className: "z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-foreground fill-foreground data-[side=left]:translate-x-[-1.5px] data-[side=right]:translate-x-[1.5px]" })
      ]
    }
  ) });
}

// src/components/panel.tsx
import { Suspense } from "react";
import { Toaster } from "sonner";

// src/core/context.tsx
import { createContext, useContext } from "react";
import { jsx as jsx4 } from "react/jsx-runtime";
var ChatbotContext = createContext(null);
function ChatbotProvider({
  config,
  children
}) {
  return /* @__PURE__ */ jsx4(ChatbotContext.Provider, { value: config, children });
}
function useChatbotConfig() {
  const ctx = useContext(ChatbotContext);
  if (!ctx) {
    throw new Error("useChatbotConfig must be used within ChatbotProvider");
  }
  return ctx;
}

// src/hooks/use-active-chat.tsx
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { usePathname as usePathname2 } from "next/navigation";
import {
  createContext as createContext4,
  useContext as useContext4,
  useEffect as useEffect5,
  useMemo as useMemo4,
  useRef as useRef2,
  useState as useState6
} from "react";
import useSWR2, { useSWRConfig as useSWRConfig2 } from "swr";
import { unstable_serialize as unstable_serialize2 } from "swr/infinite";

// src/components/chatbot/data-stream-provider.tsx
import { createContext as createContext2, useContext as useContext2, useMemo, useState } from "react";
import { jsx as jsx5 } from "react/jsx-runtime";
var DataStreamContext = createContext2(null);
function DataStreamProvider({
  children
}) {
  const [dataStream, setDataStream] = useState(
    []
  );
  const value = useMemo(() => ({ dataStream, setDataStream }), [dataStream]);
  return /* @__PURE__ */ jsx5(DataStreamContext.Provider, { value, children });
}
function useDataStream() {
  const context = useContext2(DataStreamContext);
  if (!context) {
    throw new Error("useDataStream must be used within a DataStreamProvider");
  }
  return context;
}

// src/components/chatbot/sidebar-history.tsx
import { isToday, isYesterday, subMonths, subWeeks } from "date-fns";
import { motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import { useState as useState4 } from "react";
import { toast } from "sonner";
import useSWRInfinite from "swr/infinite";

// src/components/ui/alert-dialog.tsx
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";

// src/components/ui/button.tsx
import { cva } from "class-variance-authority";
import { Slot } from "radix-ui";
import { jsx as jsx6 } from "react/jsx-runtime";
var buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline: "border-border bg-input/30 hover:bg-input/50 hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline"
      },
      size: {
        default: "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot.Root : "button";
  return /* @__PURE__ */ jsx6(
    Comp,
    {
      className: cn(buttonVariants({ variant, size, className })),
      "data-size": size,
      "data-slot": "button",
      "data-variant": variant,
      ...props
    }
  );
}

// src/components/ui/alert-dialog.tsx
import { jsx as jsx7, jsxs as jsxs2 } from "react/jsx-runtime";
function AlertDialog({
  ...props
}) {
  return /* @__PURE__ */ jsx7(AlertDialogPrimitive.Root, { "data-slot": "alert-dialog", ...props });
}
function AlertDialogPortal({
  ...props
}) {
  return /* @__PURE__ */ jsx7(AlertDialogPrimitive.Portal, { "data-slot": "alert-dialog-portal", ...props });
}
function AlertDialogOverlay({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx7(
    AlertDialogPrimitive.Overlay,
    {
      className: cn(
        "fixed inset-0 z-50 bg-black/80 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      ),
      "data-slot": "alert-dialog-overlay",
      ...props
    }
  );
}
function AlertDialogContent({
  className,
  size = "default",
  ...props
}) {
  return /* @__PURE__ */ jsxs2(AlertDialogPortal, { children: [
    /* @__PURE__ */ jsx7(AlertDialogOverlay, {}),
    /* @__PURE__ */ jsx7(
      AlertDialogPrimitive.Content,
      {
        className: cn(
          "group/alert-dialog-content fixed top-1/2 left-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-6 rounded-lg bg-background p-6 ring-1 ring-foreground/5 duration-100 outline-none data-[size=default]:max-w-xs data-[size=sm]:max-w-xs data-[size=default]:sm:max-w-md data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className
        ),
        "data-size": size,
        "data-slot": "alert-dialog-content",
        ...props
      }
    )
  ] });
}
function AlertDialogHeader({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx7(
    "div",
    {
      className: cn(
        "grid grid-rows-[auto_1fr] place-items-center gap-1.5 text-center has-data-[slot=alert-dialog-media]:grid-rows-[auto_auto_1fr] has-data-[slot=alert-dialog-media]:gap-x-6 sm:group-data-[size=default]/alert-dialog-content:place-items-start sm:group-data-[size=default]/alert-dialog-content:text-left sm:group-data-[size=default]/alert-dialog-content:has-data-[slot=alert-dialog-media]:grid-rows-[auto_1fr]",
        className
      ),
      "data-slot": "alert-dialog-header",
      ...props
    }
  );
}
function AlertDialogFooter({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx7(
    "div",
    {
      className: cn(
        "flex flex-col-reverse gap-2 group-data-[size=sm]/alert-dialog-content:grid group-data-[size=sm]/alert-dialog-content:grid-cols-2 sm:flex-row sm:justify-end",
        className
      ),
      "data-slot": "alert-dialog-footer",
      ...props
    }
  );
}
function AlertDialogTitle({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx7(
    AlertDialogPrimitive.Title,
    {
      className: cn(
        "text-lg font-medium sm:group-data-[size=default]/alert-dialog-content:group-has-data-[slot=alert-dialog-media]/alert-dialog-content:col-start-2",
        className
      ),
      "data-slot": "alert-dialog-title",
      ...props
    }
  );
}
function AlertDialogDescription({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx7(
    AlertDialogPrimitive.Description,
    {
      className: cn(
        "text-sm text-balance text-muted-foreground md:text-pretty *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      ),
      "data-slot": "alert-dialog-description",
      ...props
    }
  );
}
function AlertDialogAction({
  className,
  variant = "default",
  size = "default",
  ...props
}) {
  return /* @__PURE__ */ jsx7(Button, { asChild: true, size, variant, children: /* @__PURE__ */ jsx7(
    AlertDialogPrimitive.Action,
    {
      className: cn(className),
      "data-slot": "alert-dialog-action",
      ...props
    }
  ) });
}
function AlertDialogCancel({
  className,
  variant = "outline",
  size = "default",
  ...props
}) {
  return /* @__PURE__ */ jsx7(Button, { asChild: true, size, variant, children: /* @__PURE__ */ jsx7(
    AlertDialogPrimitive.Cancel,
    {
      className: cn(className),
      "data-slot": "alert-dialog-cancel",
      ...props
    }
  ) });
}

// src/components/ui/sidebar.tsx
import { cva as cva2 } from "class-variance-authority";
import { PanelLeftIcon } from "lucide-react";
import { Slot as Slot2 } from "radix-ui";
import * as React2 from "react";

// src/components/ui/input.tsx
import { jsx as jsx8 } from "react/jsx-runtime";

// src/components/ui/separator.tsx
import { Separator as SeparatorPrimitive } from "radix-ui";
import { jsx as jsx9 } from "react/jsx-runtime";

// src/components/ui/sheet.tsx
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";
import { jsx as jsx10, jsxs as jsxs3 } from "react/jsx-runtime";
function Sheet({ ...props }) {
  return /* @__PURE__ */ jsx10(SheetPrimitive.Root, { "data-slot": "sheet", ...props });
}
function SheetPortal({
  ...props
}) {
  return /* @__PURE__ */ jsx10(SheetPrimitive.Portal, { "data-slot": "sheet-portal", ...props });
}
function SheetOverlay({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx10(
    SheetPrimitive.Overlay,
    {
      className: cn(
        "fixed inset-0 z-50 bg-black/50 supports-backdrop-filter:backdrop-blur-sm data-open:animate-in data-open:fade-in-0 data-open:duration-300 data-closed:animate-out data-closed:fade-out-0 data-closed:duration-200",
        className
      ),
      "data-slot": "sheet-overlay",
      ...props
    }
  );
}
function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}) {
  return /* @__PURE__ */ jsxs3(SheetPortal, { children: [
    /* @__PURE__ */ jsx10(SheetOverlay, {}),
    /* @__PURE__ */ jsxs3(
      SheetPrimitive.Content,
      {
        className: cn(
          "fixed z-50 flex flex-col bg-background bg-clip-padding text-sm shadow-2xl data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-[85%] data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-[85%] data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:duration-400 data-open:ease-[cubic-bezier(0.32,0.72,0,1)] data-[side=bottom]:data-open:slide-in-from-bottom-full data-[side=left]:data-open:slide-in-from-left-full data-[side=right]:data-open:slide-in-from-right-full data-[side=top]:data-open:slide-in-from-top-full data-closed:animate-out data-closed:fade-out-0 data-closed:duration-300 data-closed:ease-[cubic-bezier(0.32,0.72,0,1)] data-[side=bottom]:data-closed:slide-out-to-bottom-full data-[side=left]:data-closed:slide-out-to-left-full data-[side=right]:data-closed:slide-out-to-right-full data-[side=top]:data-closed:slide-out-to-top-full",
          className
        ),
        "data-side": side,
        "data-slot": "sheet-content",
        ...props,
        children: [
          children,
          showCloseButton && /* @__PURE__ */ jsx10(SheetPrimitive.Close, { asChild: true, "data-slot": "sheet-close", children: /* @__PURE__ */ jsxs3(
            Button,
            {
              className: "absolute top-4 right-4",
              size: "icon-sm",
              variant: "ghost",
              children: [
                /* @__PURE__ */ jsx10(XIcon, {}),
                /* @__PURE__ */ jsx10("span", { className: "sr-only", children: "Close" })
              ]
            }
          ) })
        ]
      }
    )
  ] });
}
function SheetHeader({ className, ...props }) {
  return /* @__PURE__ */ jsx10(
    "div",
    {
      className: cn("flex flex-col gap-1.5 p-6", className),
      "data-slot": "sheet-header",
      ...props
    }
  );
}
function SheetTitle({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx10(
    SheetPrimitive.Title,
    {
      className: cn("text-base font-medium text-foreground", className),
      "data-slot": "sheet-title",
      ...props
    }
  );
}
function SheetDescription({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx10(
    SheetPrimitive.Description,
    {
      className: cn("text-sm text-muted-foreground", className),
      "data-slot": "sheet-description",
      ...props
    }
  );
}

// src/components/ui/skeleton.tsx
import { jsx as jsx11 } from "react/jsx-runtime";

// src/hooks/use-mobile.ts
import * as React from "react";
var MOBILE_BREAKPOINT = 768;
function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(
    void 0
  );
  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return !!isMobile;
}

// src/components/ui/sidebar.tsx
import { jsx as jsx12, jsxs as jsxs4 } from "react/jsx-runtime";
var SIDEBAR_COOKIE_NAME = "sidebar_state";
var SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
var SIDEBAR_WIDTH = "16rem";
var SIDEBAR_WIDTH_ICON = "3rem";
var SIDEBAR_KEYBOARD_SHORTCUT = "b";
var SidebarContext = React2.createContext(null);
function useSidebar() {
  const context = React2.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider.");
  }
  return context;
}
function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React2.useState(false);
  const [_open, _setOpen] = React2.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React2.useCallback(
    (value) => {
      const openState = typeof value === "function" ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
    [setOpenProp, open]
  );
  const toggleSidebar = React2.useCallback(() => {
    return isMobile ? setOpenMobile((open2) => !open2) : setOpen((open2) => !open2);
  }, [isMobile, setOpen, setOpenMobile]);
  React2.useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);
  const state = open ? "expanded" : "collapsed";
  const contextValue = React2.useMemo(
    () => ({
      state,
      open,
      setOpen,
      isMobile,
      openMobile,
      setOpenMobile,
      toggleSidebar
    }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar]
  );
  return /* @__PURE__ */ jsx12(SidebarContext.Provider, { value: contextValue, children: /* @__PURE__ */ jsx12(
    "div",
    {
      className: cn(
        "group/sidebar-wrapper flex min-h-svh w-full bg-sidebar",
        className
      ),
      "data-slot": "sidebar-wrapper",
      style: {
        "--sidebar-width": SIDEBAR_WIDTH,
        "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
        ...style
      },
      ...props,
      children
    }
  ) });
}
function Sidebar({
  side = "left",
  variant = "sidebar",
  collapsible = "offcanvas",
  className,
  children,
  dir,
  ...props
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();
  if (collapsible === "none") {
    return /* @__PURE__ */ jsx12(
      "div",
      {
        className: cn(
          "flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-foreground",
          className
        ),
        "data-slot": "sidebar",
        ...props,
        children
      }
    );
  }
  if (isMobile) {
    return /* @__PURE__ */ jsx12(Sheet, { onOpenChange: setOpenMobile, open: openMobile, ...props, children: /* @__PURE__ */ jsxs4(
      SheetContent,
      {
        className: "inset-x-0 bottom-0 top-auto h-[70dvh] w-full rounded-t-2xl border-t border-border/30 bg-sidebar p-0 text-sidebar-foreground [&>button]:hidden",
        "data-mobile": "true",
        "data-sidebar": "sidebar",
        "data-slot": "sidebar",
        dir,
        showCloseButton: false,
        side: "bottom",
        children: [
          /* @__PURE__ */ jsxs4(SheetHeader, { className: "sr-only", children: [
            /* @__PURE__ */ jsx12(SheetTitle, { children: "Sidebar" }),
            /* @__PURE__ */ jsx12(SheetDescription, { children: "Displays the mobile sidebar." })
          ] }),
          /* @__PURE__ */ jsx12("div", { className: "mx-auto mt-2 h-1 w-10 rounded-full bg-sidebar-foreground/20" }),
          /* @__PURE__ */ jsx12("div", { className: "flex h-full w-full flex-col overflow-y-auto pt-2", children })
        ]
      }
    ) });
  }
  return /* @__PURE__ */ jsxs4(
    "div",
    {
      className: "group peer hidden text-sidebar-foreground md:block",
      "data-collapsible": state === "collapsed" ? collapsible : "",
      "data-side": side,
      "data-slot": "sidebar",
      "data-state": state,
      "data-variant": variant,
      children: [
        /* @__PURE__ */ jsx12(
          "div",
          {
            className: cn(
              "relative w-(--sidebar-width) bg-transparent transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
              "group-data-[collapsible=offcanvas]:w-0",
              "group-data-[side=right]:rotate-180",
              variant === "floating" || variant === "inset" ? "group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4)))]" : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)"
            ),
            "data-slot": "sidebar-gap"
          }
        ),
        /* @__PURE__ */ jsx12(
          "div",
          {
            className: cn(
              "fixed inset-y-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-[side=left]:left-0 data-[side=left]:group-data-[collapsible=offcanvas]:left-[calc(var(--sidebar-width)*-1)] data-[side=right]:right-0 data-[side=right]:group-data-[collapsible=offcanvas]:right-[calc(var(--sidebar-width)*-1)] md:flex",
              variant === "floating" || variant === "inset" ? "p-2 group-data-[collapsible=icon]:w-[calc(var(--sidebar-width-icon)+(--spacing(4))+2px)]" : "group-data-[collapsible=icon]:w-(--sidebar-width-icon)",
              className
            ),
            "data-side": side,
            "data-slot": "sidebar-container",
            ...props,
            children: /* @__PURE__ */ jsx12(
              "div",
              {
                className: "flex size-full flex-col bg-sidebar group-data-[variant=floating]:rounded-lg group-data-[variant=floating]:border-none group-data-[variant=floating]:shadow-sm group-data-[variant=floating]:ring-1 group-data-[variant=floating]:ring-sidebar-border",
                "data-sidebar": "sidebar",
                "data-slot": "sidebar-inner",
                children
              }
            )
          }
        )
      ]
    }
  );
}
function SidebarTrigger({
  className,
  onClick,
  ...props
}) {
  const { toggleSidebar } = useSidebar();
  return /* @__PURE__ */ jsxs4(
    Button,
    {
      className: cn(className),
      "data-sidebar": "trigger",
      "data-slot": "sidebar-trigger",
      onClick: (event) => {
        onClick?.(event);
        toggleSidebar();
      },
      size: "icon-sm",
      variant: "ghost",
      ...props,
      children: [
        /* @__PURE__ */ jsx12(PanelLeftIcon, {}),
        /* @__PURE__ */ jsx12("span", { className: "sr-only", children: "Toggle Sidebar" })
      ]
    }
  );
}
function SidebarRail({ className, ...props }) {
  const { toggleSidebar, state } = useSidebar();
  const isCollapsed = state === "collapsed";
  return /* @__PURE__ */ jsxs4(
    "div",
    {
      className: cn(
        "group/rail absolute inset-y-0 z-20 hidden w-4 overflow-visible group-data-[side=left]:-right-4 sm:block",
        className
      ),
      "data-slot": "sidebar-rail",
      children: [
        /* @__PURE__ */ jsx12(
          "button",
          {
            "aria-label": "Toggle Sidebar",
            className: "absolute inset-y-0 left-0 w-4 cursor-w-resize [[data-side=left][data-state=collapsed]_&]:cursor-e-resize",
            "data-sidebar": "rail",
            onClick: toggleSidebar,
            tabIndex: -1,
            ...props
          }
        ),
        /* @__PURE__ */ jsx12(
          "button",
          {
            "aria-label": "Toggle Sidebar",
            className: cn(
              "absolute left-0 h-3 w-3 cursor-e-resize",
              isCollapsed ? "top-0" : "top-[calc(3.5rem-6px)] cursor-w-resize"
            ),
            onClick: toggleSidebar,
            tabIndex: -1
          }
        ),
        /* @__PURE__ */ jsx12(
          "button",
          {
            "aria-label": "Toggle Sidebar",
            className: cn(
              "absolute left-3 h-[6px] w-[100vw] cursor-e-resize",
              isCollapsed ? "top-0" : "top-[calc(3.5rem-6px)] cursor-w-resize"
            ),
            onClick: toggleSidebar,
            tabIndex: -1
          }
        ),
        /* @__PURE__ */ jsx12(
          "div",
          {
            className: cn(
              "pointer-events-none absolute bottom-0 left-0 w-[100vw] rounded-tl-[12px] border-t border-l border-sidebar-border opacity-0 transition-opacity duration-150 group-hover/rail:opacity-100",
              isCollapsed ? "top-0" : "top-14"
            )
          }
        )
      ]
    }
  );
}
function SidebarInset({ className, ...props }) {
  return /* @__PURE__ */ jsx12(
    "main",
    {
      className: cn(
        "relative flex w-full flex-1 flex-col bg-sidebar [transform:translate3d(0,0,0)]",
        className
      ),
      "data-slot": "sidebar-inset",
      ...props
    }
  );
}
function SidebarHeader({ className, ...props }) {
  return /* @__PURE__ */ jsx12(
    "div",
    {
      className: cn(
        "flex flex-col gap-2 p-2 [--radius:var(--radius-xl)]",
        className
      ),
      "data-sidebar": "header",
      "data-slot": "sidebar-header",
      ...props
    }
  );
}
function SidebarFooter({ className, ...props }) {
  return /* @__PURE__ */ jsx12(
    "div",
    {
      className: cn("flex flex-col gap-2 p-2", className),
      "data-sidebar": "footer",
      "data-slot": "sidebar-footer",
      ...props
    }
  );
}
function SidebarContent({ className, ...props }) {
  return /* @__PURE__ */ jsx12(
    "div",
    {
      className: cn(
        "no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-auto [--radius:var(--radius-xl)] group-data-[collapsible=icon]:overflow-hidden",
        className
      ),
      "data-sidebar": "content",
      "data-slot": "sidebar-content",
      ...props
    }
  );
}
function SidebarGroup({ className, ...props }) {
  return /* @__PURE__ */ jsx12(
    "div",
    {
      className: cn("relative flex w-full min-w-0 flex-col p-2", className),
      "data-sidebar": "group",
      "data-slot": "sidebar-group",
      ...props
    }
  );
}
function SidebarGroupLabel({
  className,
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot2.Root : "div";
  return /* @__PURE__ */ jsx12(
    Comp,
    {
      className: cn(
        "flex h-8 shrink-0 items-center rounded-md px-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70 ring-sidebar-ring outline-hidden transition-[margin,opacity] duration-200 ease-linear group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0 focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0",
        className
      ),
      "data-sidebar": "group-label",
      "data-slot": "sidebar-group-label",
      ...props
    }
  );
}
function SidebarGroupContent({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx12(
    "div",
    {
      className: cn("w-full text-sm", className),
      "data-sidebar": "group-content",
      "data-slot": "sidebar-group-content",
      ...props
    }
  );
}
function SidebarMenu({ className, ...props }) {
  return /* @__PURE__ */ jsx12(
    "ul",
    {
      className: cn("flex w-full min-w-0 flex-col gap-1", className),
      "data-sidebar": "menu",
      "data-slot": "sidebar-menu",
      ...props
    }
  );
}
function SidebarMenuItem({ className, ...props }) {
  return /* @__PURE__ */ jsx12(
    "li",
    {
      className: cn("group/menu-item relative", className),
      "data-sidebar": "menu-item",
      "data-slot": "sidebar-menu-item",
      ...props
    }
  );
}
var sidebarMenuButtonVariants = cva2(
  "peer/menu-button group/menu-button flex w-full items-center gap-2 overflow-hidden px-2.5 text-left text-[13px] text-sidebar-foreground/70 outline-hidden transition-colors duration-150 group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! hover:text-sidebar-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-open:hover:text-sidebar-accent-foreground data-active:font-medium data-active:text-sidebar-accent-foreground [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
  {
    variants: {
      variant: {
        default: "hover:text-sidebar-accent-foreground",
        outline: "bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]"
      },
      size: {
        default: "h-8 text-[13px]",
        sm: "h-8 text-xs",
        lg: "h-14 px-3 text-sm group-data-[collapsible=icon]:p-0!"
      }
    },
    defaultVariants: {
      variant: "default",
      size: "default"
    }
  }
);
function SidebarMenuButton({
  asChild = false,
  isActive = false,
  variant = "default",
  size = "default",
  tooltip,
  className,
  ...props
}) {
  const Comp = asChild ? Slot2.Root : "button";
  const { isMobile, state } = useSidebar();
  const button = /* @__PURE__ */ jsx12(
    Comp,
    {
      className: cn(sidebarMenuButtonVariants({ variant, size }), className),
      "data-active": isActive,
      "data-sidebar": "menu-button",
      "data-size": size,
      "data-slot": "sidebar-menu-button",
      ...props
    }
  );
  if (!tooltip) {
    return button;
  }
  if (typeof tooltip === "string") {
    tooltip = {
      children: tooltip
    };
  }
  return /* @__PURE__ */ jsxs4(Tooltip, { children: [
    /* @__PURE__ */ jsx12(TooltipTrigger, { asChild: true, children: button }),
    /* @__PURE__ */ jsx12(
      TooltipContent,
      {
        align: "center",
        hidden: state !== "collapsed" || isMobile,
        side: "right",
        ...tooltip
      }
    )
  ] });
}
function SidebarMenuAction({
  className,
  asChild = false,
  showOnHover = false,
  ...props
}) {
  const Comp = asChild ? Slot2.Root : "button";
  return /* @__PURE__ */ jsx12(
    Comp,
    {
      className: cn(
        "absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground/40 outline-hidden transition-colors duration-150 group-data-[collapsible=icon]:hidden peer-hover/menu-button:text-sidebar-foreground/60 peer-data-[size=default]/menu-button:top-1.5 peer-data-[size=lg]/menu-button:top-2.5 peer-data-[size=sm]/menu-button:top-1 after:absolute after:-inset-2 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:after:hidden [&>svg]:size-4 [&>svg]:shrink-0",
        showOnHover && "group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 peer-data-active/menu-button:text-sidebar-accent-foreground aria-expanded:opacity-100 md:opacity-0",
        className
      ),
      "data-sidebar": "menu-action",
      "data-slot": "sidebar-menu-action",
      ...props
    }
  );
}

// src/components/chatbot/icons.tsx
import { jsx as jsx13, jsxs as jsxs5 } from "react/jsx-runtime";
var VercelIcon = ({ size = 17 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M8 1L16 15H0L8 1Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var FileIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M14.5 13.5V6.5V5.41421C14.5 5.149 14.3946 4.89464 14.2071 4.70711L9.79289 0.292893C9.60536 0.105357 9.351 0 9.08579 0H8H3H1.5V1.5V13.5C1.5 14.8807 2.61929 16 4 16H12C13.3807 16 14.5 14.8807 14.5 13.5ZM13 13.5V6.5H9.5H8V5V1.5H3V13.5C3 14.0523 3.44772 14.5 4 14.5H12C12.5523 14.5 13 14.0523 13 13.5ZM9.5 5V2.12132L12.3787 5H9.5ZM5.13 5.00062H4.505V6.25062H5.13H6H6.625V5.00062H6H5.13ZM4.505 8H5.13H11H11.625V9.25H11H5.13H4.505V8ZM5.13 11H4.505V12.25H5.13H11H11.625V11H11H5.13Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var LoaderIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsxs5(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: [
        /* @__PURE__ */ jsxs5("g", { clipPath: "url(#clip0_2393_1490)", children: [
          /* @__PURE__ */ jsx13("path", { d: "M8 0V4", stroke: "currentColor", strokeWidth: "1.5" }),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M8 16V12",
              opacity: "0.5",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          ),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M3.29773 1.52783L5.64887 4.7639",
              opacity: "0.9",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          ),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M12.7023 1.52783L10.3511 4.7639",
              opacity: "0.1",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          ),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M12.7023 14.472L10.3511 11.236",
              opacity: "0.4",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          ),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M3.29773 14.472L5.64887 11.236",
              opacity: "0.6",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          ),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M15.6085 5.52783L11.8043 6.7639",
              opacity: "0.2",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          ),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M0.391602 10.472L4.19583 9.23598",
              opacity: "0.7",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          ),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M15.6085 10.4722L11.8043 9.2361",
              opacity: "0.3",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          ),
          /* @__PURE__ */ jsx13(
            "path",
            {
              d: "M0.391602 5.52783L4.19583 6.7639",
              opacity: "0.8",
              stroke: "currentColor",
              strokeWidth: "1.5"
            }
          )
        ] }),
        /* @__PURE__ */ jsx13("defs", { children: /* @__PURE__ */ jsx13("clipPath", { id: "clip0_2393_1490", children: /* @__PURE__ */ jsx13("rect", { fill: "white", height: "16", width: "16" }) }) })
      ]
    }
  );
};
var PencilEditIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M11.75 0.189331L12.2803 0.719661L15.2803 3.71966L15.8107 4.24999L15.2803 4.78032L5.15901 14.9016C4.45575 15.6049 3.50192 16 2.50736 16H0.75H0V15.25V13.4926C0 12.4981 0.395088 11.5442 1.09835 10.841L11.2197 0.719661L11.75 0.189331ZM11.75 2.31065L9.81066 4.24999L11.75 6.18933L13.6893 4.24999L11.75 2.31065ZM2.15901 11.9016L8.75 5.31065L10.6893 7.24999L4.09835 13.841C3.67639 14.2629 3.1041 14.5 2.50736 14.5H1.5V13.4926C1.5 12.8959 1.73705 12.3236 2.15901 11.9016ZM9 16H16V14.5H9V16Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var TrashIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M6.75 2.75C6.75 2.05964 7.30964 1.5 8 1.5C8.69036 1.5 9.25 2.05964 9.25 2.75V3H6.75V2.75ZM5.25 3V2.75C5.25 1.23122 6.48122 0 8 0C9.51878 0 10.75 1.23122 10.75 2.75V3H12.9201H14.25H15V4.5H14.25H13.8846L13.1776 13.6917C13.0774 14.9942 11.9913 16 10.6849 16H5.31508C4.00874 16 2.92263 14.9942 2.82244 13.6917L2.11538 4.5H1.75H1V3H1.75H3.07988H5.25ZM4.31802 13.5767L3.61982 4.5H12.3802L11.682 13.5767C11.6419 14.0977 11.2075 14.5 10.6849 14.5H5.31508C4.79254 14.5 4.3581 14.0977 4.31802 13.5767Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var ArrowUpIcon = ({
  size = 16,
  ...props
}) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor", ...props.style },
      viewBox: "0 0 16 16",
      width: size,
      ...props,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M8.70711 1.39644C8.31659 1.00592 7.68342 1.00592 7.2929 1.39644L2.21968 6.46966L1.68935 6.99999L2.75001 8.06065L3.28034 7.53032L7.25001 3.56065V14.25V15H8.75001V14.25V3.56065L12.7197 7.53032L13.25 8.06065L14.3107 6.99999L13.7803 6.46966L8.70711 1.39644Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var StopIcon = ({
  size = 16,
  ...props
}) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      style: { color: "currentcolor", ...props.style },
      viewBox: "0 0 16 16",
      width: size,
      ...props,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M3 3H13V13H3V3Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var PaperclipIcon = ({
  size = 16,
  ...props
}) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      className: "-rotate-45",
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor", ...props.style },
      viewBox: "0 0 16 16",
      width: size,
      ...props,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M10.8591 1.70735C10.3257 1.70735 9.81417 1.91925 9.437 2.29643L3.19455 8.53886C2.56246 9.17095 2.20735 10.0282 2.20735 10.9222C2.20735 11.8161 2.56246 12.6734 3.19455 13.3055C3.82665 13.9376 4.68395 14.2927 5.57786 14.2927C6.47178 14.2927 7.32908 13.9376 7.96117 13.3055L14.2036 7.06304L14.7038 6.56287L15.7041 7.56321L15.204 8.06337L8.96151 14.3058C8.06411 15.2032 6.84698 15.7074 5.57786 15.7074C4.30875 15.7074 3.09162 15.2032 2.19422 14.3058C1.29682 13.4084 0.792664 12.1913 0.792664 10.9222C0.792664 9.65305 1.29682 8.43592 2.19422 7.53852L8.43666 1.29609C9.07914 0.653606 9.95054 0.292664 10.8591 0.292664C11.7678 0.292664 12.6392 0.653606 13.2816 1.29609C13.9241 1.93857 14.2851 2.80997 14.2851 3.71857C14.2851 4.62718 13.9241 5.49858 13.2816 6.14106L13.2814 6.14133L7.0324 12.3835C7.03231 12.3836 7.03222 12.3837 7.03213 12.3838C6.64459 12.7712 6.11905 12.9888 5.57107 12.9888C5.02297 12.9888 4.49731 12.7711 4.10974 12.3835C3.72217 11.9959 3.50444 11.4703 3.50444 10.9222C3.50444 10.3741 3.72217 9.8484 4.10974 9.46084L4.11004 9.46054L9.877 3.70039L10.3775 3.20051L11.3772 4.20144L10.8767 4.70131L5.11008 10.4612C5.11005 10.4612 5.11003 10.4612 5.11 10.4613C4.98779 10.5835 4.91913 10.7493 4.91913 10.9222C4.91913 11.0951 4.98782 11.2609 5.11008 11.3832C5.23234 11.5054 5.39817 11.5741 5.57107 11.5741C5.74398 11.5741 5.9098 11.5054 6.03206 11.3832L6.03233 11.3829L12.2813 5.14072C12.2814 5.14063 12.2815 5.14054 12.2816 5.14045C12.6586 4.7633 12.8704 4.25185 12.8704 3.71857C12.8704 3.18516 12.6585 2.6736 12.2813 2.29643C11.9041 1.91925 11.3926 1.70735 10.8591 1.70735Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var MoreHorizontalIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M4 8C4 8.82843 3.32843 9.5 2.5 9.5C1.67157 9.5 1 8.82843 1 8C1 7.17157 1.67157 6.5 2.5 6.5C3.32843 6.5 4 7.17157 4 8ZM9.5 8C9.5 8.82843 8.82843 9.5 8 9.5C7.17157 9.5 6.5 8.82843 6.5 8C6.5 7.17157 7.17157 6.5 8 6.5C8.82843 6.5 9.5 7.17157 9.5 8ZM13.5 9.5C14.3284 9.5 15 8.82843 15 8C15 7.17157 14.3284 6.5 13.5 6.5C12.6716 6.5 12 7.17157 12 8C12 8.82843 12.6716 9.5 13.5 9.5Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var MessageIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M2.8914 10.4028L2.98327 10.6318C3.22909 11.2445 3.5 12.1045 3.5 13C3.5 13.3588 3.4564 13.7131 3.38773 14.0495C3.69637 13.9446 4.01409 13.8159 4.32918 13.6584C4.87888 13.3835 5.33961 13.0611 5.70994 12.7521L6.22471 12.3226L6.88809 12.4196C7.24851 12.4724 7.61994 12.5 8 12.5C11.7843 12.5 14.5 9.85569 14.5 7C14.5 4.14431 11.7843 1.5 8 1.5C4.21574 1.5 1.5 4.14431 1.5 7C1.5 8.18175 1.94229 9.29322 2.73103 10.2153L2.8914 10.4028ZM2.8135 15.7653C1.76096 16 1 16 1 16C1 16 1.43322 15.3097 1.72937 14.4367C1.88317 13.9834 2 13.4808 2 13C2 12.3826 1.80733 11.7292 1.59114 11.1903C0.591845 10.0221 0 8.57152 0 7C0 3.13401 3.58172 0 8 0C12.4183 0 16 3.13401 16 7C16 10.866 12.4183 14 8 14C7.54721 14 7.10321 13.9671 6.67094 13.9038C6.22579 14.2753 5.66881 14.6656 5 15C4.23366 15.3832 3.46733 15.6195 2.8135 15.7653Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var CrossIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M12.4697 13.5303L13 14.0607L14.0607 13L13.5303 12.4697L9.06065 7.99999L13.5303 3.53032L14.0607 2.99999L13 1.93933L12.4697 2.46966L7.99999 6.93933L3.53032 2.46966L2.99999 1.93933L1.93933 2.99999L2.46966 3.53032L6.93933 7.99999L2.46966 12.4697L1.93933 13L2.99999 14.0607L3.53032 13.5303L7.99999 9.06065L12.4697 13.5303Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var CrossSmallIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M9.96966 11.0303L10.5 11.5607L11.5607 10.5L11.0303 9.96966L9.06065 7.99999L11.0303 6.03032L11.5607 5.49999L10.5 4.43933L9.96966 4.96966L7.99999 6.93933L6.03032 4.96966L5.49999 4.43933L4.43933 5.49999L4.96966 6.03032L6.93933 7.99999L4.96966 9.96966L4.43933 10.5L5.49999 11.5607L6.03032 11.0303L7.99999 9.06065L9.96966 11.0303Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var UndoIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M13.5 8C13.5 4.96643 11.0257 2.5 7.96452 2.5C5.42843 2.5 3.29365 4.19393 2.63724 6.5H5.25H6V8H5.25H0.75C0.335787 8 0 7.66421 0 7.25V2.75V2H1.5V2.75V5.23347C2.57851 2.74164 5.06835 1 7.96452 1C11.8461 1 15 4.13001 15 8C15 11.87 11.8461 15 7.96452 15C5.62368 15 3.54872 13.8617 2.27046 12.1122L1.828 11.5066L3.03915 10.6217L3.48161 11.2273C4.48831 12.6051 6.12055 13.5 7.96452 13.5C11.0257 13.5 13.5 11.0336 13.5 8Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var RedoIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M2.5 8C2.5 4.96643 4.97431 2.5 8.03548 2.5C10.5716 2.5 12.7064 4.19393 13.3628 6.5H10.75H10V8H10.75H15.25C15.6642 8 16 7.66421 16 7.25V2.75V2H14.5V2.75V5.23347C13.4215 2.74164 10.9316 1 8.03548 1C4.1539 1 1 4.13001 1 8C1 11.87 4.1539 15 8.03548 15C10.3763 15 12.4513 13.8617 13.7295 12.1122L14.172 11.5066L12.9609 10.6217L12.5184 11.2273C11.5117 12.6051 9.87945 13.5 8.03548 13.5C4.97431 13.5 2.5 11.0336 2.5 8Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var PenIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M8.75 0.189331L9.28033 0.719661L15.2803 6.71966L15.8107 7.24999L15.2803 7.78032L13.7374 9.32322C13.1911 9.8696 12.3733 9.97916 11.718 9.65188L9.54863 13.5568C8.71088 15.0648 7.12143 16 5.39639 16H0.75H0V15.25V10.6036C0 8.87856 0.935237 7.28911 2.4432 6.45136L6.34811 4.28196C6.02084 3.62674 6.13039 2.80894 6.67678 2.26255L8.21967 0.719661L8.75 0.189331ZM7.3697 5.43035L10.5696 8.63029L8.2374 12.8283C7.6642 13.8601 6.57668 14.5 5.39639 14.5H2.56066L5.53033 11.5303L4.46967 10.4697L1.5 13.4393V10.6036C1.5 9.42331 2.1399 8.33579 3.17166 7.76259L7.3697 5.43035ZM12.6768 8.26256C12.5791 8.36019 12.4209 8.36019 12.3232 8.26255L12.0303 7.96966L8.03033 3.96966L7.73744 3.67677C7.63981 3.57914 7.63981 3.42085 7.73744 3.32321L8.75 2.31065L13.6893 7.24999L12.6768 8.26256Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var SummarizeIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M1.75 12H1V10.5H1.75H5.25H6V12H5.25H1.75ZM1.75 7.75H1V6.25H1.75H4.25H5V7.75H4.25H1.75ZM1.75 3.5H1V2H1.75H7.25H8V3.5H7.25H1.75ZM12.5303 14.7803C12.2374 15.0732 11.7626 15.0732 11.4697 14.7803L9.21967 12.5303L8.68934 12L9.75 10.9393L10.2803 11.4697L11.25 12.4393V2.75V2H12.75V2.75V12.4393L13.7197 11.4697L14.25 10.9393L15.3107 12L14.7803 12.5303L12.5303 14.7803Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var CopyIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M2.75 0.5C1.7835 0.5 1 1.2835 1 2.25V9.75C1 10.7165 1.7835 11.5 2.75 11.5H3.75H4.5V10H3.75H2.75C2.61193 10 2.5 9.88807 2.5 9.75V2.25C2.5 2.11193 2.61193 2 2.75 2H8.25C8.38807 2 8.5 2.11193 8.5 2.25V3H10V2.25C10 1.2835 9.2165 0.5 8.25 0.5H2.75ZM7.75 4.5C6.7835 4.5 6 5.2835 6 6.25V13.75C6 14.7165 6.7835 15.5 7.75 15.5H13.25C14.2165 15.5 15 14.7165 15 13.75V6.25C15 5.2835 14.2165 4.5 13.25 4.5H7.75ZM7.5 6.25C7.5 6.11193 7.61193 6 7.75 6H13.25C13.3881 6 13.5 6.11193 13.5 6.25V13.75C13.5 13.8881 13.3881 14 13.25 14H7.75C7.61193 14 7.5 13.8881 7.5 13.75V6.25Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var ThumbUpIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M6.89531 2.23972C6.72984 2.12153 6.5 2.23981 6.5 2.44315V5.25001C6.5 6.21651 5.7165 7.00001 4.75 7.00001H2.5V13.5H12.1884C12.762 13.5 13.262 13.1096 13.4011 12.5532L14.4011 8.55318C14.5984 7.76425 14.0017 7.00001 13.1884 7.00001H9.25H8.5V6.25001V3.51458C8.5 3.43384 8.46101 3.35807 8.39531 3.31114L6.89531 2.23972ZM5 2.44315C5 1.01975 6.6089 0.191779 7.76717 1.01912L9.26717 2.09054C9.72706 2.41904 10 2.94941 10 3.51458V5.50001H13.1884C14.9775 5.50001 16.2903 7.18133 15.8563 8.91698L14.8563 12.917C14.5503 14.1412 13.4503 15 12.1884 15H1.75H1V14.25V6.25001V5.50001H1.75H4.75C4.88807 5.50001 5 5.38808 5 5.25001V2.44315Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var ThumbDownIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M6.89531 13.7603C6.72984 13.8785 6.5 13.7602 6.5 13.5569V10.75C6.5 9.7835 5.7165 9 4.75 9H2.5V2.5H12.1884C12.762 2.5 13.262 2.89037 13.4011 3.44683L14.4011 7.44683C14.5984 8.23576 14.0017 9 13.1884 9H9.25H8.5V9.75V12.4854C8.5 12.5662 8.46101 12.6419 8.39531 12.6889L6.89531 13.7603ZM5 13.5569C5 14.9803 6.6089 15.8082 7.76717 14.9809L9.26717 13.9095C9.72706 13.581 10 13.0506 10 12.4854V10.5H13.1884C14.9775 10.5 16.2903 8.81868 15.8563 7.08303L14.8563 3.08303C14.5503 1.85882 13.4503 1 12.1884 1H1.75H1V1.75V9.75V10.5H1.75H4.75C4.88807 10.5 5 10.6119 5 10.75V13.5569Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var ChevronDownIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M12.0607 6.74999L11.5303 7.28032L8.7071 10.1035C8.31657 10.4941 7.68341 10.4941 7.29288 10.1035L4.46966 7.28032L3.93933 6.74999L4.99999 5.68933L5.53032 6.21966L7.99999 8.68933L10.4697 6.21966L11 5.68933L12.0607 6.74999Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var SparklesIcon = ({ size = 16 }) => /* @__PURE__ */ jsxs5(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: [
      /* @__PURE__ */ jsx13(
        "path",
        {
          d: "M2.5 0.5V0H3.5V0.5C3.5 1.60457 4.39543 2.5 5.5 2.5H6V3V3.5H5.5C4.39543 3.5 3.5 4.39543 3.5 5.5V6H3H2.5V5.5C2.5 4.39543 1.60457 3.5 0.5 3.5H0V3V2.5H0.5C1.60457 2.5 2.5 1.60457 2.5 0.5Z",
          fill: "currentColor"
        }
      ),
      /* @__PURE__ */ jsx13(
        "path",
        {
          d: "M14.5 4.5V5H13.5V4.5C13.5 3.94772 13.0523 3.5 12.5 3.5H12V3V2.5H12.5C13.0523 2.5 13.5 2.05228 13.5 1.5V1H14H14.5V1.5C14.5 2.05228 14.9477 2.5 15.5 2.5H16V3V3.5H15.5C14.9477 3.5 14.5 3.94772 14.5 4.5Z",
          fill: "currentColor"
        }
      ),
      /* @__PURE__ */ jsx13(
        "path",
        {
          d: "M8.40706 4.92939L8.5 4H9.5L9.59294 4.92939C9.82973 7.29734 11.7027 9.17027 14.0706 9.40706L15 9.5V10.5L14.0706 10.5929C11.7027 10.8297 9.82973 12.7027 9.59294 15.0706L9.5 16H8.5L8.40706 15.0706C8.17027 12.7027 6.29734 10.8297 3.92939 10.5929L3 10.5V9.5L3.92939 9.40706C6.29734 9.17027 8.17027 7.29734 8.40706 4.92939Z",
          fill: "currentColor"
        }
      )
    ]
  }
);
var CheckCircleFillIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M16 8C16 12.4183 12.4183 16 8 16C3.58172 16 0 12.4183 0 8C0 3.58172 3.58172 0 8 0C12.4183 0 16 3.58172 16 8ZM11.5303 6.53033L12.0607 6L11 4.93934L10.4697 5.46967L6.5 9.43934L5.53033 8.46967L5 7.93934L3.93934 9L4.46967 9.53033L5.96967 11.0303C6.26256 11.3232 6.73744 11.3232 7.03033 11.0303L11.5303 6.53033Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var GlobeIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M10.268 14.0934C11.9051 13.4838 13.2303 12.2333 13.9384 10.6469C13.1192 10.7941 12.2138 10.9111 11.2469 10.9925C11.0336 12.2005 10.695 13.2621 10.268 14.0934ZM8 16C12.4183 16 16 12.4183 16 8C16 3.58172 12.4183 0 8 0C3.58172 0 0 3.58172 0 8C0 12.4183 3.58172 16 8 16ZM8.48347 14.4823C8.32384 14.494 8.16262 14.5 8 14.5C7.83738 14.5 7.67616 14.494 7.51654 14.4823C7.5132 14.4791 7.50984 14.4759 7.50647 14.4726C7.2415 14.2165 6.94578 13.7854 6.67032 13.1558C6.41594 12.5744 6.19979 11.8714 6.04101 11.0778C6.67605 11.1088 7.33104 11.125 8 11.125C8.66896 11.125 9.32395 11.1088 9.95899 11.0778C9.80021 11.8714 9.58406 12.5744 9.32968 13.1558C9.05422 13.7854 8.7585 14.2165 8.49353 14.4726C8.49016 14.4759 8.4868 14.4791 8.48347 14.4823ZM11.4187 9.72246C12.5137 9.62096 13.5116 9.47245 14.3724 9.28806C14.4561 8.87172 14.5 8.44099 14.5 8C14.5 7.55901 14.4561 7.12828 14.3724 6.71194C13.5116 6.52755 12.5137 6.37904 11.4187 6.27753C11.4719 6.83232 11.5 7.40867 11.5 8C11.5 8.59133 11.4719 9.16768 11.4187 9.72246ZM10.1525 6.18401C10.2157 6.75982 10.25 7.36805 10.25 8C10.25 8.63195 10.2157 9.24018 10.1525 9.81598C9.46123 9.85455 8.7409 9.875 8 9.875C7.25909 9.875 6.53877 9.85455 5.84749 9.81598C5.7843 9.24018 5.75 8.63195 5.75 8C5.75 7.36805 5.7843 6.75982 5.84749 6.18401C6.53877 6.14545 7.25909 6.125 8 6.125C8.74091 6.125 9.46123 6.14545 10.1525 6.18401ZM11.2469 5.00748C12.2138 5.08891 13.1191 5.20593 13.9384 5.35306C13.2303 3.7667 11.9051 2.51622 10.268 1.90662C10.695 2.73788 11.0336 3.79953 11.2469 5.00748ZM8.48347 1.51771C8.4868 1.52089 8.49016 1.52411 8.49353 1.52737C8.7585 1.78353 9.05422 2.21456 9.32968 2.84417C9.58406 3.42562 9.80021 4.12856 9.95899 4.92219C9.32395 4.89118 8.66896 4.875 8 4.875C7.33104 4.875 6.67605 4.89118 6.04101 4.92219C6.19978 4.12856 6.41594 3.42562 6.67032 2.84417C6.94578 2.21456 7.2415 1.78353 7.50647 1.52737C7.50984 1.52411 7.51319 1.52089 7.51653 1.51771C7.67615 1.50597 7.83738 1.5 8 1.5C8.16262 1.5 8.32384 1.50597 8.48347 1.51771ZM5.73202 1.90663C4.0949 2.51622 2.76975 3.7667 2.06159 5.35306C2.88085 5.20593 3.78617 5.08891 4.75309 5.00748C4.96639 3.79953 5.30497 2.73788 5.73202 1.90663ZM4.58133 6.27753C3.48633 6.37904 2.48837 6.52755 1.62761 6.71194C1.54392 7.12828 1.5 7.55901 1.5 8C1.5 8.44099 1.54392 8.87172 1.62761 9.28806C2.48837 9.47245 3.48633 9.62096 4.58133 9.72246C4.52807 9.16768 4.5 8.59133 4.5 8C4.5 7.40867 4.52807 6.83232 4.58133 6.27753ZM4.75309 10.9925C3.78617 10.9111 2.88085 10.7941 2.06159 10.6469C2.76975 12.2333 4.0949 13.4838 5.73202 14.0934C5.30497 13.2621 4.96639 12.2005 4.75309 10.9925Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var LockIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M10 4.5V6H6V4.5C6 3.39543 6.89543 2.5 8 2.5C9.10457 2.5 10 3.39543 10 4.5ZM4.5 6V4.5C4.5 2.567 6.067 1 8 1C9.933 1 11.5 2.567 11.5 4.5V6H12.5H14V7.5V12.5C14 13.8807 12.8807 15 11.5 15H4.5C3.11929 15 2 13.8807 2 12.5V7.5V6H3.5H4.5ZM11.5 7.5H10H6H4.5H3.5V12.5C3.5 13.0523 3.94772 13.5 4.5 13.5H11.5C12.0523 13.5 12.5 13.0523 12.5 12.5V7.5H11.5Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var ShareIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M15 11.25V10.5H13.5V11.25V12.75C13.5 13.1642 13.1642 13.5 12.75 13.5H3.25C2.83579 13.5 2.5 13.1642 2.5 12.75L2.5 3.25C2.5 2.83579 2.83579 2.5 3.25 2.5H5.75H6.5V1H5.75H3.25C2.00736 1 1 2.00736 1 3.25V12.75C1 13.9926 2.00736 15 3.25 15H12.75C13.9926 15 15 13.9926 15 12.75V11.25ZM15 5.5L10.5 1V4C7.46243 4 5 6.46243 5 9.5V10L5.05855 9.91218C6.27146 8.09281 8.31339 7 10.5 7V10L15 5.5Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var CodeIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M4.21969 12.5303L4.75002 13.0607L5.81068 12L5.28035 11.4697L1.81068 7.99999L5.28035 4.53032L5.81068 3.99999L4.75002 2.93933L4.21969 3.46966L0.39647 7.29289C0.00594562 7.68341 0.00594562 8.31658 0.39647 8.7071L4.21969 12.5303ZM11.7804 12.5303L11.25 13.0607L10.1894 12L10.7197 11.4697L14.1894 7.99999L10.7197 4.53032L10.1894 3.99999L11.25 2.93933L11.7804 3.46966L15.6036 7.29289C15.9941 7.68341 15.9941 8.31658 15.6036 8.7071L11.7804 12.5303Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var PlayIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M13.4549 7.22745L13.3229 7.16146L2.5 1.74999L2.4583 1.72914L1.80902 1.4045L1.3618 1.18089C1.19558 1.09778 1 1.21865 1 1.4045L1 1.9045L1 2.63041L1 2.67704L1 13.3229L1 13.3696L1 14.0955L1 14.5955C1 14.7813 1.19558 14.9022 1.3618 14.8191L1.80902 14.5955L2.4583 14.2708L2.5 14.25L13.3229 8.83852L13.4549 8.77253L14.2546 8.37267L14.5528 8.2236C14.737 8.13147 14.737 7.86851 14.5528 7.77638L14.2546 7.62731L13.4549 7.22745ZM11.6459 7.99999L2.5 3.42704L2.5 12.5729L11.6459 7.99999Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var TerminalWindowIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M1.5 2.5H14.5V12.5C14.5 13.0523 14.0523 13.5 13.5 13.5H2.5C1.94772 13.5 1.5 13.0523 1.5 12.5V2.5ZM0 1H1.5H14.5H16V2.5V12.5C16 13.8807 14.8807 15 13.5 15H2.5C1.11929 15 0 13.8807 0 12.5V2.5V1ZM4 11.1339L4.44194 10.6919L6.51516 8.61872C6.85687 8.27701 6.85687 7.72299 6.51517 7.38128L4.44194 5.30806L4 4.86612L3.11612 5.75L3.55806 6.19194L5.36612 8L3.55806 9.80806L3.11612 10.25L4 11.1339ZM8 9.75494H8.6225H11.75H12.3725V10.9999H11.75H8.6225H8V9.75494Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var ClockRewind = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M7.96452 2.5C11.0257 2.5 13.5 4.96643 13.5 8C13.5 11.0336 11.0257 13.5 7.96452 13.5C6.12055 13.5 4.48831 12.6051 3.48161 11.2273L3.03915 10.6217L1.828 11.5066L2.27046 12.1122C3.54872 13.8617 5.62368 15 7.96452 15C11.8461 15 15 11.87 15 8C15 4.13001 11.8461 1 7.96452 1C5.06835 1 2.57851 2.74164 1.5 5.23347V3.75V3H0V3.75V7.25C0 7.66421 0.335786 8 0.75 8H3.75H4.5V6.5H3.75H2.63724C3.29365 4.19393 5.42843 2.5 7.96452 2.5ZM8.75 5.25V4.5H7.25V5.25V7.8662C7.25 8.20056 7.4171 8.51279 7.6953 8.69825L9.08397 9.62404L9.70801 10.0401L10.5401 8.79199L9.91603 8.37596L8.75 7.59861V5.25Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var LogsIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M9 2H9.75H14.25H15V3.5H14.25H9.75H9V2ZM9 12.5H9.75H14.25H15V14H14.25H9.75H9V12.5ZM9.75 7.25H9V8.75H9.75H14.25H15V7.25H14.25H9.75ZM1 12.5H1.75H2.25H3V14H2.25H1.75H1V12.5ZM1.75 2H1V3.5H1.75H2.25H3V2H2.25H1.75ZM1 7.25H1.75H2.25H3V8.75H2.25H1.75H1V7.25ZM5.75 12.5H5V14H5.75H6.25H7V12.5H6.25H5.75ZM5 2H5.75H6.25H7V3.5H6.25H5.75H5V2ZM5.75 7.25H5V8.75H5.75H6.25H7V7.25H6.25H5.75Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var ImageIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M14.5 2.5H1.5V9.18933L2.96966 7.71967L3.18933 7.5H3.49999H6.63001H6.93933L6.96966 7.46967L10.4697 3.96967L11.5303 3.96967L14.5 6.93934V2.5ZM8.00066 8.55999L9.53034 10.0897L10.0607 10.62L9.00001 11.6807L8.46968 11.1503L6.31935 9H3.81065L1.53032 11.2803L1.5 11.3106V12.5C1.5 13.0523 1.94772 13.5 2.5 13.5H13.5C14.0523 13.5 14.5 13.0523 14.5 12.5V9.06066L11 5.56066L8.03032 8.53033L8.00066 8.55999ZM4.05312e-06 10.8107V12.5C4.05312e-06 13.8807 1.11929 15 2.5 15H13.5C14.8807 15 16 13.8807 16 12.5V9.56066L16.5607 9L16.0303 8.46967L16 8.43934V2.5V1H14.5H1.5H4.05312e-06V2.5V10.6893L-0.0606689 10.75L4.05312e-06 10.8107Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};
var FullscreenIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M1 5.25V6H2.5V5.25V2.5H5.25H6V1H5.25H2C1.44772 1 1 1.44772 1 2V5.25ZM5.25 14.9994H6V13.4994H5.25H2.5V10.7494V9.99939H1V10.7494V13.9994C1 14.5517 1.44772 14.9994 2 14.9994H5.25ZM15 10V10.75V14C15 14.5523 14.5523 15 14 15H10.75H10V13.5H10.75H13.5V10.75V10H15ZM10.75 1H10V2.5H10.75H13.5V5.25V6H15V5.25V2C15 1.44772 14.5523 1 14 1H10.75Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var LineChartIcon = ({ size = 16 }) => /* @__PURE__ */ jsx13(
  "svg",
  {
    height: size,
    strokeLinejoin: "round",
    style: { color: "currentcolor" },
    viewBox: "0 0 16 16",
    width: size,
    children: /* @__PURE__ */ jsx13(
      "path",
      {
        clipRule: "evenodd",
        d: "M1 1v11.75A2.25 2.25 0 0 0 3.25 15H15v-1.5H3.25a.75.75 0 0 1-.75-.75V1H1Zm13.297 5.013.513-.547-1.094-1.026-.513.547-3.22 3.434-2.276-2.275a1 1 0 0 0-1.414 0L4.22 8.22l-.53.53 1.06 1.06.53-.53L7 7.56l2.287 2.287a1 1 0 0 0 1.437-.023l3.573-3.811Z",
        fill: "currentColor",
        fillRule: "evenodd"
      }
    )
  }
);
var WarningIcon = ({ size = 16 }) => {
  return /* @__PURE__ */ jsx13(
    "svg",
    {
      height: size,
      strokeLinejoin: "round",
      style: { color: "currentcolor" },
      viewBox: "0 0 16 16",
      width: size,
      children: /* @__PURE__ */ jsx13(
        "path",
        {
          clipRule: "evenodd",
          d: "M8.55846 0.5C9.13413 0.5 9.65902 0.829456 9.90929 1.34788L15.8073 13.5653C16.1279 14.2293 15.6441 15 14.9068 15H1.09316C0.355835 15 -0.127943 14.2293 0.192608 13.5653L6.09065 1.34787C6.34092 0.829454 6.86581 0.5 7.44148 0.5H8.55846ZM8.74997 4.75V5.5V8V8.75H7.24997V8V5.5V4.75H8.74997ZM7.99997 12C8.55226 12 8.99997 11.5523 8.99997 11C8.99997 10.4477 8.55226 10 7.99997 10C7.44769 10 6.99997 10.4477 6.99997 11C6.99997 11.5523 7.44769 12 7.99997 12Z",
          fill: "currentColor",
          fillRule: "evenodd"
        }
      )
    }
  );
};

// src/components/chatbot/sidebar-history-item.tsx
import Link from "next/link";
import { memo } from "react";

// src/hooks/use-chat-visibility.ts
import { useMemo as useMemo3 } from "react";
import useSWR, { useSWRConfig } from "swr";
import { unstable_serialize } from "swr/infinite";
function useChatVisibility({
  chatId,
  initialVisibilityType
}) {
  const { basePath } = useChatbotConfig();
  const { mutate, cache } = useSWRConfig();
  const history = cache.get(`${basePath}/history`)?.data;
  const { data: localVisibility, mutate: setLocalVisibility } = useSWR(
    `${chatId}-visibility`,
    null,
    {
      fallbackData: initialVisibilityType
    }
  );
  const visibilityType = useMemo3(() => {
    if (!history) {
      return localVisibility;
    }
    const chat2 = history.chats.find((currentChat) => currentChat.id === chatId);
    if (!chat2) {
      return "private";
    }
    return chat2.visibility;
  }, [history, chatId, localVisibility]);
  const setVisibilityType = (updatedVisibilityType) => {
    setLocalVisibility(updatedVisibilityType);
    mutate(
      unstable_serialize(
        (pageIndex, prev) => getChatHistoryPaginationKey(basePath, pageIndex, prev)
      )
    );
    fetch(`${basePath}/chat`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId, visibility: updatedVisibilityType })
    });
  };
  return { visibilityType, setVisibilityType };
}

// src/components/ui/dropdown-menu.tsx
import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { jsx as jsx14, jsxs as jsxs6 } from "react/jsx-runtime";
function DropdownMenu({
  ...props
}) {
  return /* @__PURE__ */ jsx14(DropdownMenuPrimitive.Root, { "data-slot": "dropdown-menu", ...props });
}
function DropdownMenuPortal({
  ...props
}) {
  return /* @__PURE__ */ jsx14(DropdownMenuPrimitive.Portal, { "data-slot": "dropdown-menu-portal", ...props });
}
function DropdownMenuTrigger({
  ...props
}) {
  return /* @__PURE__ */ jsx14(
    DropdownMenuPrimitive.Trigger,
    {
      "data-slot": "dropdown-menu-trigger",
      ...props
    }
  );
}
function DropdownMenuContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ jsx14(DropdownMenuPrimitive.Portal, { children: /* @__PURE__ */ jsx14(
    DropdownMenuPrimitive.Content,
    {
      align,
      className: cn(
        "z-50 max-h-(--radix-dropdown-menu-content-available-height) w-(--radix-dropdown-menu-trigger-width) min-w-48 origin-(--radix-dropdown-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:overflow-hidden dark:ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      ),
      "data-slot": "dropdown-menu-content",
      sideOffset,
      ...props
    }
  ) });
}
function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}) {
  return /* @__PURE__ */ jsx14(
    DropdownMenuPrimitive.Item,
    {
      className: cn(
        "group/dropdown-menu-item relative flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-sm outline-hidden select-none transition-colors duration-150 focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-9.5 data-[variant=destructive]:focus:bg-destructive/10 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      "data-inset": inset,
      "data-slot": "dropdown-menu-item",
      "data-variant": variant,
      ...props
    }
  );
}
function DropdownMenuSeparator({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx14(
    DropdownMenuPrimitive.Separator,
    {
      className: cn("-mx-1 my-1 h-px bg-border/50", className),
      "data-slot": "dropdown-menu-separator",
      ...props
    }
  );
}
function DropdownMenuSub({
  ...props
}) {
  return /* @__PURE__ */ jsx14(DropdownMenuPrimitive.Sub, { "data-slot": "dropdown-menu-sub", ...props });
}
function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}) {
  return /* @__PURE__ */ jsxs6(
    DropdownMenuPrimitive.SubTrigger,
    {
      className: cn(
        "flex cursor-default items-center gap-2 rounded-xl px-3 py-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-inset:pl-9.5 data-open:bg-accent data-open:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      ),
      "data-inset": inset,
      "data-slot": "dropdown-menu-sub-trigger",
      ...props,
      children: [
        children,
        /* @__PURE__ */ jsx14(ChevronRightIcon, { className: "ml-auto" })
      ]
    }
  );
}
function DropdownMenuSubContent({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx14(
    DropdownMenuPrimitive.SubContent,
    {
      className: cn(
        "z-50 min-w-36 origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-lg bg-popover p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className
      ),
      "data-slot": "dropdown-menu-sub-content",
      ...props
    }
  );
}

// src/components/chatbot/sidebar-history-item.tsx
import { jsx as jsx15, jsxs as jsxs7 } from "react/jsx-runtime";
var PureChatItem = ({
  chat: chat2,
  isActive,
  onDelete,
  setOpenMobile
}) => {
  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId: chat2.id,
    initialVisibilityType: chat2.visibility
  });
  return /* @__PURE__ */ jsxs7(SidebarMenuItem, { children: [
    /* @__PURE__ */ jsx15(
      SidebarMenuButton,
      {
        asChild: true,
        className: "h-8 rounded-none text-[13px] text-sidebar-foreground/50 transition-all duration-150 hover:bg-transparent hover:text-sidebar-foreground data-active:bg-transparent data-active:font-normal data-active:text-sidebar-foreground/50 data-[active=true]:text-sidebar-foreground data-[active=true]:font-medium data-[active=true]:border-b data-[active=true]:border-dashed data-[active=true]:border-sidebar-foreground/50",
        isActive,
        children: /* @__PURE__ */ jsx15(Link, { href: `/chat/${chat2.id}`, onClick: () => setOpenMobile(false), children: /* @__PURE__ */ jsx15("span", { className: "truncate", children: chat2.title }) })
      }
    ),
    /* @__PURE__ */ jsxs7(DropdownMenu, { modal: true, children: [
      /* @__PURE__ */ jsx15(DropdownMenuTrigger, { asChild: true, children: /* @__PURE__ */ jsxs7(
        SidebarMenuAction,
        {
          className: "mr-0.5 rounded-md text-sidebar-foreground/50 ring-0 transition-colors duration-150 focus-visible:ring-0 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
          showOnHover: !isActive,
          children: [
            /* @__PURE__ */ jsx15(MoreHorizontalIcon, {}),
            /* @__PURE__ */ jsx15("span", { className: "sr-only", children: "More" })
          ]
        }
      ) }),
      /* @__PURE__ */ jsxs7(DropdownMenuContent, { align: "end", side: "bottom", children: [
        /* @__PURE__ */ jsxs7(DropdownMenuSub, { children: [
          /* @__PURE__ */ jsxs7(DropdownMenuSubTrigger, { className: "cursor-pointer", children: [
            /* @__PURE__ */ jsx15(ShareIcon, {}),
            /* @__PURE__ */ jsx15("span", { children: "Share" })
          ] }),
          /* @__PURE__ */ jsx15(DropdownMenuPortal, { children: /* @__PURE__ */ jsxs7(DropdownMenuSubContent, { children: [
            /* @__PURE__ */ jsxs7(
              DropdownMenuItem,
              {
                className: "cursor-pointer flex-row justify-between",
                onClick: () => {
                  setVisibilityType("private");
                },
                children: [
                  /* @__PURE__ */ jsxs7("div", { className: "flex flex-row items-center gap-2", children: [
                    /* @__PURE__ */ jsx15(LockIcon, { size: 12 }),
                    /* @__PURE__ */ jsx15("span", { children: "Private" })
                  ] }),
                  visibilityType === "private" ? /* @__PURE__ */ jsx15(CheckCircleFillIcon, {}) : null
                ]
              }
            ),
            /* @__PURE__ */ jsxs7(
              DropdownMenuItem,
              {
                className: "cursor-pointer flex-row justify-between",
                onClick: () => {
                  setVisibilityType("public");
                },
                children: [
                  /* @__PURE__ */ jsxs7("div", { className: "flex flex-row items-center gap-2", children: [
                    /* @__PURE__ */ jsx15(GlobeIcon, {}),
                    /* @__PURE__ */ jsx15("span", { children: "Public" })
                  ] }),
                  visibilityType === "public" ? /* @__PURE__ */ jsx15(CheckCircleFillIcon, {}) : null
                ]
              }
            )
          ] }) })
        ] }),
        /* @__PURE__ */ jsxs7(
          DropdownMenuItem,
          {
            onSelect: () => onDelete(chat2.id),
            variant: "destructive",
            children: [
              /* @__PURE__ */ jsx15(TrashIcon, {}),
              /* @__PURE__ */ jsx15("span", { children: "Delete" })
            ]
          }
        )
      ] })
    ] })
  ] });
};
var ChatItem = memo(PureChatItem, (prevProps, nextProps) => {
  if (prevProps.isActive !== nextProps.isActive) {
    return false;
  }
  return true;
});

// src/components/chatbot/sidebar-history.tsx
import { Fragment, jsx as jsx16, jsxs as jsxs8 } from "react/jsx-runtime";
var PAGE_SIZE = 20;
var groupChatsByDate = (chats) => {
  const now = /* @__PURE__ */ new Date();
  const oneWeekAgo = subWeeks(now, 1);
  const oneMonthAgo = subMonths(now, 1);
  return chats.reduce(
    (groups, chat2) => {
      const chatDate = new Date(chat2.createdAt);
      if (isToday(chatDate)) {
        groups.today.push(chat2);
      } else if (isYesterday(chatDate)) {
        groups.yesterday.push(chat2);
      } else if (chatDate > oneWeekAgo) {
        groups.lastWeek.push(chat2);
      } else if (chatDate > oneMonthAgo) {
        groups.lastMonth.push(chat2);
      } else {
        groups.older.push(chat2);
      }
      return groups;
    },
    {
      today: [],
      yesterday: [],
      lastWeek: [],
      lastMonth: [],
      older: []
    }
  );
};
function getChatHistoryPaginationKey(basePath, pageIndex, previousPageData) {
  if (previousPageData && previousPageData.hasMore === false) {
    return null;
  }
  if (pageIndex === 0) {
    return `${basePath}/history?limit=${PAGE_SIZE}`;
  }
  const firstChatFromPage = previousPageData.chats.at(-1);
  if (!firstChatFromPage) {
    return null;
  }
  return `${basePath}/history?ending_before=${firstChatFromPage.id}&limit=${PAGE_SIZE}`;
}
function SidebarHistory({ user: user2 }) {
  const { basePath } = useChatbotConfig();
  const { setOpenMobile } = useSidebar();
  const pathname = usePathname();
  const id = pathname?.startsWith("/chat/") ? pathname.split("/")[2] : null;
  const {
    data: paginatedChatHistories,
    setSize,
    isValidating,
    isLoading,
    mutate
  } = useSWRInfinite(
    user2 ? (pageIndex, prev) => getChatHistoryPaginationKey(basePath, pageIndex, prev) : () => null,
    fetcher,
    { fallbackData: [], revalidateOnFocus: false }
  );
  const router = useRouter();
  const [deleteId, setDeleteId] = useState4(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState4(false);
  const hasReachedEnd = paginatedChatHistories ? paginatedChatHistories.some((page) => page.hasMore === false) : false;
  const hasEmptyChatHistory = paginatedChatHistories ? paginatedChatHistories.every((page) => page.chats.length === 0) : false;
  const handleDelete = () => {
    const chatToDelete = deleteId;
    const isCurrentChat = pathname === `/chat/${chatToDelete}`;
    setShowDeleteDialog(false);
    if (isCurrentChat) {
      router.replace("/");
    }
    mutate((chatHistories) => {
      if (chatHistories) {
        return chatHistories.map((chatHistory) => ({
          ...chatHistory,
          chats: chatHistory.chats.filter((chat2) => chat2.id !== chatToDelete)
        }));
      }
    });
    fetch(`${basePath}/chat?id=${chatToDelete}`, { method: "DELETE" });
    toast.success("Chat deleted");
  };
  if (!user2) {
    return /* @__PURE__ */ jsx16(SidebarGroup, { className: "group-data-[collapsible=icon]:hidden", children: /* @__PURE__ */ jsx16(SidebarGroupContent, { children: /* @__PURE__ */ jsx16("div", { className: "flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60", children: "Login to save and revisit previous chats!" }) }) });
  }
  if (isLoading) {
    return /* @__PURE__ */ jsxs8(SidebarGroup, { className: "group-data-[collapsible=icon]:hidden", children: [
      /* @__PURE__ */ jsx16(SidebarGroupLabel, { className: "text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70", children: "History" }),
      /* @__PURE__ */ jsx16(SidebarGroupContent, { children: /* @__PURE__ */ jsx16("div", { className: "flex flex-col gap-0.5 px-1", children: [44, 32, 28, 64, 52].map((item) => /* @__PURE__ */ jsx16(
        "div",
        {
          className: "flex h-8 items-center gap-2 rounded-lg px-2",
          children: /* @__PURE__ */ jsx16(
            "div",
            {
              className: "h-3 max-w-(--skeleton-width) flex-1 animate-pulse rounded-md bg-sidebar-foreground/[0.06]",
              style: {
                "--skeleton-width": `${item}%`
              }
            }
          )
        },
        item
      )) }) })
    ] });
  }
  if (hasEmptyChatHistory) {
    return /* @__PURE__ */ jsxs8(SidebarGroup, { className: "group-data-[collapsible=icon]:hidden", children: [
      /* @__PURE__ */ jsx16(SidebarGroupLabel, { className: "text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70", children: "History" }),
      /* @__PURE__ */ jsx16(SidebarGroupContent, { children: /* @__PURE__ */ jsx16("div", { className: "flex w-full flex-row items-center justify-center gap-2 px-2 text-[13px] text-sidebar-foreground/60", children: "Your conversations will appear here once you start chatting!" }) })
    ] });
  }
  return /* @__PURE__ */ jsxs8(Fragment, { children: [
    /* @__PURE__ */ jsxs8(SidebarGroup, { className: "group-data-[collapsible=icon]:hidden", children: [
      /* @__PURE__ */ jsx16(SidebarGroupLabel, { className: "text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70", children: "History" }),
      /* @__PURE__ */ jsxs8(SidebarGroupContent, { children: [
        /* @__PURE__ */ jsx16(SidebarMenu, { children: paginatedChatHistories && (() => {
          const chatsFromHistory = paginatedChatHistories.flatMap(
            (paginatedChatHistory) => paginatedChatHistory.chats
          );
          const groupedChats = groupChatsByDate(chatsFromHistory);
          return /* @__PURE__ */ jsxs8("div", { className: "flex flex-col gap-4", children: [
            groupedChats.today.length > 0 && /* @__PURE__ */ jsxs8("div", { children: [
              /* @__PURE__ */ jsx16("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70", children: "Today" }),
              groupedChats.today.map((chat2) => /* @__PURE__ */ jsx16(
                ChatItem,
                {
                  chat: chat2,
                  isActive: chat2.id === id,
                  onDelete: (chatId) => {
                    setDeleteId(chatId);
                    setShowDeleteDialog(true);
                  },
                  setOpenMobile
                },
                chat2.id
              ))
            ] }),
            groupedChats.yesterday.length > 0 && /* @__PURE__ */ jsxs8("div", { children: [
              /* @__PURE__ */ jsx16("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70", children: "Yesterday" }),
              groupedChats.yesterday.map((chat2) => /* @__PURE__ */ jsx16(
                ChatItem,
                {
                  chat: chat2,
                  isActive: chat2.id === id,
                  onDelete: (chatId) => {
                    setDeleteId(chatId);
                    setShowDeleteDialog(true);
                  },
                  setOpenMobile
                },
                chat2.id
              ))
            ] }),
            groupedChats.lastWeek.length > 0 && /* @__PURE__ */ jsxs8("div", { children: [
              /* @__PURE__ */ jsx16("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70", children: "Last 7 days" }),
              groupedChats.lastWeek.map((chat2) => /* @__PURE__ */ jsx16(
                ChatItem,
                {
                  chat: chat2,
                  isActive: chat2.id === id,
                  onDelete: (chatId) => {
                    setDeleteId(chatId);
                    setShowDeleteDialog(true);
                  },
                  setOpenMobile
                },
                chat2.id
              ))
            ] }),
            groupedChats.lastMonth.length > 0 && /* @__PURE__ */ jsxs8("div", { children: [
              /* @__PURE__ */ jsx16("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70", children: "Last 30 days" }),
              groupedChats.lastMonth.map((chat2) => /* @__PURE__ */ jsx16(
                ChatItem,
                {
                  chat: chat2,
                  isActive: chat2.id === id,
                  onDelete: (chatId) => {
                    setDeleteId(chatId);
                    setShowDeleteDialog(true);
                  },
                  setOpenMobile
                },
                chat2.id
              ))
            ] }),
            groupedChats.older.length > 0 && /* @__PURE__ */ jsxs8("div", { children: [
              /* @__PURE__ */ jsx16("div", { className: "px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/70", children: "Older" }),
              groupedChats.older.map((chat2) => /* @__PURE__ */ jsx16(
                ChatItem,
                {
                  chat: chat2,
                  isActive: chat2.id === id,
                  onDelete: (chatId) => {
                    setDeleteId(chatId);
                    setShowDeleteDialog(true);
                  },
                  setOpenMobile
                },
                chat2.id
              ))
            ] })
          ] });
        })() }),
        /* @__PURE__ */ jsx16(
          motion.div,
          {
            onViewportEnter: () => {
              if (!isValidating && !hasReachedEnd) {
                setSize((size) => size + 1);
              }
            }
          }
        ),
        hasReachedEnd ? null : /* @__PURE__ */ jsxs8("div", { className: "mt-1 flex flex-row items-center gap-2 px-4 py-2 text-sidebar-foreground/50", children: [
          /* @__PURE__ */ jsx16("div", { className: "animate-spin", children: /* @__PURE__ */ jsx16(LoaderIcon, {}) }),
          /* @__PURE__ */ jsx16("div", { className: "text-[11px]", children: "Loading..." })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsx16(AlertDialog, { onOpenChange: setShowDeleteDialog, open: showDeleteDialog, children: /* @__PURE__ */ jsxs8(AlertDialogContent, { children: [
      /* @__PURE__ */ jsxs8(AlertDialogHeader, { children: [
        /* @__PURE__ */ jsx16(AlertDialogTitle, { children: "Are you absolutely sure?" }),
        /* @__PURE__ */ jsx16(AlertDialogDescription, { children: "This action cannot be undone. This will permanently delete your chat and remove it from our servers." })
      ] }),
      /* @__PURE__ */ jsxs8(AlertDialogFooter, { children: [
        /* @__PURE__ */ jsx16(AlertDialogCancel, { children: "Cancel" }),
        /* @__PURE__ */ jsx16(AlertDialogAction, { onClick: handleDelete, children: "Continue" })
      ] })
    ] }) })
  ] });
}

// src/components/chatbot/toast.tsx
import { useEffect as useEffect3, useRef, useState as useState5 } from "react";
import { toast as sonnerToast } from "sonner";
import { jsx as jsx17, jsxs as jsxs9 } from "react/jsx-runtime";
var iconsByType = {
  success: /* @__PURE__ */ jsx17(CheckCircleFillIcon, {}),
  error: /* @__PURE__ */ jsx17(WarningIcon, {})
};
function toast2(props) {
  return sonnerToast.custom((id) => /* @__PURE__ */ jsx17(Toast, { description: props.description, id, type: props.type }));
}
function Toast(props) {
  const { id, type, description } = props;
  const descriptionRef = useRef(null);
  const [multiLine, setMultiLine] = useState5(false);
  useEffect3(() => {
    const el = descriptionRef.current;
    if (!el) {
      return;
    }
    const update = () => {
      const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight);
      const lines = Math.round(el.scrollHeight / lineHeight);
      setMultiLine(lines > 1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return /* @__PURE__ */ jsx17("div", { className: "flex toast-mobile:w-[356px] w-full justify-center", children: /* @__PURE__ */ jsxs9(
    "div",
    {
      className: cn(
        "flex toast-mobile:w-fit w-full flex-row gap-3 rounded-lg bg-card border border-border/50 shadow-[var(--shadow-float)] p-3",
        multiLine ? "items-start" : "items-center"
      ),
      "data-testid": "toast",
      children: [
        /* @__PURE__ */ jsx17(
          "div",
          {
            className: cn(
              "data-[type=error]:text-red-600 data-[type=success]:text-green-600",
              { "pt-1": multiLine }
            ),
            "data-type": type,
            children: iconsByType[type]
          }
        ),
        /* @__PURE__ */ jsx17("div", { className: "text-sm text-foreground", ref: descriptionRef, children: description })
      ]
    },
    id
  ) });
}

// src/hooks/use-auto-resume.ts
import { useEffect as useEffect4 } from "react";
function useAutoResume({
  autoResume,
  initialMessages,
  resumeStream,
  setMessages
}) {
  const { dataStream } = useDataStream();
  useEffect4(() => {
    if (!autoResume) {
      return;
    }
    const mostRecentMessage = initialMessages.at(-1);
    if (mostRecentMessage?.role === "user") {
      resumeStream();
    }
  }, [autoResume, initialMessages.at, resumeStream]);
  useEffect4(() => {
    if (!dataStream) {
      return;
    }
    if (dataStream.length === 0) {
      return;
    }
    const dataPart = dataStream[0];
    if (dataPart.type === "data-appendMessage") {
      const message2 = JSON.parse(dataPart.data);
      setMessages([...initialMessages, message2]);
    }
  }, [dataStream, initialMessages, setMessages]);
}

// lib/ai/models.ts
var DEFAULT_CHAT_MODEL = "moonshotai/kimi-k2.5";
var chatModels = [];
var allowedModelIds = new Set(chatModels.map((m) => m.id));
var modelsByProvider = chatModels.reduce(
  (acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  },
  {}
);

// src/hooks/use-active-chat.tsx
import { jsx as jsx18 } from "react/jsx-runtime";
var ActiveChatContext = createContext4(null);
function extractChatId(pathname) {
  const match = pathname.match(/\/chat\/([^/]+)/);
  return match ? match[1] : null;
}
function ActiveChatProvider({ children }) {
  const { basePath } = useChatbotConfig();
  const pathname = usePathname2();
  const { setDataStream } = useDataStream();
  const { mutate } = useSWRConfig2();
  const chatIdFromUrl = extractChatId(pathname);
  const isNewChat = !chatIdFromUrl;
  const newChatIdRef = useRef2(generateUUID());
  const prevPathnameRef = useRef2(pathname);
  if (isNewChat && prevPathnameRef.current !== pathname) {
    newChatIdRef.current = generateUUID();
  }
  prevPathnameRef.current = pathname;
  const chatId = chatIdFromUrl ?? newChatIdRef.current;
  const [currentModelId, setCurrentModelId] = useState6(DEFAULT_CHAT_MODEL);
  const currentModelIdRef = useRef2(currentModelId);
  useEffect5(() => {
    currentModelIdRef.current = currentModelId;
  }, [currentModelId]);
  const [input, setInput] = useState6("");
  const [showCreditCardAlert, setShowCreditCardAlert] = useState6(false);
  const { data: chatData, isLoading } = useSWR2(
    isNewChat ? null : `${basePath}/messages?chatId=${chatId}`,
    fetcher,
    { revalidateOnFocus: false }
  );
  const initialMessages = isNewChat ? [] : chatData?.messages ?? [];
  const visibility = isNewChat ? "private" : chatData?.visibility ?? "private";
  const {
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    resumeStream,
    addToolApprovalResponse
  } = useChat({
    id: chatId,
    messages: initialMessages,
    generateId: generateUUID,
    sendAutomaticallyWhen: ({ messages: currentMessages }) => {
      const lastMessage = currentMessages.at(-1);
      return lastMessage?.parts?.some(
        (part) => "state" in part && part.state === "approval-responded" && "approval" in part && part.approval?.approved === true
      ) ?? false;
    },
    transport: new DefaultChatTransport({
      api: `${basePath}/chat`,
      fetch: fetchWithErrorHandlers,
      prepareSendMessagesRequest(request) {
        const lastMessage = request.messages.at(-1);
        const isToolApprovalContinuation = lastMessage?.role !== "user" || request.messages.some(
          (msg) => msg.parts?.some((part) => {
            const state = part.state;
            return state === "approval-responded" || state === "output-denied";
          })
        );
        return {
          body: {
            id: request.id,
            ...isToolApprovalContinuation ? { messages: request.messages } : { message: lastMessage },
            selectedChatModel: currentModelIdRef.current,
            selectedVisibilityType: visibility,
            ...request.body
          }
        };
      }
    }),
    onData: (dataPart) => {
      setDataStream((ds) => ds ? [...ds, dataPart] : []);
    },
    onFinish: () => {
      mutate(
        unstable_serialize2(
          (pageIndex, prev) => getChatHistoryPaginationKey(basePath, pageIndex, prev)
        )
      );
    },
    onError: (error) => {
      if (error.message?.includes("AI Gateway requires a valid credit card")) {
        setShowCreditCardAlert(true);
      } else if (error instanceof ChatbotError) {
        toast2({ type: "error", description: error.message });
      } else {
        toast2({
          type: "error",
          description: error.message || "Oops, an error occurred!"
        });
      }
    }
  });
  const loadedChatIds = useRef2(/* @__PURE__ */ new Set());
  if (isNewChat && !loadedChatIds.current.has(newChatIdRef.current)) {
    loadedChatIds.current.add(newChatIdRef.current);
  }
  useEffect5(() => {
    if (loadedChatIds.current.has(chatId)) {
      return;
    }
    if (chatData?.messages) {
      loadedChatIds.current.add(chatId);
      setMessages(chatData.messages);
    }
  }, [chatId, chatData?.messages, setMessages]);
  const prevChatIdRef = useRef2(chatId);
  useEffect5(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      if (isNewChat) {
        setMessages([]);
      }
    }
  }, [chatId, isNewChat, setMessages]);
  useEffect5(() => {
    if (chatData && !isNewChat) {
      const cookieModel = document.cookie.split("; ").find((row) => row.startsWith("chat-model="))?.split("=")[1];
      if (cookieModel) {
        setCurrentModelId(decodeURIComponent(cookieModel));
      }
    }
  }, [chatData, isNewChat]);
  const hasAppendedQueryRef = useRef2(false);
  useEffect5(() => {
    const params = new URLSearchParams(window.location.search);
    const query = params.get("query");
    if (query && !hasAppendedQueryRef.current) {
      hasAppendedQueryRef.current = true;
      window.history.replaceState({}, "", `/chat/${chatId}`);
      sendMessage({
        role: "user",
        parts: [{ type: "text", text: query }]
      });
    }
  }, [sendMessage, chatId]);
  useAutoResume({
    autoResume: !isNewChat && !!chatData,
    initialMessages,
    resumeStream,
    setMessages
  });
  const isReadonly = isNewChat ? false : chatData?.isReadonly ?? false;
  const { data: votes } = useSWR2(
    !isReadonly && messages.length >= 2 ? `${basePath}/vote?chatId=${chatId}` : null,
    fetcher,
    { revalidateOnFocus: false }
  );
  const value = useMemo4(
    () => ({
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      setInput,
      visibilityType: visibility,
      isReadonly,
      isLoading: !isNewChat && isLoading,
      votes,
      currentModelId,
      setCurrentModelId,
      showCreditCardAlert,
      setShowCreditCardAlert
    }),
    [
      chatId,
      messages,
      setMessages,
      sendMessage,
      status,
      stop,
      regenerate,
      addToolApprovalResponse,
      input,
      visibility,
      isReadonly,
      isNewChat,
      isLoading,
      votes,
      currentModelId,
      showCreditCardAlert
    ]
  );
  return /* @__PURE__ */ jsx18(ActiveChatContext.Provider, { value, children });
}
function useActiveChat() {
  const context = useContext4(ActiveChatContext);
  if (!context) {
    throw new Error("useActiveChat must be used within ActiveChatProvider");
  }
  return context;
}

// src/components/chatbot/app-sidebar.tsx
import {
  MessageSquareIcon,
  PanelLeftIcon as PanelLeftIcon2,
  PenSquareIcon,
  TrashIcon as TrashIcon2
} from "lucide-react";
import Link2 from "next/link";
import { useRouter as useRouter3 } from "next/navigation";
import { useState as useState7 } from "react";
import { toast as toast3 } from "sonner";
import { useSWRConfig as useSWRConfig3 } from "swr";
import { unstable_serialize as unstable_serialize3 } from "swr/infinite";

// src/components/chatbot/sidebar-user-nav.tsx
import { ChevronUp } from "lucide-react";
import { useRouter as useRouter2 } from "next/navigation";
import { useTheme } from "next-themes";
import { jsx as jsx19, jsxs as jsxs10 } from "react/jsx-runtime";
function emailToHue(email) {
  let hash = 0;
  for (const char of email) {
    hash = char.charCodeAt(0) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}
function SidebarUserNav({
  user: user2,
  onSignOut
}) {
  const router = useRouter2();
  const { setTheme, resolvedTheme } = useTheme();
  return /* @__PURE__ */ jsx19(SidebarMenu, { children: /* @__PURE__ */ jsx19(SidebarMenuItem, { children: /* @__PURE__ */ jsxs10(DropdownMenu, { children: [
    /* @__PURE__ */ jsx19(DropdownMenuTrigger, { asChild: true, children: /* @__PURE__ */ jsxs10(
      SidebarMenuButton,
      {
        className: "h-8 px-2 rounded-lg bg-transparent text-sidebar-foreground/70 transition-colors duration-150 hover:text-sidebar-foreground data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground",
        "data-testid": "user-nav-button",
        children: [
          /* @__PURE__ */ jsx19(
            "div",
            {
              className: "size-5 shrink-0 rounded-full ring-1 ring-sidebar-border/50",
              style: {
                background: `linear-gradient(135deg, oklch(0.35 0.08 ${emailToHue(user2.email ?? "")}), oklch(0.25 0.05 ${emailToHue(user2.email ?? "") + 40}))`
              }
            }
          ),
          /* @__PURE__ */ jsx19("span", { className: "truncate text-[13px]", "data-testid": "user-email", children: user2.isGuest ? "Guest" : user2.email }),
          /* @__PURE__ */ jsx19(ChevronUp, { className: "ml-auto size-3.5 text-sidebar-foreground/50" })
        ]
      }
    ) }),
    /* @__PURE__ */ jsxs10(
      DropdownMenuContent,
      {
        className: "w-(--radix-popper-anchor-width) rounded-lg border border-border/60 bg-card/95 backdrop-blur-xl shadow-[var(--shadow-float)]",
        "data-testid": "user-nav-menu",
        side: "top",
        children: [
          /* @__PURE__ */ jsx19(
            DropdownMenuItem,
            {
              className: "cursor-pointer text-[13px]",
              "data-testid": "user-nav-item-theme",
              onSelect: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
              children: `Toggle ${resolvedTheme === "light" ? "dark" : "light"} mode`
            }
          ),
          /* @__PURE__ */ jsx19(DropdownMenuSeparator, {}),
          /* @__PURE__ */ jsx19(DropdownMenuItem, { asChild: true, "data-testid": "user-nav-item-auth", children: /* @__PURE__ */ jsx19(
            "button",
            {
              className: "w-full cursor-pointer text-[13px]",
              onClick: () => {
                if (user2.isGuest) {
                  router.push("/login");
                } else if (onSignOut) {
                  onSignOut();
                }
              },
              type: "button",
              children: user2.isGuest ? "Login to your account" : "Sign out"
            }
          ) })
        ]
      }
    )
  ] }) }) });
}

// src/components/chatbot/app-sidebar.tsx
import { Fragment as Fragment2, jsx as jsx20, jsxs as jsxs11 } from "react/jsx-runtime";
function AppSidebar({
  user: user2,
  onSignOut
}) {
  const { basePath } = useChatbotConfig();
  const router = useRouter3();
  const { setOpenMobile, toggleSidebar } = useSidebar();
  const { mutate } = useSWRConfig3();
  const [showDeleteAllDialog, setShowDeleteAllDialog] = useState7(false);
  const handleDeleteAll = () => {
    setShowDeleteAllDialog(false);
    router.replace("/");
    mutate(
      unstable_serialize3(
        (pageIndex, prev) => getChatHistoryPaginationKey(basePath, pageIndex, prev)
      ),
      [],
      {
        revalidate: false
      }
    );
    fetch(`${basePath}/history`, {
      method: "DELETE"
    });
    toast3.success("All chats deleted");
  };
  return /* @__PURE__ */ jsxs11(Fragment2, { children: [
    /* @__PURE__ */ jsxs11(Sidebar, { collapsible: "icon", children: [
      /* @__PURE__ */ jsx20(SidebarHeader, { className: "pb-0 pt-3", children: /* @__PURE__ */ jsx20(SidebarMenu, { children: /* @__PURE__ */ jsxs11(SidebarMenuItem, { className: "flex flex-row items-center justify-between", children: [
        /* @__PURE__ */ jsxs11("div", { className: "group/logo relative flex items-center justify-center", children: [
          /* @__PURE__ */ jsx20(
            SidebarMenuButton,
            {
              asChild: true,
              className: "size-8 !px-0 items-center justify-center group-data-[collapsible=icon]:group-hover/logo:opacity-0",
              tooltip: "Chatbot",
              children: /* @__PURE__ */ jsx20(Link2, { href: "/", onClick: () => setOpenMobile(false), children: /* @__PURE__ */ jsx20(MessageSquareIcon, { className: "size-4 text-sidebar-foreground/50" }) })
            }
          ),
          /* @__PURE__ */ jsxs11(Tooltip, { children: [
            /* @__PURE__ */ jsx20(TooltipTrigger, { asChild: true, children: /* @__PURE__ */ jsx20(
              SidebarMenuButton,
              {
                className: "pointer-events-none absolute inset-0 size-8 opacity-0 group-data-[collapsible=icon]:pointer-events-auto group-data-[collapsible=icon]:group-hover/logo:opacity-100",
                onClick: () => toggleSidebar(),
                children: /* @__PURE__ */ jsx20(PanelLeftIcon2, { className: "size-4" })
              }
            ) }),
            /* @__PURE__ */ jsx20(TooltipContent, { className: "hidden md:block", side: "right", children: "Open sidebar" })
          ] })
        ] }),
        /* @__PURE__ */ jsx20("div", { className: "group-data-[collapsible=icon]:hidden", children: /* @__PURE__ */ jsx20(SidebarTrigger, { className: "text-sidebar-foreground/60 transition-colors duration-150 hover:text-sidebar-foreground" }) })
      ] }) }) }),
      /* @__PURE__ */ jsxs11(SidebarContent, { children: [
        /* @__PURE__ */ jsx20(SidebarGroup, { className: "pt-1", children: /* @__PURE__ */ jsx20(SidebarGroupContent, { children: /* @__PURE__ */ jsxs11(SidebarMenu, { children: [
          /* @__PURE__ */ jsx20(SidebarMenuItem, { children: /* @__PURE__ */ jsxs11(
            SidebarMenuButton,
            {
              className: "h-8 rounded-lg border border-sidebar-border text-[13px] text-sidebar-foreground/70 transition-colors duration-150 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
              onClick: () => {
                setOpenMobile(false);
                router.push("/");
              },
              tooltip: "New Chat",
              children: [
                /* @__PURE__ */ jsx20(PenSquareIcon, { className: "size-4" }),
                /* @__PURE__ */ jsx20("span", { className: "font-medium", children: "New chat" })
              ]
            }
          ) }),
          user2 && /* @__PURE__ */ jsx20(SidebarMenuItem, { children: /* @__PURE__ */ jsxs11(
            SidebarMenuButton,
            {
              className: "rounded-lg text-sidebar-foreground/40 transition-colors duration-150 hover:bg-destructive/10 hover:text-destructive",
              onClick: () => setShowDeleteAllDialog(true),
              tooltip: "Delete All Chats",
              children: [
                /* @__PURE__ */ jsx20(TrashIcon2, { className: "size-4" }),
                /* @__PURE__ */ jsx20("span", { className: "text-[13px]", children: "Delete all" })
              ]
            }
          ) })
        ] }) }) }),
        /* @__PURE__ */ jsx20(SidebarHistory, { user: user2 })
      ] }),
      /* @__PURE__ */ jsx20(SidebarFooter, { className: "border-t border-sidebar-border pt-2 pb-3", children: user2 && /* @__PURE__ */ jsx20(SidebarUserNav, { onSignOut, user: user2 }) }),
      /* @__PURE__ */ jsx20(SidebarRail, {})
    ] }),
    /* @__PURE__ */ jsx20(
      AlertDialog,
      {
        onOpenChange: setShowDeleteAllDialog,
        open: showDeleteAllDialog,
        children: /* @__PURE__ */ jsxs11(AlertDialogContent, { children: [
          /* @__PURE__ */ jsxs11(AlertDialogHeader, { children: [
            /* @__PURE__ */ jsx20(AlertDialogTitle, { children: "Delete all chats?" }),
            /* @__PURE__ */ jsx20(AlertDialogDescription, { children: "This action cannot be undone. This will permanently delete all your chats and remove them from our servers." })
          ] }),
          /* @__PURE__ */ jsxs11(AlertDialogFooter, { children: [
            /* @__PURE__ */ jsx20(AlertDialogCancel, { children: "Cancel" }),
            /* @__PURE__ */ jsx20(AlertDialogAction, { onClick: handleDeleteAll, children: "Delete All" })
          ] })
        ] })
      }
    )
  ] });
}

// src/components/chatbot/shell.tsx
import { useEffect as useEffect26, useRef as useRef17, useState as useState25 } from "react";

// src/hooks/use-artifact.ts
import { useCallback as useCallback2, useMemo as useMemo5 } from "react";
import useSWR3 from "swr";
var initialArtifactData = {
  documentId: "init",
  content: "",
  kind: "text",
  title: "",
  status: "idle",
  isVisible: false,
  boundingBox: {
    top: 0,
    left: 0,
    width: 0,
    height: 0
  }
};
function useArtifactSelector(selector) {
  const { data: localArtifact } = useSWR3("artifact", null, {
    fallbackData: initialArtifactData
  });
  const selectedValue = useMemo5(() => {
    if (!localArtifact) {
      return selector(initialArtifactData);
    }
    return selector(localArtifact);
  }, [localArtifact, selector]);
  return selectedValue;
}
function useArtifact() {
  const { data: localArtifact, mutate: setLocalArtifact } = useSWR3(
    "artifact",
    null,
    {
      fallbackData: initialArtifactData
    }
  );
  const artifact = useMemo5(() => {
    if (!localArtifact) {
      return initialArtifactData;
    }
    return localArtifact;
  }, [localArtifact]);
  const setArtifact = useCallback2(
    (updaterFn) => {
      setLocalArtifact((currentArtifact) => {
        const artifactToUpdate = currentArtifact || initialArtifactData;
        if (typeof updaterFn === "function") {
          return updaterFn(artifactToUpdate);
        }
        return updaterFn;
      });
    },
    [setLocalArtifact]
  );
  const { data: localArtifactMetadata, mutate: setLocalArtifactMetadata } = useSWR3(
    () => artifact.documentId ? `artifact-metadata-${artifact.documentId}` : null,
    null,
    {
      fallbackData: null
    }
  );
  return useMemo5(
    () => ({
      artifact,
      setArtifact,
      metadata: localArtifactMetadata,
      setMetadata: setLocalArtifactMetadata
    }),
    [artifact, setArtifact, localArtifactMetadata, setLocalArtifactMetadata]
  );
}

// src/components/chatbot/artifact.tsx
import { formatDistance } from "date-fns";
import equal from "fast-deep-equal";
import { AnimatePresence as AnimatePresence2, motion as motion5 } from "framer-motion";
import {
  memo as memo9,
  useCallback as useCallback6,
  useEffect as useEffect13,
  useRef as useRef8,
  useState as useState15
} from "react";
import useSWR4, { useSWRConfig as useSWRConfig5 } from "swr";
import { useWindowSize } from "usehooks-ts";

// src/artifacts/code/client.tsx
import { toast as toast4 } from "sonner";

// src/components/chatbot/code-editor.tsx
import { python } from "@codemirror/lang-python";
import { EditorState, Transaction } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { memo as memo2, useEffect as useEffect6, useRef as useRef3 } from "react";
import { jsx as jsx21 } from "react/jsx-runtime";
function PureCodeEditor({ content, onSaveContent, status }) {
  const containerRef = useRef3(null);
  const editorRef = useRef3(null);
  const userScrolledRef = useRef3(false);
  useEffect6(() => {
    if (containerRef.current && !editorRef.current) {
      const startState = EditorState.create({
        doc: content,
        extensions: [basicSetup, python(), oneDark]
      });
      editorRef.current = new EditorView({
        state: startState,
        parent: containerRef.current
      });
    }
    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
  }, [content]);
  useEffect6(() => {
    if (editorRef.current) {
      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const transaction = update.transactions.find(
            (tr) => !tr.annotation(Transaction.remote)
          );
          if (transaction) {
            const newContent = update.state.doc.toString();
            onSaveContent(newContent, true);
          }
        }
      });
      const scrollListener = EditorView.domEventHandlers({
        scroll() {
          if (status !== "streaming") {
            return;
          }
          const dom = editorRef.current?.scrollDOM;
          if (!dom) {
            return;
          }
          const atBottom = dom.scrollHeight - dom.scrollTop - dom.clientHeight < 40;
          userScrolledRef.current = !atBottom;
        }
      });
      const currentSelection = editorRef.current.state.selection;
      const newState = EditorState.create({
        doc: editorRef.current.state.doc,
        extensions: [
          basicSetup,
          python(),
          oneDark,
          updateListener,
          scrollListener
        ],
        selection: currentSelection
      });
      editorRef.current.setState(newState);
    }
  }, [onSaveContent, status]);
  useEffect6(() => {
    if (status !== "streaming") {
      userScrolledRef.current = false;
    }
  }, [status]);
  useEffect6(() => {
    if (editorRef.current && content) {
      const currentContent = editorRef.current.state.doc.toString();
      if (status === "streaming" || currentContent !== content) {
        const transaction = editorRef.current.state.update({
          changes: {
            from: 0,
            to: currentContent.length,
            insert: content
          },
          annotations: [Transaction.remote.of(true)]
        });
        editorRef.current.dispatch(transaction);
        if (status === "streaming" && !userScrolledRef.current) {
          requestAnimationFrame(() => {
            const dom = editorRef.current?.scrollDOM;
            if (dom) {
              dom.scrollTo({ top: dom.scrollHeight });
            }
          });
        }
      }
    }
  }, [content, status]);
  return /* @__PURE__ */ jsx21(
    "div",
    {
      className: "not-prose relative w-full min-h-[300px] pb-[calc(50dvh)]",
      ref: containerRef
    }
  );
}
var CodeEditor = memo2(PureCodeEditor, (prevProps, nextProps) => {
  if (prevProps.status === "streaming" && nextProps.status === "streaming") {
    return false;
  }
  if (prevProps.content !== nextProps.content) {
    return false;
  }
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.currentVersionIndex !== nextProps.currentVersionIndex) {
    return false;
  }
  return true;
});

// src/components/chatbot/console.tsx
import {
  useCallback as useCallback3,
  useEffect as useEffect7,
  useRef as useRef4,
  useState as useState8
} from "react";

// src/components/ui/spinner.tsx
import { Loader2Icon } from "lucide-react";
import { jsx as jsx22 } from "react/jsx-runtime";
function Spinner({ className, ...props }) {
  return /* @__PURE__ */ jsx22(
    Loader2Icon,
    {
      "aria-label": "Loading",
      className: cn("size-4 animate-spin", className),
      role: "status",
      ...props
    }
  );
}

// src/components/chatbot/console.tsx
import { Fragment as Fragment3, jsx as jsx23, jsxs as jsxs12 } from "react/jsx-runtime";
function Console({ consoleOutputs, setConsoleOutputs }) {
  const [height, setHeight] = useState8(300);
  const [isResizing, setIsResizing] = useState8(false);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const minHeight = 100;
  const maxHeight = 800;
  const startResizing = useCallback3(() => {
    setIsResizing(true);
  }, []);
  const stopResizing = useCallback3(() => {
    setIsResizing(false);
  }, []);
  const resize = useCallback3(
    (e) => {
      if (isResizing) {
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight >= minHeight && newHeight <= maxHeight) {
          setHeight(newHeight);
        }
      }
    },
    [isResizing]
  );
  useEffect7(() => {
    window.addEventListener("mousemove", resize);
    window.addEventListener("mouseup", stopResizing);
    return () => {
      window.removeEventListener("mousemove", resize);
      window.removeEventListener("mouseup", stopResizing);
    };
  }, [resize, stopResizing]);
  const consoleContainerRef = useRef4(null);
  useEffect7(() => {
    if (consoleOutputs.length > 0) {
      consoleContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [consoleOutputs.length]);
  useEffect7(() => {
    if (!isArtifactVisible) {
      setConsoleOutputs([]);
    }
  }, [isArtifactVisible, setConsoleOutputs]);
  return consoleOutputs.length > 0 ? /* @__PURE__ */ jsxs12(Fragment3, { children: [
    /* @__PURE__ */ jsx23(
      "div",
      {
        "aria-label": "Resize console",
        "aria-orientation": "horizontal",
        "aria-valuemax": maxHeight,
        "aria-valuemin": minHeight,
        "aria-valuenow": height,
        className: "fixed z-50 h-2 w-full cursor-ns-resize",
        onKeyDown: (e) => {
          if (e.key === "ArrowUp") {
            setHeight((prev) => Math.min(prev + 10, maxHeight));
          } else if (e.key === "ArrowDown") {
            setHeight((prev) => Math.max(prev - 10, minHeight));
          }
        },
        onMouseDown: startResizing,
        role: "slider",
        style: { bottom: height - 4 },
        tabIndex: 0
      }
    ),
    /* @__PURE__ */ jsxs12(
      "div",
      {
        className: cn(
          "fixed bottom-0 z-40 flex w-full flex-col overflow-x-hidden overflow-y-auto border-t border-border/50 bg-background",
          { "select-none": isResizing }
        ),
        ref: consoleContainerRef,
        style: { height },
        children: [
          /* @__PURE__ */ jsxs12("div", { className: "sticky top-0 z-50 flex h-10 w-full items-center justify-between border-b border-border/50 bg-background px-3", children: [
            /* @__PURE__ */ jsxs12("div", { className: "flex items-center gap-2.5 text-[13px] text-muted-foreground", children: [
              /* @__PURE__ */ jsx23(TerminalWindowIcon, {}),
              /* @__PURE__ */ jsx23("span", { children: "Console" })
            ] }),
            /* @__PURE__ */ jsx23(
              Button,
              {
                className: "size-7 text-muted-foreground/50 hover:text-foreground",
                onClick: () => setConsoleOutputs([]),
                size: "icon-sm",
                variant: "ghost",
                children: /* @__PURE__ */ jsx23(CrossSmallIcon, {})
              }
            )
          ] }),
          /* @__PURE__ */ jsx23("div", { className: "bg-background", children: [...consoleOutputs].reverse().map((consoleOutput, index) => /* @__PURE__ */ jsxs12(
            "div",
            {
              className: "flex border-b border-border/30 px-4 py-2.5 font-mono text-[12px] leading-relaxed",
              children: [
                /* @__PURE__ */ jsxs12(
                  "div",
                  {
                    className: cn("w-10 shrink-0 tabular-nums", {
                      "text-muted-foreground": [
                        "in_progress",
                        "loading_packages"
                      ].includes(consoleOutput.status),
                      "text-emerald-500": consoleOutput.status === "completed",
                      "text-red-400": consoleOutput.status === "failed"
                    }),
                    children: [
                      "[",
                      consoleOutputs.length - index,
                      "]"
                    ]
                  }
                ),
                ["in_progress", "loading_packages"].includes(
                  consoleOutput.status
                ) ? /* @__PURE__ */ jsxs12("div", { className: "flex items-center gap-2", children: [
                  /* @__PURE__ */ jsx23(Spinner, { className: "size-3.5" }),
                  /* @__PURE__ */ jsx23("span", { className: "text-muted-foreground", children: consoleOutput.status === "in_progress" ? "Initializing..." : consoleOutput.status === "loading_packages" ? consoleOutput.contents.map(
                    (content) => content.type === "text" ? content.value : null
                  ) : null })
                ] }) : /* @__PURE__ */ jsx23("div", { className: "no-scrollbar flex w-full min-w-0 flex-col gap-2 overflow-x-auto text-foreground", children: consoleOutput.contents.map(
                  (content) => content.type === "image" ? /* @__PURE__ */ jsx23(
                    "picture",
                    {
                      children: /* @__PURE__ */ jsx23(
                        "img",
                        {
                          alt: "output",
                          className: "max-w-full rounded-md",
                          src: content.value
                        }
                      )
                    },
                    `${consoleOutput.id}-img-${content.value.slice(0, 32)}`
                  ) : /* @__PURE__ */ jsx23(
                    "div",
                    {
                      className: "w-full whitespace-pre-line break-words",
                      children: content.value
                    },
                    `${consoleOutput.id}-txt-${content.value.slice(0, 32)}`
                  )
                ) })
              ]
            },
            consoleOutput.id
          )) })
        ]
      }
    )
  ] }) : null;
}

// src/components/chatbot/create-artifact.tsx
var Artifact = class {
  kind;
  description;
  content;
  actions;
  toolbar;
  initialize;
  onStreamPart;
  constructor(config) {
    this.kind = config.kind;
    this.description = config.description;
    this.content = config.content;
    this.actions = config.actions || [];
    this.toolbar = config.toolbar || [];
    this.initialize = config.initialize || (async () => ({}));
    this.onStreamPart = config.onStreamPart;
  }
};

// src/artifacts/code/client.tsx
import { Fragment as Fragment4, jsx as jsx24, jsxs as jsxs13 } from "react/jsx-runtime";
var OUTPUT_HANDLERS = {
  matplotlib: `
    import io
    import base64
    from matplotlib import pyplot as plt

    # Clear any existing plots
    plt.clf()
    plt.close('all')

    # Switch to agg backend
    plt.switch_backend('agg')

    def setup_matplotlib_output():
        def custom_show():
            if plt.gcf().get_size_inches().prod() * plt.gcf().dpi ** 2 > 25_000_000:
                print("Warning: Plot size too large, reducing quality")
                plt.gcf().set_dpi(100)

            png_buf = io.BytesIO()
            plt.savefig(png_buf, format='png')
            png_buf.seek(0)
            png_base64 = base64.b64encode(png_buf.read()).decode('utf-8')
            print(f'data:image/png;base64,{png_base64}')
            png_buf.close()

            plt.clf()
            plt.close('all')

        plt.show = custom_show
  `,
  basic: `
    # Basic output capture setup
  `
};
function detectRequiredHandlers(code3) {
  const handlers = ["basic"];
  if (code3.includes("matplotlib") || code3.includes("plt.")) {
    handlers.push("matplotlib");
  }
  return handlers;
}
var codeArtifact = new Artifact({
  kind: "code",
  description: "Useful for code generation; Code execution is only available for python code.",
  initialize: ({ setMetadata }) => {
    setMetadata({
      outputs: []
    });
  },
  onStreamPart: ({ streamPart, setArtifact }) => {
    if (streamPart.type === "data-codeDelta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.data,
        isVisible: draftArtifact.status === "streaming" && draftArtifact.content.length > 300 && draftArtifact.content.length < 310 ? true : draftArtifact.isVisible,
        status: "streaming"
      }));
    }
  },
  content: ({ metadata, setMetadata, ...props }) => {
    return /* @__PURE__ */ jsxs13(Fragment4, { children: [
      /* @__PURE__ */ jsx24("div", { className: "relative min-h-[200px]", children: /* @__PURE__ */ jsx24(CodeEditor, { ...props }) }),
      metadata?.outputs && /* @__PURE__ */ jsx24(
        Console,
        {
          consoleOutputs: metadata.outputs,
          setConsoleOutputs: () => {
            setMetadata({
              ...metadata,
              outputs: []
            });
          }
        }
      )
    ] });
  },
  actions: [
    {
      icon: /* @__PURE__ */ jsx24(PlayIcon, { size: 18 }),
      label: "Run",
      description: "Execute code",
      onClick: async ({ content, setMetadata }) => {
        const runId = generateUUID();
        const outputContent = [];
        setMetadata((metadata) => ({
          ...metadata,
          outputs: [
            ...metadata.outputs,
            {
              id: runId,
              contents: [],
              status: "in_progress"
            }
          ]
        }));
        try {
          const currentPyodideInstance = await globalThis.loadPyodide({
            indexURL: "https://cdn.jsdelivr.net/pyodide/v0.23.4/full/"
          });
          currentPyodideInstance.setStdout({
            batched: (output) => {
              outputContent.push({
                type: output.startsWith("data:image/png;base64") ? "image" : "text",
                value: output
              });
            }
          });
          await currentPyodideInstance.loadPackagesFromImports(content, {
            messageCallback: (message2) => {
              setMetadata((metadata) => ({
                ...metadata,
                outputs: [
                  ...metadata.outputs.filter((output) => output.id !== runId),
                  {
                    id: runId,
                    contents: [{ type: "text", value: message2 }],
                    status: "loading_packages"
                  }
                ]
              }));
            }
          });
          const requiredHandlers = detectRequiredHandlers(content);
          for (const handler of requiredHandlers) {
            if (OUTPUT_HANDLERS[handler]) {
              await currentPyodideInstance.runPythonAsync(
                OUTPUT_HANDLERS[handler]
              );
              if (handler === "matplotlib") {
                await currentPyodideInstance.runPythonAsync(
                  "setup_matplotlib_output()"
                );
              }
            }
          }
          await currentPyodideInstance.runPythonAsync(content);
          setMetadata((metadata) => ({
            ...metadata,
            outputs: [
              ...metadata.outputs.filter((output) => output.id !== runId),
              {
                id: runId,
                contents: outputContent,
                status: "completed"
              }
            ]
          }));
        } catch (error) {
          setMetadata((metadata) => ({
            ...metadata,
            outputs: [
              ...metadata.outputs.filter((output) => output.id !== runId),
              {
                id: runId,
                contents: [
                  {
                    type: "text",
                    value: error instanceof Error ? error.message : String(error)
                  }
                ],
                status: "failed"
              }
            ]
          }));
        }
      }
    },
    {
      icon: /* @__PURE__ */ jsx24(UndoIcon, { size: 18 }),
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx24(RedoIcon, { size: 18 }),
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx24(CopyIcon, { size: 18 }),
      description: "Copy code to clipboard",
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast4.success("Copied to clipboard!");
      }
    }
  ],
  toolbar: [
    {
      icon: /* @__PURE__ */ jsx24(MessageIcon, {}),
      description: "Add comments",
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: "user",
          parts: [
            {
              type: "text",
              text: "Add comments to the code snippet for understanding"
            }
          ]
        });
      }
    },
    {
      icon: /* @__PURE__ */ jsx24(LogsIcon, {}),
      description: "Add logs",
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: "user",
          parts: [
            {
              type: "text",
              text: "Add logs to the code snippet for debugging"
            }
          ]
        });
      }
    }
  ]
});

// src/artifacts/image/client.tsx
import { toast as toast5 } from "sonner";

// src/components/chatbot/image-editor.tsx
import cn2 from "classnames";
import { jsx as jsx25, jsxs as jsxs14 } from "react/jsx-runtime";
function ImageEditor({
  title,
  content,
  status,
  isInline
}) {
  return /* @__PURE__ */ jsx25(
    "div",
    {
      className: cn2("flex w-full flex-row items-center justify-center", {
        "h-[calc(100dvh-60px)]": !isInline,
        "h-[200px]": isInline
      }),
      children: status === "streaming" ? /* @__PURE__ */ jsxs14("div", { className: "flex flex-row items-center gap-4", children: [
        !isInline && /* @__PURE__ */ jsx25("div", { className: "animate-spin", children: /* @__PURE__ */ jsx25(LoaderIcon, {}) }),
        /* @__PURE__ */ jsx25("div", { children: "Generating Image..." })
      ] }) : /* @__PURE__ */ jsx25("picture", { children: /* @__PURE__ */ jsx25(
        "img",
        {
          alt: title,
          className: cn2("h-fit w-full max-w-[800px]", {
            "p-0 md:p-20": !isInline
          }),
          src: `data:image/png;base64,${content}`
        }
      ) })
    }
  );
}

// src/artifacts/image/client.tsx
import { jsx as jsx26 } from "react/jsx-runtime";
var imageArtifact = new Artifact({
  kind: "image",
  description: "Useful for image generation",
  onStreamPart: ({ streamPart, setArtifact }) => {
    if (streamPart.type === "data-imageDelta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.data,
        isVisible: true,
        status: "streaming"
      }));
    }
  },
  content: ImageEditor,
  actions: [
    {
      icon: /* @__PURE__ */ jsx26(UndoIcon, { size: 18 }),
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx26(RedoIcon, { size: 18 }),
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx26(CopyIcon, { size: 18 }),
      description: "Copy image to clipboard",
      onClick: ({ content }) => {
        const img = new Image();
        img.src = `data:image/png;base64,${content}`;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext("2d");
          ctx?.drawImage(img, 0, 0);
          canvas.toBlob((blob) => {
            if (blob) {
              navigator.clipboard.write([
                new ClipboardItem({ "image/png": blob })
              ]);
            }
          }, "image/png");
        };
        toast5.success("Copied image to clipboard!");
      }
    }
  ],
  toolbar: []
});

// src/artifacts/sheet/client.tsx
import { parse as parse2, unparse as unparse2 } from "papaparse";
import { toast as toast6 } from "sonner";

// src/components/chatbot/sheet-editor.tsx
import { useTheme as useTheme2 } from "next-themes";
import { parse, unparse } from "papaparse";
import { memo as memo3, useEffect as useEffect8, useMemo as useMemo6, useState as useState9 } from "react";
import DataGrid, { textEditor } from "react-data-grid";
import "react-data-grid/lib/styles.css";
import { jsx as jsx27 } from "react/jsx-runtime";
var MIN_ROWS = 50;
var MIN_COLS = 26;
var PureSpreadsheetEditor = ({ content, saveContent }) => {
  const { resolvedTheme } = useTheme2();
  const parseData = useMemo6(() => {
    if (!content) {
      return new Array(MIN_ROWS).fill(new Array(MIN_COLS).fill(""));
    }
    const result = parse(content, { skipEmptyLines: true });
    const paddedData = result.data.map((row) => {
      const paddedRow = [...row];
      while (paddedRow.length < MIN_COLS) {
        paddedRow.push("");
      }
      return paddedRow;
    });
    while (paddedData.length < MIN_ROWS) {
      paddedData.push(new Array(MIN_COLS).fill(""));
    }
    return paddedData;
  }, [content]);
  const columns = useMemo6(() => {
    const rowNumberColumn = {
      key: "rowNumber",
      name: "",
      frozen: true,
      width: 50,
      renderCell: ({ rowIdx }) => rowIdx + 1,
      cellClass: "border-t border-r dark:bg-neutral-950 dark:text-neutral-50",
      headerCellClass: "border-t border-r dark:bg-neutral-900 dark:text-neutral-50"
    };
    const dataColumns = Array.from({ length: MIN_COLS }, (_, i) => ({
      key: i.toString(),
      name: String.fromCharCode(65 + i),
      renderEditCell: textEditor,
      width: 120,
      cellClass: cn("border-t dark:bg-neutral-950 dark:text-neutral-50", {
        "border-l": i !== 0
      }),
      headerCellClass: cn("border-t dark:bg-neutral-900 dark:text-neutral-50", {
        "border-l": i !== 0
      })
    }));
    return [rowNumberColumn, ...dataColumns];
  }, []);
  const initialRows = useMemo6(() => {
    return parseData.map((row, rowIndex) => {
      const rowData = {
        id: rowIndex,
        rowNumber: rowIndex + 1
      };
      columns.slice(1).forEach((col, colIndex) => {
        rowData[col.key] = row[colIndex] || "";
      });
      return rowData;
    });
  }, [parseData, columns]);
  const [localRows, setLocalRows] = useState9(initialRows);
  useEffect8(() => {
    setLocalRows(initialRows);
  }, [initialRows]);
  const generateCsv = (data) => {
    return unparse(data);
  };
  const handleRowsChange = (newRows) => {
    setLocalRows(newRows);
    const updatedData = newRows.map((row) => {
      return columns.slice(1).map((col) => String(row[col.key] ?? ""));
    });
    const newCsvContent = generateCsv(updatedData);
    saveContent(newCsvContent, true);
  };
  return /* @__PURE__ */ jsx27(
    DataGrid,
    {
      className: resolvedTheme === "dark" ? "rdg-dark" : "rdg-light",
      columns,
      defaultColumnOptions: {
        resizable: true,
        sortable: true
      },
      enableVirtualization: true,
      onCellClick: (args) => {
        if (args.column.key !== "rowNumber") {
          args.selectCell(true);
        }
      },
      onRowsChange: handleRowsChange,
      rows: localRows,
      style: { height: "100%" }
    }
  );
};
function areEqual(prevProps, nextProps) {
  return prevProps.currentVersionIndex === nextProps.currentVersionIndex && prevProps.isCurrentVersion === nextProps.isCurrentVersion && !(prevProps.status === "streaming" && nextProps.status === "streaming") && prevProps.content === nextProps.content && prevProps.saveContent === nextProps.saveContent;
}
var SpreadsheetEditor = memo3(PureSpreadsheetEditor, areEqual);

// src/artifacts/sheet/client.tsx
import { jsx as jsx28 } from "react/jsx-runtime";
var sheetArtifact = new Artifact({
  kind: "sheet",
  description: "Useful for working with spreadsheets",
  initialize: () => null,
  onStreamPart: ({ setArtifact, streamPart }) => {
    if (streamPart.type === "data-sheetDelta") {
      setArtifact((draftArtifact) => ({
        ...draftArtifact,
        content: streamPart.data,
        isVisible: true,
        status: "streaming"
      }));
    }
  },
  content: ({ content, currentVersionIndex, onSaveContent, status }) => {
    return /* @__PURE__ */ jsx28(
      SpreadsheetEditor,
      {
        content,
        currentVersionIndex,
        isCurrentVersion: true,
        saveContent: onSaveContent,
        status
      }
    );
  },
  actions: [
    {
      icon: /* @__PURE__ */ jsx28(UndoIcon, { size: 18 }),
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx28(RedoIcon, { size: 18 }),
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx28(CopyIcon, {}),
      description: "Copy as .csv",
      onClick: ({ content }) => {
        const parsed = parse2(content, { skipEmptyLines: true });
        const nonEmptyRows = parsed.data.filter(
          (row) => row.some((cell) => cell.trim() !== "")
        );
        const cleanedCsv = unparse2(nonEmptyRows);
        navigator.clipboard.writeText(cleanedCsv);
        toast6.success("Copied csv to clipboard!");
      }
    }
  ],
  toolbar: [
    {
      description: "Format and clean data",
      icon: /* @__PURE__ */ jsx28(SparklesIcon, {}),
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: "user",
          parts: [
            { type: "text", text: "Can you please format and clean the data?" }
          ]
        });
      }
    },
    {
      description: "Analyze and visualize data",
      icon: /* @__PURE__ */ jsx28(LineChartIcon, {}),
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: "user",
          parts: [
            {
              type: "text",
              text: "Can you please analyze and visualize the data by creating a new code artifact in python?"
            }
          ]
        });
      }
    }
  ]
});

// src/artifacts/text/client.tsx
import { toast as toast7 } from "sonner";

// src/components/chatbot/diffview.tsx
import OrderedMap from "orderedmap";
import {
  DOMParser,
  Schema
} from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { addListNodes } from "prosemirror-schema-list";
import { EditorState as EditorState2 } from "prosemirror-state";
import { EditorView as EditorView2 } from "prosemirror-view";
import { useEffect as useEffect10, useRef as useRef5 } from "react";
import { renderToString } from "react-dom/server";

// src/components/ai-elements/message.tsx
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { ChevronLeftIcon, ChevronRightIcon as ChevronRightIcon2 } from "lucide-react";
import {
  createContext as createContext5,
  memo as memo4,
  useCallback as useCallback4,
  useContext as useContext5,
  useEffect as useEffect9,
  useMemo as useMemo7,
  useState as useState10
} from "react";
import { Streamdown } from "streamdown";

// src/components/ui/button-group.tsx
import { cva as cva3 } from "class-variance-authority";
import { Slot as Slot3 } from "radix-ui";
import { jsx as jsx29 } from "react/jsx-runtime";
var buttonGroupVariants = cva3(
  "flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 has-[>[data-slot=button-group]]:gap-2 has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-4xl [&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit [&>input]:flex-1",
  {
    variants: {
      orientation: {
        horizontal: "[&>*:not(:first-child)]:rounded-l-none [&>*:not(:first-child)]:border-l-0 [&>*:not(:last-child)]:rounded-r-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-4xl!",
        vertical: "flex-col [&>*:not(:first-child)]:rounded-t-none [&>*:not(:first-child)]:border-t-0 [&>*:not(:last-child)]:rounded-b-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-4xl!"
      }
    },
    defaultVariants: {
      orientation: "horizontal"
    }
  }
);

// src/components/ai-elements/message.tsx
import { jsx as jsx30, jsxs as jsxs15 } from "react/jsx-runtime";
var MessageContent = ({
  children,
  className,
  ...props
}) => /* @__PURE__ */ jsx30(
  "div",
  {
    className: cn(
      "flex min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm text-foreground",
      className
    ),
    ...props,
    children
  }
);
var MessageActions = ({
  className,
  children,
  ...props
}) => /* @__PURE__ */ jsx30("div", { className: cn("flex items-center gap-1", className), ...props, children });
var MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}) => {
  const button = /* @__PURE__ */ jsxs15(Button, { size, type: "button", variant, ...props, children: [
    children,
    /* @__PURE__ */ jsx30("span", { className: "sr-only", children: label || tooltip })
  ] });
  if (tooltip) {
    return /* @__PURE__ */ jsx30(TooltipProvider, { children: /* @__PURE__ */ jsxs15(Tooltip, { children: [
      /* @__PURE__ */ jsx30(TooltipTrigger, { asChild: true, children: button }),
      /* @__PURE__ */ jsx30(TooltipContent, { children: /* @__PURE__ */ jsx30("p", { children: tooltip }) })
    ] }) });
  }
  return button;
};
var MessageBranchContext = createContext5(
  null
);
var streamdownPlugins = { cjk, code, math, mermaid };
var MessageResponse = memo4(
  ({ className, ...props }) => /* @__PURE__ */ jsx30(
    Streamdown,
    {
      className: cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      ),
      plugins: streamdownPlugins,
      ...props
    }
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
);
MessageResponse.displayName = "MessageResponse";

// lib/editor/diff.js
import { diff_match_patch } from "diff-match-patch";
import { Fragment as Fragment5, Node } from "prosemirror-model";
var DiffType = {
  Unchanged: 0,
  Deleted: -1,
  Inserted: 1
};
var patchDocumentNode = (schema3, oldNode, newNode) => {
  assertNodeTypeEqual(oldNode, newNode);
  const finalLeftChildren = [];
  const finalRightChildren = [];
  const oldChildren = normalizeNodeContent(oldNode);
  const newChildren = normalizeNodeContent(newNode);
  const oldChildLen = oldChildren.length;
  const newChildLen = newChildren.length;
  const minChildLen = Math.min(oldChildLen, newChildLen);
  let left = 0;
  let right = 0;
  for (; left < minChildLen; left++) {
    const oldChild = oldChildren[left];
    const newChild = newChildren[left];
    if (!isNodeEqual(oldChild, newChild)) {
      break;
    }
    finalLeftChildren.push(...ensureArray(oldChild));
  }
  for (; right + left + 1 < minChildLen; right++) {
    const oldChild = oldChildren[oldChildLen - right - 1];
    const newChild = newChildren[newChildLen - right - 1];
    if (!isNodeEqual(oldChild, newChild)) {
      break;
    }
    finalRightChildren.unshift(...ensureArray(oldChild));
  }
  const diffOldChildren = oldChildren.slice(left, oldChildLen - right);
  const diffNewChildren = newChildren.slice(left, newChildLen - right);
  if (diffOldChildren.length && diffNewChildren.length) {
    const matchedNodes = matchNodes(
      schema3,
      diffOldChildren,
      diffNewChildren
    ).sort((a, b) => b.count - a.count);
    const bestMatch = matchedNodes[0];
    if (bestMatch) {
      const { oldStartIndex, newStartIndex, oldEndIndex, newEndIndex } = bestMatch;
      const oldBeforeMatchChildren = diffOldChildren.slice(0, oldStartIndex);
      const newBeforeMatchChildren = diffNewChildren.slice(0, newStartIndex);
      finalLeftChildren.push(
        ...patchRemainNodes(
          schema3,
          oldBeforeMatchChildren,
          newBeforeMatchChildren
        )
      );
      finalLeftChildren.push(
        ...diffOldChildren.slice(oldStartIndex, oldEndIndex)
      );
      const oldAfterMatchChildren = diffOldChildren.slice(oldEndIndex);
      const newAfterMatchChildren = diffNewChildren.slice(newEndIndex);
      finalRightChildren.unshift(
        ...patchRemainNodes(
          schema3,
          oldAfterMatchChildren,
          newAfterMatchChildren
        )
      );
    } else {
      finalLeftChildren.push(
        ...patchRemainNodes(schema3, diffOldChildren, diffNewChildren)
      );
    }
  } else {
    finalLeftChildren.push(
      ...patchRemainNodes(schema3, diffOldChildren, diffNewChildren)
    );
  }
  return createNewNode(oldNode, [...finalLeftChildren, ...finalRightChildren]);
};
var matchNodes = (_schema, oldChildren, newChildren) => {
  const matches = [];
  for (let oldStartIndex = 0; oldStartIndex < oldChildren.length; oldStartIndex++) {
    const oldStartNode = oldChildren[oldStartIndex];
    const newStartIndex = findMatchNode(newChildren, oldStartNode);
    if (newStartIndex !== -1) {
      let oldEndIndex = oldStartIndex + 1;
      let newEndIndex = newStartIndex + 1;
      for (; oldEndIndex < oldChildren.length && newEndIndex < newChildren.length; oldEndIndex++, newEndIndex++) {
        const oldEndNode = oldChildren[oldEndIndex];
        if (!isNodeEqual(newChildren[newEndIndex], oldEndNode)) {
          break;
        }
      }
      matches.push({
        oldStartIndex,
        newStartIndex,
        oldEndIndex,
        newEndIndex,
        count: newEndIndex - newStartIndex
      });
    }
  }
  return matches;
};
var findMatchNode = (children, node, startIndex = 0) => {
  for (let i = startIndex; i < children.length; i++) {
    if (isNodeEqual(children[i], node)) {
      return i;
    }
  }
  return -1;
};
var patchRemainNodes = (schema3, oldChildren, newChildren) => {
  const finalLeftChildren = [];
  const finalRightChildren = [];
  const oldChildLen = oldChildren.length;
  const newChildLen = newChildren.length;
  let left = 0;
  let right = 0;
  while (oldChildLen - left - right > 0 && newChildLen - left - right > 0) {
    const leftOldNode = oldChildren[left];
    const leftNewNode = newChildren[left];
    const rightOldNode = oldChildren[oldChildLen - right - 1];
    const rightNewNode = newChildren[newChildLen - right - 1];
    let updateLeft = !isTextNode(leftOldNode) && matchNodeType(leftOldNode, leftNewNode);
    let updateRight = !isTextNode(rightOldNode) && matchNodeType(rightOldNode, rightNewNode);
    if (Array.isArray(leftOldNode) && Array.isArray(leftNewNode)) {
      finalLeftChildren.push(
        ...patchTextNodes(schema3, leftOldNode, leftNewNode)
      );
      left += 1;
      continue;
    }
    if (updateLeft && updateRight) {
      const equalityLeft = computeChildEqualityFactor(leftOldNode, leftNewNode);
      const equalityRight = computeChildEqualityFactor(
        rightOldNode,
        rightNewNode
      );
      if (equalityLeft < equalityRight) {
        updateLeft = false;
      } else {
        updateRight = false;
      }
    }
    if (updateLeft) {
      finalLeftChildren.push(
        patchDocumentNode(schema3, leftOldNode, leftNewNode)
      );
      left += 1;
    } else if (updateRight) {
      finalRightChildren.unshift(
        patchDocumentNode(schema3, rightOldNode, rightNewNode)
      );
      right += 1;
    } else {
      finalLeftChildren.push(
        createDiffNode(schema3, leftOldNode, DiffType.Deleted)
      );
      finalLeftChildren.push(
        createDiffNode(schema3, leftNewNode, DiffType.Inserted)
      );
      left += 1;
    }
  }
  const deleteNodeLen = oldChildLen - left - right;
  const insertNodeLen = newChildLen - left - right;
  if (deleteNodeLen) {
    finalLeftChildren.push(
      ...oldChildren.slice(left, left + deleteNodeLen).flat().map((node) => createDiffNode(schema3, node, DiffType.Deleted))
    );
  }
  if (insertNodeLen) {
    finalRightChildren.unshift(
      ...newChildren.slice(left, left + insertNodeLen).flat().map((node) => createDiffNode(schema3, node, DiffType.Inserted))
    );
  }
  return [...finalLeftChildren, ...finalRightChildren];
};
var patchTextNodes = (schema3, oldNode, newNode) => {
  const dmp = new diff_match_patch();
  const oldText = oldNode.map((n2) => getNodeText(n2)).join("");
  const newText = newNode.map((n2) => getNodeText(n2)).join("");
  const oldSentences = tokenizeSentences(oldText);
  const newSentences = tokenizeSentences(newText);
  const { chars1, chars2, lineArray } = sentencesToChars(
    oldSentences,
    newSentences
  );
  let diffs = dmp.diff_main(chars1, chars2, false);
  diffs = diffs.map(([type, text2]) => {
    const sentences = text2.split("").map((char) => lineArray[char.charCodeAt(0)]);
    return [type, sentences];
  });
  const res = diffs.flatMap(([type, sentences]) => {
    return sentences.map((sentence) => {
      const node = createTextNode(
        schema3,
        sentence,
        type === DiffType.Unchanged ? [] : [createDiffMark(schema3, type)]
      );
      return node;
    });
  });
  return res;
};
var tokenizeSentences = (text2) => {
  return text2.match(/[^.!?]+[.!?]*\s*/g) || [];
};
var sentencesToChars = (oldSentences, newSentences) => {
  const lineArray = [];
  const lineHash = {};
  let lineStart = 0;
  const chars1 = oldSentences.map((sentence) => {
    const line = sentence;
    if (line in lineHash) {
      return String.fromCharCode(lineHash[line]);
    }
    lineHash[line] = lineStart;
    lineArray[lineStart] = line;
    lineStart++;
    return String.fromCharCode(lineHash[line]);
  }).join("");
  const chars2 = newSentences.map((sentence) => {
    const line = sentence;
    if (line in lineHash) {
      return String.fromCharCode(lineHash[line]);
    }
    lineHash[line] = lineStart;
    lineArray[lineStart] = line;
    lineStart++;
    return String.fromCharCode(lineHash[line]);
  }).join("");
  return { chars1, chars2, lineArray };
};
var computeChildEqualityFactor = (_node1, _node2) => {
  return 0;
};
var assertNodeTypeEqual = (node1, node2) => {
  if (getNodeProperty(node1, "type") !== getNodeProperty(node2, "type")) {
    throw new Error(`node type not equal: ${node1.type} !== ${node2.type}`);
  }
};
var ensureArray = (value) => {
  return Array.isArray(value) ? value : [value];
};
var isNodeEqual = (node1, node2) => {
  const isNode1Array = Array.isArray(node1);
  const isNode2Array = Array.isArray(node2);
  if (isNode1Array !== isNode2Array) {
    return false;
  }
  if (isNode1Array) {
    return node1.length === node2.length && node1.every((node, index) => isNodeEqual(node, node2[index]));
  }
  const type1 = getNodeProperty(node1, "type");
  const type2 = getNodeProperty(node2, "type");
  if (type1 !== type2) {
    return false;
  }
  if (isTextNode(node1)) {
    const text1 = getNodeProperty(node1, "text");
    const text2 = getNodeProperty(node2, "text");
    if (text1 !== text2) {
      return false;
    }
  }
  const attrs1 = getNodeAttributes(node1);
  const attrs2 = getNodeAttributes(node2);
  const attrs = [.../* @__PURE__ */ new Set([...Object.keys(attrs1), ...Object.keys(attrs2)])];
  for (const attr of attrs) {
    if (attrs1[attr] !== attrs2[attr]) {
      return false;
    }
  }
  const marks1 = getNodeMarks(node1);
  const marks2 = getNodeMarks(node2);
  if (marks1.length !== marks2.length) {
    return false;
  }
  for (let i = 0; i < marks1.length; i++) {
    if (!isNodeEqual(marks1[i], marks2[i])) {
      return false;
    }
  }
  const children1 = getNodeChildren(node1);
  const children2 = getNodeChildren(node2);
  if (children1.length !== children2.length) {
    return false;
  }
  for (let i = 0; i < children1.length; i++) {
    if (!isNodeEqual(children1[i], children2[i])) {
      return false;
    }
  }
  return true;
};
var normalizeNodeContent = (node) => {
  const content = getNodeChildren(node) ?? [];
  const res = [];
  for (let i = 0; i < content.length; i++) {
    const child = content[i];
    if (isTextNode(child)) {
      const textNodes = [];
      for (let textNode = content[i]; i < content.length && isTextNode(textNode); textNode = content[++i]) {
        textNodes.push(textNode);
      }
      i--;
      res.push(textNodes);
    } else {
      res.push(child);
    }
  }
  return res;
};
var getNodeProperty = (node, property) => {
  if (property === "type") {
    return node.type?.name;
  }
  return node[property];
};
var getNodeAttributes = (node) => node.attrs ? node.attrs : {};
var getNodeMarks = (node) => node.marks ?? [];
var getNodeChildren = (node) => node.content?.content ?? [];
var getNodeText = (node) => node.text;
var isTextNode = (node) => node.type?.name === "text";
var matchNodeType = (node1, node2) => node1.type?.name === node2.type?.name || Array.isArray(node1) && Array.isArray(node2);
var createNewNode = (oldNode, children) => {
  if (!oldNode.type) {
    throw new Error("oldNode.type is undefined");
  }
  return new Node(
    oldNode.type,
    oldNode.attrs,
    Fragment5.fromArray(children),
    oldNode.marks
  );
};
var createDiffNode = (schema3, node, type) => {
  return mapDocumentNode(node, (currentNode) => {
    if (isTextNode(currentNode)) {
      return createTextNode(schema3, getNodeText(currentNode), [
        ...currentNode.marks || [],
        createDiffMark(schema3, type)
      ]);
    }
    return currentNode;
  });
};
function mapDocumentNode(node, mapper) {
  const copy = node.copy(
    Fragment5.from(
      node.content.content.map((currentNode) => mapDocumentNode(currentNode, mapper)).filter((n2) => n2)
    )
  );
  return mapper(copy) || copy;
}
var createDiffMark = (schema3, type) => {
  if (type === DiffType.Inserted) {
    return schema3.mark("diffMark", { type });
  }
  if (type === DiffType.Deleted) {
    return schema3.mark("diffMark", { type });
  }
  throw new Error("type is not valid");
};
var createTextNode = (schema3, content, marks = []) => {
  return schema3.text(content, marks);
};
var diffEditor = (schema3, oldDoc, newDoc) => {
  const oldNode = Node.fromJSON(schema3, oldDoc);
  const newNode = Node.fromJSON(schema3, newDoc);
  return patchDocumentNode(schema3, oldNode, newNode);
};

// src/components/chatbot/diffview.tsx
import { jsx as jsx31 } from "react/jsx-runtime";
var diffSchema = new Schema({
  nodes: addListNodes(schema.spec.nodes, "paragraph block*", "block"),
  marks: OrderedMap.from({
    ...schema.spec.marks.toObject(),
    diffMark: {
      attrs: { type: { default: "" } },
      toDOM(mark) {
        let className = "";
        switch (mark.attrs.type) {
          case DiffType.Inserted:
            className = "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 rounded-sm px-0.5 -mx-0.5";
            break;
          case DiffType.Deleted:
            className = "bg-red-500/15 line-through text-red-600 dark:text-red-400 rounded-sm px-0.5 -mx-0.5 opacity-70";
            break;
          default:
            className = "";
        }
        return ["span", { class: className }, 0];
      }
    }
  })
});
function computeDiff(oldDoc, newDoc) {
  return diffEditor(diffSchema, oldDoc.toJSON(), newDoc.toJSON());
}
var DiffView = ({ oldContent, newContent }) => {
  const editorRef = useRef5(null);
  const viewRef = useRef5(null);
  useEffect10(() => {
    if (editorRef.current && !viewRef.current) {
      const parser = DOMParser.fromSchema(diffSchema);
      const oldHtmlContent = renderToString(
        /* @__PURE__ */ jsx31(MessageResponse, { children: oldContent })
      );
      const newHtmlContent = renderToString(
        /* @__PURE__ */ jsx31(MessageResponse, { children: newContent })
      );
      const oldContainer = document.createElement("div");
      oldContainer.innerHTML = oldHtmlContent;
      const newContainer = document.createElement("div");
      newContainer.innerHTML = newHtmlContent;
      const oldDoc = parser.parse(oldContainer);
      const newDoc = parser.parse(newContainer);
      const diffedDoc = computeDiff(oldDoc, newDoc);
      const state = EditorState2.create({
        doc: diffedDoc,
        plugins: []
      });
      viewRef.current = new EditorView2(editorRef.current, {
        state,
        editable: () => false
      });
      requestAnimationFrame(() => {
        const firstDiff = editorRef.current?.querySelector(
          "[class*='bg-emerald'], [class*='bg-red']"
        );
        if (firstDiff) {
          firstDiff.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    }
    return () => {
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [oldContent, newContent]);
  return /* @__PURE__ */ jsx31(
    "div",
    {
      className: "diff-editor prose dark:prose-invert prose-neutral relative max-w-none",
      ref: editorRef
    }
  );
};

// src/components/chatbot/document-skeleton.tsx
import { jsx as jsx32, jsxs as jsxs16 } from "react/jsx-runtime";
var DocumentSkeleton = ({
  artifactKind
}) => {
  return artifactKind === "image" ? /* @__PURE__ */ jsx32("div", { className: "flex h-[calc(100dvh-60px)] w-full flex-col items-center justify-center gap-4", children: /* @__PURE__ */ jsx32("div", { className: "size-96 animate-pulse rounded-lg bg-muted-foreground/10" }) }) : /* @__PURE__ */ jsxs16("div", { className: "flex w-full flex-col gap-4 px-4 py-8 md:px-20 md:py-12", children: [
    /* @__PURE__ */ jsx32("div", { className: "h-8 w-2/5 animate-pulse rounded-md bg-muted-foreground/10" }),
    /* @__PURE__ */ jsx32("div", { className: "h-4 w-full animate-pulse rounded-md bg-muted-foreground/8" }),
    /* @__PURE__ */ jsx32("div", { className: "h-4 w-full animate-pulse rounded-md bg-muted-foreground/8" }),
    /* @__PURE__ */ jsx32("div", { className: "h-4 w-3/4 animate-pulse rounded-md bg-muted-foreground/8" }),
    /* @__PURE__ */ jsx32("div", { className: "h-4 w-0 rounded-md" }),
    /* @__PURE__ */ jsx32("div", { className: "h-6 w-1/3 animate-pulse rounded-md bg-muted-foreground/10" }),
    /* @__PURE__ */ jsx32("div", { className: "h-4 w-5/6 animate-pulse rounded-md bg-muted-foreground/8" }),
    /* @__PURE__ */ jsx32("div", { className: "h-4 w-2/3 animate-pulse rounded-md bg-muted-foreground/8" })
  ] });
};
var InlineDocumentSkeleton = () => {
  return /* @__PURE__ */ jsxs16("div", { className: "flex w-full flex-col gap-3", children: [
    /* @__PURE__ */ jsx32("div", { className: "h-3.5 w-48 animate-pulse rounded bg-muted-foreground/10" }),
    /* @__PURE__ */ jsx32("div", { className: "h-3.5 w-3/4 animate-pulse rounded bg-muted-foreground/8" }),
    /* @__PURE__ */ jsx32("div", { className: "h-3.5 w-1/2 animate-pulse rounded bg-muted-foreground/8" }),
    /* @__PURE__ */ jsx32("div", { className: "h-3.5 w-64 animate-pulse rounded bg-muted-foreground/8" }),
    /* @__PURE__ */ jsx32("div", { className: "h-3.5 w-40 animate-pulse rounded bg-muted-foreground/8" })
  ] });
};

// src/components/chatbot/text-editor.tsx
import { exampleSetup } from "prosemirror-example-setup";
import { inputRules } from "prosemirror-inputrules";
import { EditorState as EditorState3 } from "prosemirror-state";
import { DecorationSet as DecorationSet3, EditorView as EditorView3 } from "prosemirror-view";
import { memo as memo5, useCallback as useCallback5, useEffect as useEffect11, useRef as useRef6, useState as useState11 } from "react";
import { createPortal } from "react-dom";

// lib/editor/config.ts
import { textblockTypeInputRule } from "prosemirror-inputrules";
import { Schema as Schema2 } from "prosemirror-model";
import { schema as schema2 } from "prosemirror-schema-basic";
import { addListNodes as addListNodes2 } from "prosemirror-schema-list";

// lib/editor/functions.tsx
import { defaultMarkdownSerializer } from "prosemirror-markdown";
import { DOMParser as DOMParser2 } from "prosemirror-model";
import { Decoration, DecorationSet } from "prosemirror-view";
import { renderToString as renderToString2 } from "react-dom/server";
import { jsx as jsx33 } from "react/jsx-runtime";
var buildDocumentFromContent = (content) => {
  const parser = DOMParser2.fromSchema(documentSchema);
  const stringFromMarkdown = renderToString2(
    /* @__PURE__ */ jsx33(MessageResponse, { children: content })
  );
  const tempContainer = document.createElement("div");
  tempContainer.innerHTML = stringFromMarkdown;
  return parser.parse(tempContainer);
};
var buildContentFromDocument = (document3) => {
  return defaultMarkdownSerializer.serialize(document3);
};
var createDecorations = (suggestions2, _view) => {
  const decorations = [];
  for (const suggestion2 of suggestions2) {
    decorations.push(
      Decoration.inline(
        suggestion2.selectionStart,
        suggestion2.selectionEnd,
        {
          class: "suggestion-highlight",
          "data-suggestion-id": suggestion2.id
        },
        {
          suggestionId: suggestion2.id,
          type: "highlight"
        }
      )
    );
  }
  return DecorationSet.create(_view.state.doc, decorations);
};

// lib/editor/config.ts
var documentSchema = new Schema2({
  nodes: addListNodes2(schema2.spec.nodes, "paragraph block*", "block"),
  marks: schema2.spec.marks
});
function headingRule(level) {
  return textblockTypeInputRule(
    new RegExp(`^(#{1,${level}})\\s$`),
    documentSchema.nodes.heading,
    () => ({ level })
  );
}
var handleTransaction = ({
  transaction,
  editorRef,
  onSaveContent
}) => {
  if (!editorRef?.current) {
    return;
  }
  const newState = editorRef.current.state.apply(transaction);
  editorRef.current.updateState(newState);
  if (transaction.docChanged && !transaction.getMeta("no-save")) {
    const updatedContent = buildContentFromDocument(newState.doc);
    if (transaction.getMeta("no-debounce")) {
      onSaveContent(updatedContent, false);
    } else {
      onSaveContent(updatedContent, true);
    }
  }
};

// lib/editor/suggestions.tsx
import { Plugin, PluginKey } from "prosemirror-state";
import { DecorationSet as DecorationSet2 } from "prosemirror-view";
function findPositionsInDoc(doc, searchText) {
  let positions = null;
  doc.nodesBetween(0, doc.content.size, (node, pos) => {
    if (node.isText && node.text) {
      const index = node.text.indexOf(searchText);
      if (index !== -1) {
        positions = {
          start: pos + index,
          end: pos + index + searchText.length
        };
        return false;
      }
    }
    return true;
  });
  return positions;
}
function projectWithPositions(doc, suggestions2) {
  return suggestions2.map((suggestion2) => {
    const positions = findPositionsInDoc(doc, suggestion2.originalText);
    if (!positions) {
      return {
        ...suggestion2,
        selectionStart: 0,
        selectionEnd: 0
      };
    }
    return {
      ...suggestion2,
      selectionStart: positions.start,
      selectionEnd: positions.end
    };
  });
}
var suggestionsPluginKey = new PluginKey("suggestions");
var suggestionsPlugin = new Plugin({
  key: suggestionsPluginKey,
  state: {
    init() {
      return { decorations: DecorationSet2.empty, selected: null };
    },
    apply(tr, state) {
      const newDecorations = tr.getMeta(suggestionsPluginKey);
      if (newDecorations) {
        return newDecorations;
      }
      return {
        decorations: state.decorations.map(tr.mapping, tr.doc),
        selected: state.selected
      };
    }
  },
  props: {
    decorations(state) {
      return this.getState(state)?.decorations ?? DecorationSet2.empty;
    },
    handleDOMEvents: {
      mousedown(_view, event) {
        const target = event.target;
        if (target.closest(".suggestion-highlight")) {
          event.preventDefault();
          return true;
        }
        return false;
      }
    }
  }
});

// src/components/chatbot/suggestion.tsx
import { AnimatePresence, motion as motion2 } from "framer-motion";
import { jsx as jsx34, jsxs as jsxs17 } from "react/jsx-runtime";
var SuggestionDialog = ({
  suggestion: suggestion2,
  onApply,
  onClose
}) => {
  return /* @__PURE__ */ jsx34(AnimatePresence, { children: /* @__PURE__ */ jsxs17("div", { className: "sticky inset-0 z-40 h-full w-full", children: [
    /* @__PURE__ */ jsx34(
      "div",
      {
        "aria-hidden": "true",
        className: "absolute inset-0 bg-black/20 backdrop-blur-[2px]",
        onClick: onClose,
        onKeyDown: (e) => {
          if (e.key === "Escape") {
            onClose();
          }
        },
        role: "presentation"
      }
    ),
    /* @__PURE__ */ jsxs17(
      motion2.div,
      {
        animate: { opacity: 1, scale: 1 },
        className: "absolute left-1/2 top-1/2 z-50 flex w-[min(20rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-2xl border bg-background p-4 font-sans text-sm shadow-xl",
        exit: { opacity: 0, scale: 0.95 },
        initial: { opacity: 0, scale: 0.95 },
        transition: { duration: 0.15 },
        children: [
          /* @__PURE__ */ jsxs17("div", { className: "flex flex-row items-center justify-between", children: [
            /* @__PURE__ */ jsxs17("div", { className: "flex flex-row items-center gap-2", children: [
              /* @__PURE__ */ jsx34("div", { className: "flex size-5 items-center justify-center rounded-md bg-muted/60 text-muted-foreground ring-1 ring-border/50", children: /* @__PURE__ */ jsx34(SparklesIcon, { size: 10 }) }),
              /* @__PURE__ */ jsx34("div", { className: "font-medium", children: "Suggestion" })
            ] }),
            /* @__PURE__ */ jsx34(
              "button",
              {
                className: "flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                onClick: onClose,
                type: "button",
                children: /* @__PURE__ */ jsx34(CrossIcon, { size: 12 })
              }
            )
          ] }),
          /* @__PURE__ */ jsx34("div", { className: "text-muted-foreground leading-relaxed", children: suggestion2.description }),
          /* @__PURE__ */ jsxs17("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsx34(
              Button,
              {
                className: "w-fit rounded-full px-3 py-1.5",
                onClick: onApply,
                variant: "outline",
                children: "Apply"
              }
            ),
            /* @__PURE__ */ jsx34(
              Button,
              {
                className: "w-fit rounded-full px-3 py-1.5",
                onClick: onClose,
                variant: "ghost",
                children: "Dismiss"
              }
            )
          ] })
        ]
      },
      suggestion2.id
    )
  ] }) });
};

// src/components/chatbot/text-editor.tsx
import { Fragment as Fragment6, jsx as jsx35, jsxs as jsxs18 } from "react/jsx-runtime";
function PureEditor({
  content,
  onSaveContent,
  suggestions: suggestions2,
  status
}) {
  const containerRef = useRef6(null);
  const editorRef = useRef6(null);
  const [activeSuggestion, setActiveSuggestion] = useState11(
    null
  );
  const suggestionsRef = useRef6([]);
  useEffect11(() => {
    if (containerRef.current && !editorRef.current) {
      const state = EditorState3.create({
        doc: buildDocumentFromContent(content),
        plugins: [
          ...exampleSetup({ schema: documentSchema, menuBar: false }),
          inputRules({
            rules: [
              headingRule(1),
              headingRule(2),
              headingRule(3),
              headingRule(4),
              headingRule(5),
              headingRule(6)
            ]
          }),
          suggestionsPlugin
        ]
      });
      editorRef.current = new EditorView3(containerRef.current, {
        state,
        handleDOMEvents: {
          click(_view, event) {
            const target = event.target;
            const highlight = target.closest(".suggestion-highlight");
            if (highlight) {
              const id = highlight.getAttribute("data-suggestion-id");
              const found = suggestionsRef.current.find((s) => s.id === id);
              if (found) {
                setActiveSuggestion(found);
              }
              return true;
            }
            return false;
          }
        }
      });
    }
    return () => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
    };
  }, [content]);
  useEffect11(() => {
    if (editorRef.current) {
      editorRef.current.setProps({
        dispatchTransaction: (transaction) => {
          handleTransaction({
            transaction,
            editorRef,
            onSaveContent
          });
        }
      });
    }
  }, [onSaveContent]);
  useEffect11(() => {
    if (editorRef.current && content) {
      const currentContent = buildContentFromDocument(
        editorRef.current.state.doc
      );
      if (status === "streaming") {
        const newDocument = buildDocumentFromContent(content);
        const transaction = editorRef.current.state.tr.replaceWith(
          0,
          editorRef.current.state.doc.content.size,
          newDocument.content
        );
        transaction.setMeta("no-save", true);
        editorRef.current.dispatch(transaction);
        return;
      }
      if (currentContent !== content) {
        const newDocument = buildDocumentFromContent(content);
        const transaction = editorRef.current.state.tr.replaceWith(
          0,
          editorRef.current.state.doc.content.size,
          newDocument.content
        );
        transaction.setMeta("no-save", true);
        editorRef.current.dispatch(transaction);
      }
    }
  }, [content, status]);
  useEffect11(() => {
    if (editorRef.current?.state.doc && content) {
      const projectedSuggestions = projectWithPositions(
        editorRef.current.state.doc,
        suggestions2
      ).filter(
        (suggestion2) => suggestion2.selectionStart && suggestion2.selectionEnd
      );
      suggestionsRef.current = projectedSuggestions;
      const decorations = createDecorations(
        projectedSuggestions,
        editorRef.current
      );
      const transaction = editorRef.current.state.tr;
      transaction.setMeta(suggestionsPluginKey, { decorations });
      editorRef.current.dispatch(transaction);
    }
  }, [suggestions2, content]);
  const handleApply = useCallback5(() => {
    if (!editorRef.current || !activeSuggestion) {
      return;
    }
    const { state, dispatch } = editorRef.current;
    const currentState = suggestionsPluginKey.getState(state);
    const currentDecorations = currentState?.decorations;
    if (currentDecorations) {
      const newDecorations = DecorationSet3.create(
        state.doc,
        currentDecorations.find().filter((decoration) => {
          return decoration.spec.suggestionId !== activeSuggestion.id;
        })
      );
      const decorationTransaction = state.tr;
      decorationTransaction.setMeta(suggestionsPluginKey, {
        decorations: newDecorations,
        selected: null
      });
      dispatch(decorationTransaction);
    }
    const textTransaction = editorRef.current.state.tr.replaceWith(
      activeSuggestion.selectionStart,
      activeSuggestion.selectionEnd,
      state.schema.text(activeSuggestion.suggestedText)
    );
    textTransaction.setMeta("no-debounce", true);
    dispatch(textTransaction);
    setActiveSuggestion(null);
  }, [activeSuggestion]);
  return /* @__PURE__ */ jsxs18(Fragment6, { children: [
    /* @__PURE__ */ jsx35(
      "div",
      {
        className: "prose dark:prose-invert prose-neutral relative max-w-none",
        ref: containerRef
      }
    ),
    activeSuggestion && containerRef.current?.closest("[data-slot='artifact-content']") && createPortal(
      /* @__PURE__ */ jsx35(
        SuggestionDialog,
        {
          onApply: handleApply,
          onClose: () => setActiveSuggestion(null),
          suggestion: activeSuggestion
        }
      ),
      containerRef.current.closest(
        "[data-slot='artifact-content']"
      )
    )
  ] });
}
function areEqual2(prevProps, nextProps) {
  return prevProps.suggestions === nextProps.suggestions && prevProps.currentVersionIndex === nextProps.currentVersionIndex && prevProps.isCurrentVersion === nextProps.isCurrentVersion && !(prevProps.status === "streaming" && nextProps.status === "streaming") && prevProps.content === nextProps.content && prevProps.onSaveContent === nextProps.onSaveContent;
}
var Editor = memo5(PureEditor, areEqual2);

// lib/db/queries.ts
import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// lib/db/schema.ts
import {
  boolean,
  foreignKey,
  json,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar
} from "drizzle-orm/pg-core";
var user = pgTable("User", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  email: varchar("email", { length: 64 }).notNull(),
  password: varchar("password", { length: 64 }),
  name: text("name"),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  isAnonymous: boolean("isAnonymous").notNull().default(false),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow()
});
var chat = pgTable("Chat", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  createdAt: timestamp("createdAt").notNull(),
  title: text("title").notNull(),
  userId: uuid("userId").notNull().references(() => user.id),
  visibility: varchar("visibility", { enum: ["public", "private"] }).notNull().default("private")
});
var message = pgTable("Message_v2", {
  id: uuid("id").primaryKey().notNull().defaultRandom(),
  chatId: uuid("chatId").notNull().references(() => chat.id),
  role: varchar("role").notNull(),
  parts: json("parts").notNull(),
  attachments: json("attachments").notNull(),
  createdAt: timestamp("createdAt").notNull()
});
var vote = pgTable(
  "Vote_v2",
  {
    chatId: uuid("chatId").notNull().references(() => chat.id),
    messageId: uuid("messageId").notNull().references(() => message.id),
    isUpvoted: boolean("isUpvoted").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.chatId, table.messageId] })
  })
);
var document2 = pgTable(
  "Document",
  {
    id: uuid("id").notNull().defaultRandom(),
    createdAt: timestamp("createdAt").notNull(),
    title: text("title").notNull(),
    content: text("content"),
    kind: varchar("text", { enum: ["text", "code", "image", "sheet"] }).notNull().default("text"),
    userId: uuid("userId").notNull().references(() => user.id)
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id, table.createdAt] })
  })
);
var suggestion = pgTable(
  "Suggestion",
  {
    id: uuid("id").notNull().defaultRandom(),
    documentId: uuid("documentId").notNull(),
    documentCreatedAt: timestamp("documentCreatedAt").notNull(),
    originalText: text("originalText").notNull(),
    suggestedText: text("suggestedText").notNull(),
    description: text("description"),
    isResolved: boolean("isResolved").notNull().default(false),
    userId: uuid("userId").notNull().references(() => user.id),
    createdAt: timestamp("createdAt").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    documentRef: foreignKey({
      columns: [table.documentId, table.documentCreatedAt],
      foreignColumns: [document2.id, document2.createdAt]
    })
  })
);
var stream = pgTable(
  "Stream",
  {
    id: uuid("id").notNull().defaultRandom(),
    chatId: uuid("chatId").notNull(),
    createdAt: timestamp("createdAt").notNull()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.id] }),
    chatRef: foreignKey({
      columns: [table.chatId],
      foreignColumns: [chat.id]
    })
  })
);

// lib/db/utils.ts
import { generateId } from "ai";
import { genSaltSync, hashSync } from "bcrypt-ts";
function generateHashedPassword(password) {
  const salt = genSaltSync(10);
  const hash = hashSync(password, salt);
  return hash;
}
function generateDummyPassword() {
  const password = generateId();
  const hashedPassword = generateHashedPassword(password);
  return hashedPassword;
}

// lib/db/queries.ts
var client = postgres(process.env.POSTGRES_URL ?? "");
var db = drizzle(client);
async function getSuggestionsByDocumentId({
  documentId
}) {
  try {
    return await db.select().from(suggestion).where(eq(suggestion.documentId, documentId));
  } catch (_error) {
    throw new ChatbotError(
      "bad_request:database",
      "Failed to get suggestions by document id"
    );
  }
}

// src/artifacts/actions.ts
async function getSuggestions({ documentId }) {
  const suggestions2 = await getSuggestionsByDocumentId({ documentId });
  return suggestions2 ?? [];
}

// src/artifacts/text/client.tsx
import { jsx as jsx36, jsxs as jsxs19 } from "react/jsx-runtime";
var textArtifact = new Artifact({
  kind: "text",
  description: "Useful for text content, like drafting essays and emails.",
  initialize: async ({ documentId, setMetadata }) => {
    const suggestions2 = await getSuggestions({ documentId });
    setMetadata({
      suggestions: suggestions2
    });
  },
  onStreamPart: ({ streamPart, setMetadata, setArtifact }) => {
    if (streamPart.type === "data-suggestion") {
      setMetadata((metadata) => {
        return {
          suggestions: [...metadata.suggestions, streamPart.data]
        };
      });
    }
    if (streamPart.type === "data-textDelta") {
      setArtifact((draftArtifact) => {
        return {
          ...draftArtifact,
          content: draftArtifact.content + streamPart.data,
          isVisible: draftArtifact.status === "streaming" && draftArtifact.content.length > 400 && draftArtifact.content.length < 450 ? true : draftArtifact.isVisible,
          status: "streaming"
        };
      });
    }
  },
  content: ({
    mode,
    status,
    content,
    isCurrentVersion,
    currentVersionIndex,
    onSaveContent,
    getDocumentContentById,
    isLoading,
    metadata
  }) => {
    if (isLoading) {
      return /* @__PURE__ */ jsx36(DocumentSkeleton, { artifactKind: "text" });
    }
    if (mode === "diff") {
      const selectedContent = getDocumentContentById(currentVersionIndex);
      const prevContent = currentVersionIndex > 0 ? getDocumentContentById(currentVersionIndex - 1) : selectedContent;
      return /* @__PURE__ */ jsx36("div", { className: "flex flex-row px-4 py-8 md:px-16 md:py-12 lg:px-20", children: /* @__PURE__ */ jsx36(DiffView, { newContent: selectedContent, oldContent: prevContent }) });
    }
    return /* @__PURE__ */ jsxs19("div", { className: "flex flex-row px-4 py-8 md:px-16 md:py-12 lg:px-20", children: [
      /* @__PURE__ */ jsx36(
        Editor,
        {
          content,
          currentVersionIndex,
          isCurrentVersion,
          onSaveContent,
          status,
          suggestions: isCurrentVersion && metadata ? metadata.suggestions : []
        }
      ),
      metadata?.suggestions && metadata.suggestions.length > 0 ? /* @__PURE__ */ jsx36("div", { className: "h-dvh w-12 shrink-0 md:hidden" }) : null
    ] });
  },
  actions: [
    {
      icon: /* @__PURE__ */ jsx36(ClockRewind, { size: 18 }),
      description: "View changes",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("toggle");
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx36(UndoIcon, { size: 18 }),
      description: "View Previous version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("prev");
      },
      isDisabled: ({ currentVersionIndex }) => {
        if (currentVersionIndex === 0) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx36(RedoIcon, { size: 18 }),
      description: "View Next version",
      onClick: ({ handleVersionChange }) => {
        handleVersionChange("next");
      },
      isDisabled: ({ isCurrentVersion }) => {
        if (isCurrentVersion) {
          return true;
        }
        return false;
      }
    },
    {
      icon: /* @__PURE__ */ jsx36(CopyIcon, { size: 18 }),
      description: "Copy to clipboard",
      onClick: ({ content }) => {
        navigator.clipboard.writeText(content);
        toast7.success("Copied to clipboard!");
      }
    }
  ],
  toolbar: [
    {
      icon: /* @__PURE__ */ jsx36(PenIcon, {}),
      description: "Add final polish",
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: "user",
          parts: [
            {
              type: "text",
              text: "Please add final polish and check for grammar, add section titles for better structure, and ensure everything reads smoothly."
            }
          ]
        });
      }
    },
    {
      icon: /* @__PURE__ */ jsx36(MessageIcon, {}),
      description: "Request suggestions",
      onClick: ({ sendMessage }) => {
        sendMessage({
          role: "user",
          parts: [
            {
              type: "text",
              text: "Please add suggestions you have that could improve the writing."
            }
          ]
        });
      }
    }
  ]
});

// src/components/chatbot/artifact-actions.tsx
import { memo as memo6, useState as useState12 } from "react";
import { toast as toast8 } from "sonner";
import { jsx as jsx37, jsxs as jsxs20 } from "react/jsx-runtime";
function PureArtifactActions({
  artifact,
  handleVersionChange,
  currentVersionIndex,
  isCurrentVersion,
  mode,
  metadata,
  setMetadata
}) {
  const [isLoading, setIsLoading] = useState12(false);
  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );
  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }
  const actionContext = {
    content: artifact.content,
    handleVersionChange,
    currentVersionIndex,
    isCurrentVersion,
    mode,
    metadata,
    setMetadata
  };
  return /* @__PURE__ */ jsx37("div", { className: "flex flex-col items-center gap-0.5", children: artifactDefinition.actions.map((action) => {
    const disabled = isLoading || artifact.status === "streaming" ? true : action.isDisabled ? action.isDisabled(actionContext) : false;
    return /* @__PURE__ */ jsxs20(Tooltip, { children: [
      /* @__PURE__ */ jsx37(TooltipTrigger, { asChild: true, children: /* @__PURE__ */ jsx37(
        "button",
        {
          className: cn(
            "flex items-center justify-center rounded-full p-3 text-muted-foreground transition-all duration-150",
            "hover:text-foreground",
            "active:scale-95",
            "disabled:pointer-events-none disabled:opacity-30",
            {
              "text-foreground": mode === "diff" && action.description === "View changes"
            }
          ),
          disabled,
          onClick: async () => {
            setIsLoading(true);
            try {
              await Promise.resolve(action.onClick(actionContext));
            } catch (_error) {
              toast8.error("Failed to execute action");
            } finally {
              setIsLoading(false);
            }
          },
          type: "button",
          children: action.icon
        }
      ) }),
      /* @__PURE__ */ jsx37(TooltipContent, { side: "left", sideOffset: 8, children: action.description })
    ] }, action.description);
  }) });
}
var ArtifactActions = memo6(
  PureArtifactActions,
  (prevProps, nextProps) => {
    if (prevProps.artifact.status !== nextProps.artifact.status) {
      return false;
    }
    if (prevProps.currentVersionIndex !== nextProps.currentVersionIndex) {
      return false;
    }
    if (prevProps.isCurrentVersion !== nextProps.isCurrentVersion) {
      return false;
    }
    if (prevProps.artifact.content !== nextProps.artifact.content) {
      return false;
    }
    if (prevProps.mode !== nextProps.mode) {
      return false;
    }
    return true;
  }
);

// src/components/chatbot/artifact-close-button.tsx
import { memo as memo7 } from "react";
import { jsx as jsx38 } from "react/jsx-runtime";
function PureArtifactCloseButton() {
  const { setArtifact } = useArtifact();
  return /* @__PURE__ */ jsx38(
    "button",
    {
      className: "group flex size-8 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-all duration-150 hover:border-border hover:bg-muted hover:text-foreground active:scale-95",
      "data-testid": "artifact-close-button",
      onClick: () => {
        setArtifact(
          (currentArtifact) => currentArtifact.status === "streaming" ? {
            ...currentArtifact,
            isVisible: false
          } : { ...initialArtifactData, status: "idle" }
        );
      },
      type: "button",
      children: /* @__PURE__ */ jsx38(CrossIcon, { size: 16 })
    }
  );
}
var ArtifactCloseButton = memo7(PureArtifactCloseButton, () => true);

// src/components/chatbot/toolbar.tsx
import cx from "classnames";
import { motion as motion3, useMotionValue, useTransform } from "framer-motion";
import { WrenchIcon, XIcon as XIcon2 } from "lucide-react";
import { nanoid } from "nanoid";
import {
  memo as memo8,
  useEffect as useEffect12,
  useRef as useRef7,
  useState as useState13
} from "react";
import { useOnClickOutside } from "usehooks-ts";
import { Fragment as Fragment7, jsx as jsx39, jsxs as jsxs21 } from "react/jsx-runtime";
var Tool = ({
  description,
  icon,
  selectedTool,
  setSelectedTool,
  isToolbarVisible,
  setIsToolbarVisible,
  isAnimating,
  sendMessage,
  onClick
}) => {
  const [isHovered, setIsHovered] = useState13(false);
  useEffect12(() => {
    if (selectedTool !== description) {
      setIsHovered(false);
    }
  }, [selectedTool, description]);
  const handleSelect = () => {
    if (!isToolbarVisible && setIsToolbarVisible) {
      setIsToolbarVisible(true);
      return;
    }
    if (!selectedTool) {
      setIsHovered(true);
      setSelectedTool(description);
      return;
    }
    if (selectedTool === description) {
      setSelectedTool(null);
      onClick({ sendMessage });
    } else {
      setSelectedTool(description);
    }
  };
  return /* @__PURE__ */ jsxs21(Tooltip, { open: isHovered && !isAnimating, children: [
    /* @__PURE__ */ jsx39(TooltipTrigger, { asChild: true, children: /* @__PURE__ */ jsx39(
      motion3.div,
      {
        animate: { opacity: 1, transition: { delay: 0.1 } },
        className: cx("rounded-full p-3", {
          "bg-primary text-primary-foreground!": selectedTool === description
        }),
        exit: {
          scale: 0.9,
          opacity: 0,
          transition: { duration: 0.1 }
        },
        initial: { scale: 1, opacity: 0 },
        onClick: () => {
          handleSelect();
        },
        onHoverEnd: () => {
          if (selectedTool !== description) {
            setIsHovered(false);
          }
        },
        onHoverStart: () => {
          setIsHovered(true);
        },
        onKeyDown: (event) => {
          if (event.key === "Enter") {
            handleSelect();
          }
        },
        whileHover: { scale: 1.1 },
        whileTap: { scale: 0.95 },
        children: selectedTool === description ? /* @__PURE__ */ jsx39(ArrowUpIcon, {}) : icon
      }
    ) }),
    /* @__PURE__ */ jsx39(
      TooltipContent,
      {
        className: "rounded-2xl bg-foreground p-3 px-4 text-background",
        side: "left",
        sideOffset: 16,
        children: description
      }
    )
  ] });
};
var randomArr = [...new Array(6)].map((_x) => nanoid(5));
var ReadingLevelSelector = ({
  setSelectedTool,
  sendMessage,
  isAnimating
}) => {
  const LEVELS = [
    "Elementary",
    "Middle School",
    "Keep current level",
    "High School",
    "College",
    "Graduate"
  ];
  const y = useMotionValue(-40 * 2);
  const dragConstraints = 5 * 40 + 2;
  const yToLevel = useTransform(y, [0, -dragConstraints], [0, 5]);
  const [currentLevel, setCurrentLevel] = useState13(2);
  const [hasUserSelectedLevel, setHasUserSelectedLevel] = useState13(false);
  useEffect12(() => {
    const unsubscribe = yToLevel.on("change", (latest) => {
      const level = Math.min(5, Math.max(0, Math.round(Math.abs(latest))));
      setCurrentLevel(level);
    });
    return () => unsubscribe();
  }, [yToLevel]);
  return /* @__PURE__ */ jsxs21("div", { className: "relative flex flex-col items-center justify-end", children: [
    randomArr.map((id) => /* @__PURE__ */ jsx39(
      motion3.div,
      {
        animate: { opacity: 1 },
        className: "flex size-[40px] flex-row items-center justify-center",
        exit: { opacity: 0 },
        initial: { opacity: 0 },
        transition: { delay: 0.1 },
        children: /* @__PURE__ */ jsx39("div", { className: "size-2 rounded-full bg-muted-foreground/40" })
      },
      id
    )),
    /* @__PURE__ */ jsx39(TooltipProvider, { children: /* @__PURE__ */ jsxs21(Tooltip, { open: !isAnimating, children: [
      /* @__PURE__ */ jsx39(TooltipTrigger, { asChild: true, children: /* @__PURE__ */ jsx39(
        motion3.div,
        {
          className: cx(
            "absolute flex flex-row items-center rounded-full border bg-background p-3",
            {
              "bg-primary text-primary-foreground": currentLevel !== 2,
              "bg-background text-foreground": currentLevel === 2
            }
          ),
          drag: "y",
          dragConstraints: { top: -dragConstraints, bottom: 0 },
          dragElastic: 0,
          dragMomentum: false,
          onClick: () => {
            if (currentLevel !== 2 && hasUserSelectedLevel) {
              sendMessage({
                role: "user",
                parts: [
                  {
                    type: "text",
                    text: `Please adjust the reading level to ${LEVELS[currentLevel]} level.`
                  }
                ]
              });
              setSelectedTool(null);
            }
          },
          onDragEnd: () => {
            if (currentLevel === 2) {
              setSelectedTool(null);
            } else {
              setHasUserSelectedLevel(true);
            }
          },
          onDragStart: () => {
            setHasUserSelectedLevel(false);
          },
          style: { y },
          transition: { duration: 0.1 },
          whileHover: { scale: 1.05 },
          whileTap: { scale: 0.95 },
          children: currentLevel === 2 ? /* @__PURE__ */ jsx39(SummarizeIcon, {}) : /* @__PURE__ */ jsx39(ArrowUpIcon, {})
        }
      ) }),
      /* @__PURE__ */ jsx39(
        TooltipContent,
        {
          className: "rounded-2xl bg-foreground p-3 px-4 text-background text-sm",
          side: "left",
          sideOffset: 16,
          children: LEVELS[currentLevel]
        }
      )
    ] }) })
  ] });
};
var Tools = ({
  selectedTool,
  setSelectedTool,
  sendMessage,
  isAnimating,
  tools
}) => {
  return /* @__PURE__ */ jsx39(
    motion3.div,
    {
      animate: { opacity: 1, scale: 1 },
      className: "flex flex-col gap-1.5",
      exit: { opacity: 0, scale: 0.95 },
      initial: { opacity: 0, scale: 0.95 },
      children: [...tools].reverse().map((tool2) => /* @__PURE__ */ jsx39(
        Tool,
        {
          description: tool2.description,
          icon: tool2.icon,
          isAnimating,
          onClick: tool2.onClick,
          selectedTool,
          sendMessage,
          setSelectedTool
        },
        tool2.description
      ))
    }
  );
};
var createFixErrorTool = (consoleOutput, documentId) => ({
  icon: /* @__PURE__ */ jsx39(WrenchIcon, { className: "size-4" }),
  description: "Fix error",
  onClick: ({ sendMessage: send }) => {
    send({
      role: "user",
      parts: [
        {
          type: "text",
          text: `Fix the error in the existing script${documentId ? ` (id: ${documentId})` : ""} using updateDocument. Do not create a new script. Console error:

${consoleOutput}`
        }
      ]
    });
  }
});
var PureToolbar = ({
  isToolbarVisible: _isToolbarVisible,
  setIsToolbarVisible,
  sendMessage,
  status,
  stop,
  setMessages,
  artifactKind,
  consoleError,
  documentId,
  artifactActions,
  onClose
}) => {
  const toolbarRef = useRef7(null);
  const timeoutRef = useRef7();
  const [selectedTool, setSelectedTool] = useState13(null);
  const [isAnimating, setIsAnimating] = useState13(false);
  useOnClickOutside(toolbarRef, () => {
    setIsToolbarVisible(false);
    setSelectedTool(null);
  });
  const startCloseTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setSelectedTool(null);
      setIsToolbarVisible(false);
    }, 2e3);
  };
  const cancelCloseTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
  };
  useEffect12(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);
  useEffect12(() => {
    if (status === "streaming") {
      setIsToolbarVisible(false);
    }
  }, [status, setIsToolbarVisible]);
  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifactKind
  );
  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }
  const toolsByArtifactKind = consoleError ? [
    createFixErrorTool(consoleError, documentId),
    ...artifactDefinition.toolbar.slice(1)
  ] : artifactDefinition.toolbar;
  if (toolsByArtifactKind.length === 0) {
    return null;
  }
  return /* @__PURE__ */ jsx39(TooltipProvider, { delayDuration: 0, children: /* @__PURE__ */ jsxs21(
    motion3.div,
    {
      animate: { opacity: 1, y: 0, scale: 1 },
      className: "fixed right-6 bottom-6 z-50 flex cursor-pointer flex-col items-center rounded-3xl border bg-background py-1 shadow-lg",
      exit: { opacity: 0, y: -20, transition: { duration: 0.1 } },
      initial: { opacity: 0, y: -20, scale: 1 },
      onAnimationComplete: () => {
        setIsAnimating(false);
      },
      onAnimationStart: () => {
        setIsAnimating(true);
      },
      onHoverEnd: () => {
        if (status === "streaming") {
          return;
        }
        startCloseTimer();
      },
      onHoverStart: () => {
        if (status === "streaming") {
          return;
        }
        cancelCloseTimer();
        setIsToolbarVisible(true);
      },
      ref: toolbarRef,
      transition: { type: "spring", stiffness: 300, damping: 25 },
      children: [
        onClose && /* @__PURE__ */ jsx39(
          motion3.div,
          {
            animate: { opacity: 1 },
            className: "p-3 text-muted-foreground transition-colors hover:text-foreground",
            initial: { opacity: 0 },
            onClick: onClose,
            children: /* @__PURE__ */ jsx39(XIcon2, { className: "size-4" })
          }
        ),
        status === "streaming" ? /* @__PURE__ */ jsx39(
          motion3.div,
          {
            animate: { scale: 1.4 },
            className: "p-3",
            exit: { scale: 1 },
            initial: { scale: 1 },
            onClick: () => {
              stop();
              setMessages((messages) => messages);
            },
            children: /* @__PURE__ */ jsx39(StopIcon, {})
          },
          "stop-icon"
        ) : selectedTool === "adjust-reading-level" ? /* @__PURE__ */ jsx39(
          ReadingLevelSelector,
          {
            isAnimating,
            sendMessage,
            setSelectedTool
          },
          "reading-level-selector"
        ) : /* @__PURE__ */ jsxs21(Fragment7, { children: [
          artifactActions,
          /* @__PURE__ */ jsx39(
            Tools,
            {
              isAnimating,
              selectedTool,
              sendMessage,
              setSelectedTool,
              tools: toolsByArtifactKind
            },
            "tools"
          )
        ] })
      ]
    }
  ) });
};
var Toolbar = memo8(PureToolbar, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (prevProps.isToolbarVisible !== nextProps.isToolbarVisible) {
    return false;
  }
  if (prevProps.artifactKind !== nextProps.artifactKind) {
    return false;
  }
  if (prevProps.consoleError !== nextProps.consoleError) {
    return false;
  }
  if (prevProps.artifactActions !== nextProps.artifactActions) {
    return false;
  }
  if (prevProps.onClose !== nextProps.onClose) {
    return false;
  }
  return true;
});

// src/components/chatbot/version-footer.tsx
import { isAfter } from "date-fns";
import { motion as motion4 } from "framer-motion";
import { ChevronLeftIcon as ChevronLeftIcon2, ChevronRightIcon as ChevronRightIcon3, DiffIcon } from "lucide-react";
import { useState as useState14 } from "react";
import { useSWRConfig as useSWRConfig4 } from "swr";
import { jsx as jsx40, jsxs as jsxs22 } from "react/jsx-runtime";
var VersionFooter = ({
  handleVersionChange,
  documents,
  currentVersionIndex,
  mode,
  setMode
}) => {
  const { artifact } = useArtifact();
  const { mutate } = useSWRConfig4();
  const [isMutating, setIsMutating] = useState14(false);
  if (!documents) {
    return;
  }
  const isFirst = currentVersionIndex === 0;
  const isLast = currentVersionIndex === documents.length - 1;
  return /* @__PURE__ */ jsxs22(
    motion4.div,
    {
      animate: { opacity: 1 },
      className: "z-50 flex w-full shrink-0 items-center justify-between gap-3 border-t border-border/50 bg-background px-4 py-3",
      exit: { opacity: 0, transition: { duration: 0 } },
      initial: { opacity: 0 },
      transition: { duration: 0.2 },
      children: [
        /* @__PURE__ */ jsxs22("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsxs22("div", { className: "flex items-center gap-1", children: [
            /* @__PURE__ */ jsx40(
              "button",
              {
                className: "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
                disabled: isFirst,
                onClick: () => handleVersionChange("prev"),
                type: "button",
                children: /* @__PURE__ */ jsx40(ChevronLeftIcon2, { className: "size-4" })
              }
            ),
            /* @__PURE__ */ jsxs22("span", { className: "min-w-[4rem] text-center text-xs tabular-nums text-muted-foreground", children: [
              currentVersionIndex + 1,
              " of ",
              documents.length
            ] }),
            /* @__PURE__ */ jsx40(
              "button",
              {
                className: "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30",
                disabled: isLast,
                onClick: () => handleVersionChange("next"),
                type: "button",
                children: /* @__PURE__ */ jsx40(ChevronRightIcon3, { className: "size-4" })
              }
            )
          ] }),
          /* @__PURE__ */ jsx40(
            "button",
            {
              className: cn(
                "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                mode === "diff" && "bg-muted text-foreground"
              ),
              onClick: () => setMode(mode === "diff" ? "edit" : "diff"),
              title: "Show changes",
              type: "button",
              children: /* @__PURE__ */ jsx40(DiffIcon, { className: "size-4" })
            }
          )
        ] }),
        /* @__PURE__ */ jsxs22("div", { className: "flex flex-row gap-2", children: [
          /* @__PURE__ */ jsxs22(
            "button",
            {
              className: "inline-flex items-center justify-center gap-2 rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-all duration-150 hover:opacity-90 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
              disabled: isMutating,
              onClick: async () => {
                setIsMutating(true);
                try {
                  await mutate(
                    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`,
                    await fetch(
                      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}&timestamp=${getDocumentTimestampByIndex(
                        documents,
                        currentVersionIndex
                      )}`,
                      {
                        method: "DELETE"
                      }
                    ),
                    {
                      optimisticData: documents ? [
                        ...documents.filter(
                          (document3) => isAfter(
                            new Date(document3.createdAt),
                            new Date(
                              getDocumentTimestampByIndex(
                                documents,
                                currentVersionIndex
                              )
                            )
                          )
                        )
                      ] : []
                    }
                  );
                } finally {
                  setIsMutating(false);
                }
              },
              type: "button",
              children: [
                "Restore",
                isMutating && /* @__PURE__ */ jsx40("div", { className: "animate-spin", children: /* @__PURE__ */ jsx40(LoaderIcon, { size: 14 }) })
              ]
            }
          ),
          /* @__PURE__ */ jsx40(
            "button",
            {
              className: "inline-flex items-center justify-center rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-all duration-150 hover:bg-muted active:scale-[0.98]",
              onClick: () => {
                setMode("edit");
                handleVersionChange("latest");
              },
              type: "button",
              children: "Latest"
            }
          )
        ] })
      ]
    }
  );
};

// src/components/chatbot/artifact.tsx
import { Fragment as Fragment8, jsx as jsx41, jsxs as jsxs23 } from "react/jsx-runtime";
var artifactDefinitions = [
  textArtifact,
  codeArtifact,
  imageArtifact,
  sheetArtifact
];
function PureArtifact({
  addToolApprovalResponse: _addToolApprovalResponse,
  chatId: _chatId,
  input: _input,
  setInput: _setInput,
  status,
  stop,
  attachments: _attachments,
  setAttachments: _setAttachments,
  sendMessage,
  messages: _messages,
  setMessages,
  regenerate: _regenerate,
  votes: _votes,
  isReadonly: _isReadonly,
  selectedVisibilityType: _selectedVisibilityType,
  selectedModelId: _selectedModelId
}) {
  const { artifact, setArtifact, metadata, setMetadata } = useArtifact();
  const {
    data: documents,
    isLoading: isDocumentsFetching,
    mutate: mutateDocuments
  } = useSWR4(
    artifact.documentId !== "init" && artifact.status !== "streaming" ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}` : null,
    fetcher
  );
  const [mode, setMode] = useState15("edit");
  const [document3, setDocument] = useState15(null);
  const [currentVersionIndex, setCurrentVersionIndex] = useState15(-1);
  const { state: sidebarState } = useSidebar();
  const artifactContentRef = useRef8(null);
  const userScrolledArtifact = useRef8(false);
  const [isContentDirty, setIsContentDirty] = useState15(false);
  useEffect13(() => {
    if (artifact.status !== "streaming") {
      userScrolledArtifact.current = false;
      return;
    }
    if (userScrolledArtifact.current) {
      return;
    }
    const el = artifactContentRef.current;
    if (!el) {
      return;
    }
    el.scrollTo({ top: el.scrollHeight });
  }, [artifact.status]);
  useEffect13(() => {
    if (documents && documents.length > 0) {
      const mostRecentDocument = documents.at(-1);
      if (mostRecentDocument) {
        setDocument(mostRecentDocument);
        setCurrentVersionIndex(documents.length - 1);
        if (artifact.status === "streaming" || !isContentDirty) {
          setArtifact((currentArtifact) => ({
            ...currentArtifact,
            content: mostRecentDocument.content ?? ""
          }));
        }
      }
    }
  }, [documents, setArtifact, artifact.status, isContentDirty]);
  useEffect13(() => {
    mutateDocuments();
  }, [mutateDocuments]);
  const { mutate } = useSWRConfig5();
  const handleContentChange = useCallback6(
    (updatedContent) => {
      if (!artifact) {
        return;
      }
      mutate(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`,
        async (currentDocuments) => {
          if (!currentDocuments) {
            return [];
          }
          const currentDocument = currentDocuments.at(-1);
          if (!currentDocument?.content) {
            setIsContentDirty(false);
            return currentDocuments;
          }
          if (currentDocument.content === updatedContent) {
            setIsContentDirty(false);
            return currentDocuments;
          }
          await fetch(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${artifact.documentId}`,
            {
              method: "POST",
              body: JSON.stringify({
                title: artifact.title,
                content: updatedContent,
                kind: artifact.kind,
                isManualEdit: true
              })
            }
          );
          setIsContentDirty(false);
          return currentDocuments.map(
            (doc, i) => i === currentDocuments.length - 1 ? { ...doc, content: updatedContent } : doc
          );
        },
        { revalidate: false }
      );
    },
    [artifact, mutate]
  );
  const latestContentRef = useRef8("");
  const saveTimerRef = useRef8(null);
  const saveContent = useCallback6(
    (updatedContent, debounce) => {
      latestContentRef.current = updatedContent;
      setIsContentDirty(true);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (debounce) {
        saveTimerRef.current = setTimeout(() => {
          handleContentChange(latestContentRef.current);
          saveTimerRef.current = null;
        }, 2e3);
      } else {
        handleContentChange(updatedContent);
      }
    },
    [handleContentChange]
  );
  function getDocumentContentById(index) {
    if (!documents) {
      return "";
    }
    if (!documents[index]) {
      return "";
    }
    return documents[index].content ?? "";
  }
  const handleVersionChange = (type) => {
    if (!documents) {
      return;
    }
    if (type === "latest") {
      setCurrentVersionIndex(documents.length - 1);
      setMode("edit");
    }
    if (type === "toggle") {
      setMode((currentMode) => currentMode === "edit" ? "diff" : "edit");
    }
    if (type === "prev") {
      if (currentVersionIndex > 0) {
        setCurrentVersionIndex((index) => index - 1);
      }
    } else if (type === "next" && currentVersionIndex < documents.length - 1) {
      setCurrentVersionIndex((index) => index + 1);
    }
  };
  const [isToolbarVisible, setIsToolbarVisible] = useState15(true);
  const isCurrentVersion = documents && documents.length > 0 ? currentVersionIndex === documents.length - 1 : true;
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const isMobile = windowWidth ? windowWidth < 768 : false;
  const artifactDefinition = artifactDefinitions.find(
    (definition) => definition.kind === artifact.kind
  );
  if (!artifactDefinition) {
    throw new Error("Artifact definition not found!");
  }
  useEffect13(() => {
    if (artifact.documentId !== "init" && artifactDefinition.initialize) {
      artifactDefinition.initialize({
        documentId: artifact.documentId,
        setMetadata
      });
    }
  }, [artifact.documentId, artifactDefinition, setMetadata]);
  if (!artifact.isVisible && !isMobile) {
    return /* @__PURE__ */ jsx41(
      "div",
      {
        className: "h-dvh w-0 shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
        "data-testid": "artifact"
      }
    );
  }
  if (!artifact.isVisible) {
    return null;
  }
  const consoleError = metadata?.outputs?.filter((o) => o.status === "failed").flatMap(
    (o) => o.contents.filter((c) => c.type === "text").map((c) => c.value)
  ).join("\n") || void 0;
  const artifactPanel = /* @__PURE__ */ jsxs23(Fragment8, { children: [
    sidebarState !== "collapsed" && /* @__PURE__ */ jsx41("div", { className: "flex h-[calc(3.5rem+1px)] shrink-0 items-center justify-between border-b border-border/50 px-4", children: /* @__PURE__ */ jsxs23("div", { className: "flex items-center gap-3", children: [
      /* @__PURE__ */ jsx41(ArtifactCloseButton, {}),
      /* @__PURE__ */ jsxs23("div", { className: "flex flex-col gap-0.5", children: [
        /* @__PURE__ */ jsx41("div", { className: "text-sm font-semibold leading-tight tracking-tight", children: artifact.title }),
        /* @__PURE__ */ jsxs23("div", { className: "flex items-center gap-2", children: [
          isContentDirty ? /* @__PURE__ */ jsxs23("div", { className: "flex items-center gap-1.5 text-xs text-muted-foreground", children: [
            /* @__PURE__ */ jsx41("div", { className: "size-1.5 animate-pulse rounded-full bg-amber-500" }),
            "Saving..."
          ] }) : document3 ? /* @__PURE__ */ jsx41("div", { className: "text-xs text-muted-foreground", children: `Updated ${formatDistance(new Date(document3.createdAt), /* @__PURE__ */ new Date(), { addSuffix: true })}` }) : artifact.status === "streaming" ? /* @__PURE__ */ jsxs23("div", { className: "flex items-center gap-1.5 text-xs text-muted-foreground", children: [
            /* @__PURE__ */ jsx41("div", { className: "animate-spin", children: /* @__PURE__ */ jsx41(LoaderIcon, { size: 12 }) }),
            "Generating..."
          ] }) : /* @__PURE__ */ jsx41("div", { className: "h-3 w-24 animate-pulse rounded bg-muted-foreground/10" }),
          documents && documents.length > 1 && /* @__PURE__ */ jsxs23("div", { className: "rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground", children: [
            "v",
            currentVersionIndex + 1,
            "/",
            documents.length
          ] })
        ] })
      ] })
    ] }) }),
    /* @__PURE__ */ jsxs23(
      "div",
      {
        className: "relative flex-1 overflow-y-auto bg-background",
        "data-slot": "artifact-content",
        onScroll: () => {
          const el = artifactContentRef.current;
          if (!el) {
            return;
          }
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          userScrolledArtifact.current = !atBottom;
        },
        ref: artifactContentRef,
        children: [
          /* @__PURE__ */ jsx41(
            artifactDefinition.content,
            {
              content: isCurrentVersion ? artifact.content : getDocumentContentById(currentVersionIndex),
              currentVersionIndex,
              getDocumentContentById,
              isCurrentVersion,
              isInline: false,
              isLoading: isDocumentsFetching && !artifact.content,
              metadata,
              mode,
              onSaveContent: saveContent,
              setMetadata,
              status: artifact.status,
              suggestions: [],
              title: artifact.title
            }
          ),
          /* @__PURE__ */ jsx41(AnimatePresence2, { children: isCurrentVersion && /* @__PURE__ */ jsx41(
            Toolbar,
            {
              artifactActions: /* @__PURE__ */ jsx41(
                ArtifactActions,
                {
                  artifact,
                  currentVersionIndex,
                  handleVersionChange,
                  isCurrentVersion,
                  metadata,
                  mode,
                  setMetadata
                }
              ),
              artifactKind: artifact.kind,
              consoleError,
              documentId: artifact.documentId,
              isToolbarVisible,
              onClose: () => {
                setArtifact((prev) => ({ ...prev, isVisible: false }));
              },
              sendMessage,
              setIsToolbarVisible,
              setMessages,
              status,
              stop
            }
          ) })
        ]
      }
    ),
    /* @__PURE__ */ jsx41(AnimatePresence2, { children: !isCurrentVersion && /* @__PURE__ */ jsx41(
      VersionFooter,
      {
        currentVersionIndex,
        documents,
        handleVersionChange,
        mode,
        setMode
      }
    ) })
  ] });
  if (isMobile) {
    return /* @__PURE__ */ jsx41(
      motion5.div,
      {
        animate: {
          opacity: 1,
          x: 0,
          y: 0,
          height: windowHeight,
          width: "100dvw",
          borderRadius: 0
        },
        className: "fixed inset-0 z-50 flex h-dvh flex-col overflow-hidden bg-sidebar",
        "data-testid": "artifact",
        exit: { opacity: 0, scale: 0.95 },
        initial: {
          opacity: 1,
          x: artifact.boundingBox.left,
          y: artifact.boundingBox.top,
          height: artifact.boundingBox.height,
          width: artifact.boundingBox.width,
          borderRadius: 50
        },
        transition: { type: "spring", stiffness: 300, damping: 30 },
        children: artifactPanel
      }
    );
  }
  return /* @__PURE__ */ jsx41(
    "div",
    {
      className: "flex h-dvh w-[60%] shrink-0 flex-col overflow-hidden border-l border-border/50 bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
      "data-testid": "artifact",
      children: artifactPanel
    }
  );
}
var Artifact2 = memo9(PureArtifact, (prevProps, nextProps) => {
  if (prevProps.status !== nextProps.status) {
    return false;
  }
  if (!equal(prevProps.votes, nextProps.votes)) {
    return false;
  }
  if (prevProps.input !== nextProps.input) {
    return false;
  }
  if (prevProps.messages.length !== nextProps.messages.length) {
    return false;
  }
  if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
    return false;
  }
  return true;
});

// src/components/chatbot/chat-header.tsx
import { PanelLeftIcon as PanelLeftIcon3 } from "lucide-react";
import Link3 from "next/link";
import { memo as memo10 } from "react";

// src/components/chatbot/visibility-selector.tsx
import { useMemo as useMemo8, useState as useState16 } from "react";
import { jsx as jsx42, jsxs as jsxs24 } from "react/jsx-runtime";
var visibilities = [
  {
    id: "private",
    label: "Private",
    description: "Only you can access this chat",
    icon: /* @__PURE__ */ jsx42(LockIcon, {})
  },
  {
    id: "public",
    label: "Public",
    description: "Anyone with the link can access this chat",
    icon: /* @__PURE__ */ jsx42(GlobeIcon, {})
  }
];
function VisibilitySelector({
  chatId,
  className,
  selectedVisibilityType
}) {
  const [open, setOpen] = useState16(false);
  const { visibilityType, setVisibilityType } = useChatVisibility({
    chatId,
    initialVisibilityType: selectedVisibilityType
  });
  const selectedVisibility = useMemo8(
    () => visibilities.find((visibility) => visibility.id === visibilityType),
    [visibilityType]
  );
  return /* @__PURE__ */ jsxs24(DropdownMenu, { onOpenChange: setOpen, open, children: [
    /* @__PURE__ */ jsx42(
      DropdownMenuTrigger,
      {
        asChild: true,
        className: cn(
          "w-fit data-[state=open]:bg-accent data-[state=open]:text-accent-foreground",
          className
        ),
        children: /* @__PURE__ */ jsxs24(
          Button,
          {
            className: "gap-1.5 rounded-lg border-border/50 text-muted-foreground shadow-none transition-colors hover:text-foreground focus-visible:ring-0 focus-visible:border-border/50 active:translate-y-0",
            "data-testid": "visibility-selector",
            size: "sm",
            variant: "outline",
            children: [
              selectedVisibility?.icon,
              /* @__PURE__ */ jsx42("span", { className: "md:sr-only", children: selectedVisibility?.label }),
              /* @__PURE__ */ jsx42(ChevronDownIcon, {})
            ]
          }
        )
      }
    ),
    /* @__PURE__ */ jsx42(DropdownMenuContent, { align: "start", className: "min-w-[300px]", children: visibilities.map((visibility) => /* @__PURE__ */ jsxs24(
      DropdownMenuItem,
      {
        className: "group/item flex flex-row items-center justify-between gap-4",
        "data-active": visibility.id === visibilityType,
        "data-testid": `visibility-selector-item-${visibility.id}`,
        onSelect: () => {
          setVisibilityType(visibility.id);
          setOpen(false);
        },
        children: [
          /* @__PURE__ */ jsxs24("div", { className: "flex flex-col items-start gap-1", children: [
            visibility.label,
            visibility.description && /* @__PURE__ */ jsx42("div", { className: "text-muted-foreground text-xs", children: visibility.description })
          ] }),
          /* @__PURE__ */ jsx42("div", { className: "text-foreground opacity-0 group-data-[active=true]/item:opacity-100 dark:text-foreground", children: /* @__PURE__ */ jsx42(CheckCircleFillIcon, {}) })
        ]
      },
      visibility.id
    )) })
  ] });
}

// src/components/chatbot/chat-header.tsx
import { jsx as jsx43, jsxs as jsxs25 } from "react/jsx-runtime";
function PureChatHeader({
  chatId,
  selectedVisibilityType,
  isReadonly
}) {
  const { state, toggleSidebar, isMobile } = useSidebar();
  if (state === "collapsed" && !isMobile) {
    return null;
  }
  return /* @__PURE__ */ jsxs25("header", { className: "sticky top-0 flex h-14 items-center gap-2 bg-sidebar px-3", children: [
    /* @__PURE__ */ jsx43(
      Button,
      {
        className: "md:hidden",
        onClick: toggleSidebar,
        size: "icon-sm",
        variant: "ghost",
        children: /* @__PURE__ */ jsx43(PanelLeftIcon3, { className: "size-4" })
      }
    ),
    /* @__PURE__ */ jsx43(
      Link3,
      {
        className: "flex size-8 items-center justify-center rounded-lg md:hidden",
        href: "https://vercel.com/templates/next.js/chatbot",
        rel: "noopener noreferrer",
        target: "_blank",
        children: /* @__PURE__ */ jsx43(VercelIcon, { size: 14 })
      }
    ),
    !isReadonly && /* @__PURE__ */ jsx43(
      VisibilitySelector,
      {
        chatId,
        selectedVisibilityType
      }
    ),
    /* @__PURE__ */ jsx43(
      Button,
      {
        asChild: true,
        className: "hidden rounded-lg bg-foreground px-4 text-background hover:bg-foreground/90 md:ml-auto md:flex",
        children: /* @__PURE__ */ jsxs25(
          Link3,
          {
            href: "https://vercel.com/templates/next.js/chatbot",
            rel: "noopener noreferrer",
            target: "_blank",
            children: [
              /* @__PURE__ */ jsx43(VercelIcon, { size: 16 }),
              "Deploy with Vercel"
            ]
          }
        )
      }
    )
  ] });
}
var ChatHeader = memo10(PureChatHeader, (prevProps, nextProps) => {
  return prevProps.chatId === nextProps.chatId && prevProps.selectedVisibilityType === nextProps.selectedVisibilityType && prevProps.isReadonly === nextProps.isReadonly;
});

// src/components/chatbot/data-stream-handler.tsx
import { useEffect as useEffect14 } from "react";
import { useSWRConfig as useSWRConfig6 } from "swr";
import { unstable_serialize as unstable_serialize4 } from "swr/infinite";
function DataStreamHandler() {
  const { basePath } = useChatbotConfig();
  const { dataStream, setDataStream } = useDataStream();
  const { mutate } = useSWRConfig6();
  const { artifact, setArtifact, setMetadata } = useArtifact();
  useEffect14(() => {
    if (!dataStream?.length) {
      return;
    }
    const newDeltas = dataStream.slice();
    setDataStream([]);
    for (const delta of newDeltas) {
      if (delta.type === "data-chat-title") {
        mutate(
          unstable_serialize4(
            (pageIndex, prev) => getChatHistoryPaginationKey(basePath, pageIndex, prev)
          )
        );
        continue;
      }
      const artifactDefinition = artifactDefinitions.find(
        (currentArtifactDefinition) => currentArtifactDefinition.kind === artifact.kind
      );
      if (artifactDefinition?.onStreamPart) {
        artifactDefinition.onStreamPart({
          streamPart: delta,
          setArtifact,
          setMetadata
        });
      }
      setArtifact((draftArtifact) => {
        if (!draftArtifact) {
          return { ...initialArtifactData, status: "streaming" };
        }
        switch (delta.type) {
          case "data-id":
            return {
              ...draftArtifact,
              documentId: delta.data,
              status: "streaming"
            };
          case "data-title":
            return {
              ...draftArtifact,
              title: delta.data,
              status: "streaming"
            };
          case "data-kind":
            return {
              ...draftArtifact,
              kind: delta.data,
              status: "streaming"
            };
          case "data-clear":
            return {
              ...draftArtifact,
              content: "",
              status: "streaming"
            };
          case "data-finish":
            return {
              ...draftArtifact,
              status: "idle"
            };
          default:
            return draftArtifact;
        }
      });
    }
  }, [dataStream, setArtifact, setMetadata, artifact, setDataStream, mutate]);
  return null;
}

// src/components/chatbot/message-editor.tsx
async function submitEditedMessage({
  message: message2,
  text: text2,
  setMessages,
  regenerate,
  basePath
}) {
  await fetch(`${basePath}/messages?messageId=${message2.id}`, {
    method: "DELETE"
  });
  setMessages((messages) => {
    const index = messages.findIndex((m) => m.id === message2.id);
    if (index === -1) {
      return messages;
    }
    return [
      ...messages.slice(0, index),
      { ...message2, parts: [{ type: "text", text: text2 }] }
    ];
  });
  regenerate();
}

// src/components/chatbot/messages.tsx
import { ArrowDownIcon } from "lucide-react";
import { useEffect as useEffect22, useRef as useRef13 } from "react";

// src/hooks/use-messages.tsx
import { useEffect as useEffect16, useState as useState18 } from "react";

// src/hooks/use-scroll-to-bottom.tsx
import { useCallback as useCallback7, useEffect as useEffect15, useRef as useRef9, useState as useState17 } from "react";
function useScrollToBottom() {
  const containerRef = useRef9(null);
  const endRef = useRef9(null);
  const [isAtBottom, setIsAtBottom] = useState17(true);
  const isAtBottomRef = useRef9(true);
  const isUserScrollingRef = useRef9(false);
  useEffect15(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);
  const checkIfAtBottom = useCallback7(() => {
    if (!containerRef.current) {
      return true;
    }
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    return scrollTop + clientHeight >= scrollHeight - 100;
  }, []);
  const scrollToBottom = useCallback7((behavior = "smooth") => {
    if (!containerRef.current) {
      return;
    }
    containerRef.current.scrollTo({
      top: containerRef.current.scrollHeight,
      behavior
    });
  }, []);
  useEffect15(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    let scrollTimeout;
    const handleScroll = () => {
      isUserScrollingRef.current = true;
      clearTimeout(scrollTimeout);
      const atBottom = checkIfAtBottom();
      setIsAtBottom(atBottom);
      isAtBottomRef.current = atBottom;
      scrollTimeout = setTimeout(() => {
        isUserScrollingRef.current = false;
      }, 150);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(scrollTimeout);
    };
  }, [checkIfAtBottom]);
  useEffect15(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const scrollIfNeeded = () => {
      if (isAtBottomRef.current && !isUserScrollingRef.current) {
        requestAnimationFrame(() => {
          container.scrollTo({
            top: container.scrollHeight,
            behavior: "instant"
          });
          setIsAtBottom(true);
          isAtBottomRef.current = true;
        });
      }
    };
    const mutationObserver = new MutationObserver(scrollIfNeeded);
    mutationObserver.observe(container, {
      childList: true,
      subtree: true,
      characterData: true
    });
    const resizeObserver = new ResizeObserver(scrollIfNeeded);
    resizeObserver.observe(container);
    for (const child of container.children) {
      resizeObserver.observe(child);
    }
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);
  function onViewportEnter() {
    setIsAtBottom(true);
    isAtBottomRef.current = true;
  }
  function onViewportLeave() {
    setIsAtBottom(false);
    isAtBottomRef.current = false;
  }
  const reset = useCallback7(() => {
    setIsAtBottom(true);
    isAtBottomRef.current = true;
    isUserScrollingRef.current = false;
  }, []);
  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    onViewportEnter,
    onViewportLeave,
    reset
  };
}

// src/hooks/use-messages.tsx
function useMessages({
  status
}) {
  const {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    onViewportEnter,
    onViewportLeave,
    reset
  } = useScrollToBottom();
  const [hasSentMessage, setHasSentMessage] = useState18(false);
  useEffect16(() => {
    if (status === "submitted") {
      setHasSentMessage(true);
    }
  }, [status]);
  return {
    containerRef,
    endRef,
    isAtBottom,
    scrollToBottom,
    onViewportEnter,
    onViewportLeave,
    hasSentMessage,
    reset
  };
}

// src/components/chatbot/greeting.tsx
import { motion as motion6 } from "framer-motion";
import { jsx as jsx44, jsxs as jsxs26 } from "react/jsx-runtime";
var Greeting = () => {
  const { greeting, greetingSubtext } = useChatbotConfig();
  return /* @__PURE__ */ jsxs26("div", { className: "flex flex-col items-center px-4", children: [
    /* @__PURE__ */ jsx44(
      motion6.div,
      {
        animate: { opacity: 1, y: 0 },
        className: "text-center font-semibold text-2xl tracking-tight text-foreground md:text-3xl",
        initial: { opacity: 0, y: 10 },
        transition: { delay: 0.35, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
        children: greeting
      }
    ),
    /* @__PURE__ */ jsx44(
      motion6.div,
      {
        animate: { opacity: 1, y: 0 },
        className: "mt-3 text-center text-muted-foreground/80 text-sm",
        initial: { opacity: 0, y: 10 },
        transition: { delay: 0.5, duration: 0.5, ease: [0.22, 1, 0.36, 1] },
        children: greetingSubtext
      }
    )
  ] }, "overview");
};

// src/components/ai-elements/shimmer.tsx
import { motion as motion7 } from "motion/react";
import { memo as memo11, useMemo as useMemo9 } from "react";
import { jsx as jsx45 } from "react/jsx-runtime";
var motionComponentCache = /* @__PURE__ */ new Map();
var getMotionComponent = (element) => {
  let component = motionComponentCache.get(element);
  if (!component) {
    component = motion7.create(element);
    motionComponentCache.set(element, component);
  }
  return component;
};
var ShimmerComponent = ({
  children,
  as: Component = "p",
  className,
  duration = 2,
  spread = 2
}) => {
  const MotionComponent = getMotionComponent(
    Component
  );
  const dynamicSpread = useMemo9(
    () => (children?.length ?? 0) * spread,
    [children, spread]
  );
  return /* @__PURE__ */ jsx45(
    MotionComponent,
    {
      animate: { backgroundPosition: "0% center" },
      className: cn(
        "relative inline-block bg-[length:250%_100%,auto] bg-clip-text text-transparent",
        "[--bg:linear-gradient(90deg,#0000_calc(50%-var(--spread)),var(--color-background),#0000_calc(50%+var(--spread)))] [background-repeat:no-repeat,padding-box]",
        className
      ),
      initial: { backgroundPosition: "100% center" },
      style: {
        "--spread": `${dynamicSpread}px`,
        backgroundImage: "var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))"
      },
      transition: {
        duration,
        ease: "linear",
        repeat: Number.POSITIVE_INFINITY
      },
      children
    }
  );
};
var Shimmer = memo11(ShimmerComponent);

// src/components/ai-elements/tool.tsx
import {
  CheckCircleIcon,
  ChevronDownIcon as ChevronDownIcon3,
  CircleIcon,
  ClockIcon,
  WrenchIcon as WrenchIcon2,
  XCircleIcon
} from "lucide-react";
import { isValidElement } from "react";

// src/components/ui/badge.tsx
import { cva as cva4 } from "class-variance-authority";
import { Slot as Slot4 } from "radix-ui";
import { jsx as jsx46 } from "react/jsx-runtime";
var badgeVariants = cva4(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive: "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline: "border-border bg-input/30 text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline"
      }
    },
    defaultVariants: {
      variant: "default"
    }
  }
);
function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}) {
  const Comp = asChild ? Slot4.Root : "span";
  return /* @__PURE__ */ jsx46(
    Comp,
    {
      className: cn(badgeVariants({ variant }), className),
      "data-slot": "badge",
      "data-variant": variant,
      ...props
    }
  );
}

// src/components/ui/collapsible.tsx
import { Collapsible as CollapsiblePrimitive } from "radix-ui";
import { jsx as jsx47 } from "react/jsx-runtime";
function Collapsible({
  ...props
}) {
  return /* @__PURE__ */ jsx47(CollapsiblePrimitive.Root, { "data-slot": "collapsible", ...props });
}
function CollapsibleTrigger({
  ...props
}) {
  return /* @__PURE__ */ jsx47(
    CollapsiblePrimitive.CollapsibleTrigger,
    {
      "data-slot": "collapsible-trigger",
      ...props
    }
  );
}
function CollapsibleContent({
  ...props
}) {
  return /* @__PURE__ */ jsx47(
    CollapsiblePrimitive.CollapsibleContent,
    {
      "data-slot": "collapsible-content",
      ...props
    }
  );
}

// src/components/ai-elements/code-block.tsx
import { CheckIcon as CheckIcon3, CopyIcon as CopyIcon2 } from "lucide-react";
import {
  createContext as createContext6,
  memo as memo12,
  useCallback as useCallback8,
  useContext as useContext6,
  useEffect as useEffect17,
  useMemo as useMemo10,
  useRef as useRef10,
  useState as useState19
} from "react";
import { createHighlighter } from "shiki";

// src/components/ui/select.tsx
import { CheckIcon as CheckIcon2, ChevronDownIcon as ChevronDownIcon2, ChevronUpIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import { jsx as jsx48, jsxs as jsxs27 } from "react/jsx-runtime";

// src/components/ai-elements/code-block.tsx
import { jsx as jsx49, jsxs as jsxs28 } from "react/jsx-runtime";
var isItalic = (fontStyle) => fontStyle && fontStyle & 1;
var isBold = (fontStyle) => fontStyle && fontStyle & 2;
var isUnderline = (fontStyle) => (
  // biome-ignore lint/suspicious/noBitwiseOperators: shiki bitflag check
  // oxlint-disable-next-line eslint(no-bitwise)
  fontStyle && fontStyle & 4
);
var addKeysToTokens = (lines) => lines.map((line, lineIdx) => ({
  key: `line-${lineIdx}`,
  tokens: line.map((token, tokenIdx) => ({
    key: `line-${lineIdx}-${tokenIdx}`,
    token
  }))
}));
var TokenSpan = ({ token }) => /* @__PURE__ */ jsx49(
  "span",
  {
    className: "dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)]",
    style: {
      backgroundColor: token.bgColor,
      color: token.color,
      fontStyle: isItalic(token.fontStyle) ? "italic" : void 0,
      fontWeight: isBold(token.fontStyle) ? "bold" : void 0,
      textDecoration: isUnderline(token.fontStyle) ? "underline" : void 0,
      ...token.htmlStyle
    },
    children: token.content
  }
);
var LineSpan = ({
  keyedLine,
  showLineNumbers
}) => /* @__PURE__ */ jsx49("span", { className: showLineNumbers ? LINE_NUMBER_CLASSES : "block", children: keyedLine.tokens.length === 0 ? "\n" : keyedLine.tokens.map(({ token, key }) => /* @__PURE__ */ jsx49(TokenSpan, { token }, key)) });
var CodeBlockContext = createContext6({
  code: ""
});
var highlighterCache = /* @__PURE__ */ new Map();
var tokensCache = /* @__PURE__ */ new Map();
var subscribers = /* @__PURE__ */ new Map();
var getTokensCacheKey = (code3, language) => {
  const start = code3.slice(0, 100);
  const end = code3.length > 100 ? code3.slice(-100) : "";
  return `${language}:${code3.length}:${start}:${end}`;
};
var getHighlighter = (language) => {
  const cached = highlighterCache.get(language);
  if (cached) {
    return cached;
  }
  const highlighterPromise = createHighlighter({
    langs: [language],
    themes: ["github-light", "github-dark"]
  });
  highlighterCache.set(language, highlighterPromise);
  return highlighterPromise;
};
var createRawTokens = (code3) => ({
  bg: "transparent",
  fg: "inherit",
  tokens: code3.split("\n").map(
    (line) => line === "" ? [] : [
      {
        color: "inherit",
        content: line
      }
    ]
  )
});
var highlightCode = (code3, language, callback) => {
  const tokensCacheKey = getTokensCacheKey(code3, language);
  const cached = tokensCache.get(tokensCacheKey);
  if (cached) {
    return cached;
  }
  if (callback) {
    if (!subscribers.has(tokensCacheKey)) {
      subscribers.set(tokensCacheKey, /* @__PURE__ */ new Set());
    }
    subscribers.get(tokensCacheKey)?.add(callback);
  }
  getHighlighter(language).then((highlighter) => {
    const availableLangs = highlighter.getLoadedLanguages();
    const langToUse = availableLangs.includes(language) ? language : "text";
    const result = highlighter.codeToTokens(code3, {
      lang: langToUse,
      themes: {
        dark: "github-dark",
        light: "github-light"
      }
    });
    const tokenized = {
      bg: result.bg ?? "transparent",
      fg: result.fg ?? "inherit",
      tokens: result.tokens
    };
    tokensCache.set(tokensCacheKey, tokenized);
    const subs = subscribers.get(tokensCacheKey);
    if (subs) {
      for (const sub of subs) {
        sub(tokenized);
      }
      subscribers.delete(tokensCacheKey);
    }
  }).catch((error) => {
    console.error("Failed to highlight code:", error);
    subscribers.delete(tokensCacheKey);
  });
  return null;
};
var LINE_NUMBER_CLASSES = cn(
  "block",
  "before:content-[counter(line)]",
  "before:inline-block",
  "before:[counter-increment:line]",
  "before:w-8",
  "before:mr-4",
  "before:text-right",
  "before:text-muted-foreground/50",
  "before:font-mono",
  "before:select-none"
);
var CodeBlockBody = memo12(
  ({
    tokenized,
    showLineNumbers,
    className
  }) => {
    const preStyle = useMemo10(
      () => ({
        backgroundColor: tokenized.bg,
        color: tokenized.fg
      }),
      [tokenized.bg, tokenized.fg]
    );
    const keyedLines = useMemo10(
      () => addKeysToTokens(tokenized.tokens),
      [tokenized.tokens]
    );
    return /* @__PURE__ */ jsx49(
      "pre",
      {
        className: cn(
          "dark:!bg-[var(--shiki-dark-bg)] dark:!text-[var(--shiki-dark)] m-0 p-4 text-sm",
          className
        ),
        style: preStyle,
        children: /* @__PURE__ */ jsx49(
          "code",
          {
            className: cn(
              "font-mono text-sm",
              showLineNumbers && "[counter-increment:line_0] [counter-reset:line]"
            ),
            children: keyedLines.map((keyedLine) => /* @__PURE__ */ jsx49(
              LineSpan,
              {
                keyedLine,
                showLineNumbers
              },
              keyedLine.key
            ))
          }
        )
      }
    );
  },
  (prevProps, nextProps) => prevProps.tokenized === nextProps.tokenized && prevProps.showLineNumbers === nextProps.showLineNumbers && prevProps.className === nextProps.className
);
CodeBlockBody.displayName = "CodeBlockBody";
var CodeBlockContainer = ({
  className,
  language,
  style,
  ...props
}) => /* @__PURE__ */ jsx49(
  "div",
  {
    className: cn(
      "group relative w-full overflow-hidden rounded-md border bg-background text-foreground",
      className
    ),
    "data-language": language,
    style: {
      containIntrinsicSize: "auto 200px",
      contentVisibility: "auto",
      ...style
    },
    ...props
  }
);
var CodeBlockContent = ({
  code: code3,
  language,
  showLineNumbers = false
}) => {
  const rawTokens = useMemo10(() => createRawTokens(code3), [code3]);
  const [tokenized, setTokenized] = useState19(
    () => highlightCode(code3, language) ?? rawTokens
  );
  useEffect17(() => {
    let cancelled = false;
    setTokenized(highlightCode(code3, language) ?? rawTokens);
    highlightCode(code3, language, (result) => {
      if (!cancelled) {
        setTokenized(result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code3, language, rawTokens]);
  return /* @__PURE__ */ jsx49("div", { className: "relative overflow-auto", children: /* @__PURE__ */ jsx49(CodeBlockBody, { showLineNumbers, tokenized }) });
};
var CodeBlock = ({
  code: code3,
  language,
  showLineNumbers = false,
  className,
  children,
  ...props
}) => {
  const contextValue = useMemo10(() => ({ code: code3 }), [code3]);
  return /* @__PURE__ */ jsx49(CodeBlockContext.Provider, { value: contextValue, children: /* @__PURE__ */ jsxs28(CodeBlockContainer, { className, language, ...props, children: [
    children,
    /* @__PURE__ */ jsx49(
      CodeBlockContent,
      {
        code: code3,
        language,
        showLineNumbers
      }
    )
  ] }) });
};

// src/components/ai-elements/tool.tsx
import { jsx as jsx50, jsxs as jsxs29 } from "react/jsx-runtime";
var Tool2 = ({ className, ...props }) => /* @__PURE__ */ jsx50(
  Collapsible,
  {
    className: cn("group not-prose mb-4 w-full rounded-md border", className),
    ...props
  }
);
var statusLabels = {
  "approval-requested": "Awaiting Approval",
  "approval-responded": "Responded",
  "input-available": "Running",
  "input-streaming": "Pending",
  "output-available": "Completed",
  "output-denied": "Denied",
  "output-error": "Error"
};
var statusIcons = {
  "approval-requested": /* @__PURE__ */ jsx50(ClockIcon, { className: "size-4 text-yellow-600" }),
  "approval-responded": /* @__PURE__ */ jsx50(CheckCircleIcon, { className: "size-4 text-blue-600" }),
  "input-available": /* @__PURE__ */ jsx50(ClockIcon, { className: "size-4 animate-pulse" }),
  "input-streaming": /* @__PURE__ */ jsx50(CircleIcon, { className: "size-4" }),
  "output-available": /* @__PURE__ */ jsx50(CheckCircleIcon, { className: "size-4 text-green-600" }),
  "output-denied": /* @__PURE__ */ jsx50(XCircleIcon, { className: "size-4 text-orange-600" }),
  "output-error": /* @__PURE__ */ jsx50(XCircleIcon, { className: "size-4 text-red-600" })
};
var getStatusBadge = (status) => /* @__PURE__ */ jsxs29(Badge, { className: "gap-1.5 rounded-full text-xs", variant: "secondary", children: [
  statusIcons[status],
  statusLabels[status]
] });
var ToolHeader = ({
  className,
  title,
  type,
  state,
  toolName,
  ...props
}) => {
  const derivedName = type === "dynamic-tool" ? toolName : type.split("-").slice(1).join("-");
  return /* @__PURE__ */ jsxs29(
    CollapsibleTrigger,
    {
      className: cn(
        "flex w-full items-center justify-between gap-4 p-3",
        className
      ),
      ...props,
      children: [
        /* @__PURE__ */ jsxs29("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsx50(WrenchIcon2, { className: "size-4 text-muted-foreground" }),
          /* @__PURE__ */ jsx50("span", { className: "font-medium text-sm", children: title ?? derivedName }),
          getStatusBadge(state)
        ] }),
        /* @__PURE__ */ jsx50(ChevronDownIcon3, { className: "size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" })
      ]
    }
  );
};
var ToolContent = ({ className, ...props }) => /* @__PURE__ */ jsx50(
  CollapsibleContent,
  {
    className: cn(
      "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 space-y-4 p-4 text-popover-foreground outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
      className
    ),
    ...props
  }
);
var ToolInput = ({ className, input, ...props }) => /* @__PURE__ */ jsxs29("div", { className: cn("space-y-2 overflow-hidden", className), ...props, children: [
  /* @__PURE__ */ jsx50("h4", { className: "font-medium text-muted-foreground text-xs uppercase tracking-wide", children: "Parameters" }),
  /* @__PURE__ */ jsx50("div", { className: "rounded-md bg-muted/50", children: /* @__PURE__ */ jsx50(CodeBlock, { code: JSON.stringify(input, null, 2), language: "json" }) })
] });
var ToolOutput = ({
  className,
  output,
  errorText,
  ...props
}) => {
  if (!(output || errorText)) {
    return null;
  }
  let Output = /* @__PURE__ */ jsx50("div", { children: output });
  if (typeof output === "object" && !isValidElement(output)) {
    Output = /* @__PURE__ */ jsx50(CodeBlock, { code: JSON.stringify(output, null, 2), language: "json" });
  } else if (typeof output === "string") {
    Output = /* @__PURE__ */ jsx50(CodeBlock, { code: output, language: "json" });
  }
  return /* @__PURE__ */ jsxs29("div", { className: cn("space-y-2", className), ...props, children: [
    /* @__PURE__ */ jsx50("h4", { className: "font-medium text-muted-foreground text-xs uppercase tracking-wide", children: errorText ? "Error" : "Result" }),
    /* @__PURE__ */ jsxs29(
      "div",
      {
        className: cn(
          "overflow-x-auto rounded-md text-xs [&_table]:w-full",
          errorText && "bg-destructive/10 text-destructive"
        ),
        children: [
          errorText && /* @__PURE__ */ jsx50("div", { children: errorText }),
          Output
        ]
      }
    )
  ] });
};

// src/components/chatbot/document.tsx
import { memo as memo13 } from "react";
import { toast as toast9 } from "sonner";
import { jsx as jsx51, jsxs as jsxs30 } from "react/jsx-runtime";
var getActionText = (type, tense) => {
  switch (type) {
    case "create":
      return tense === "present" ? "Creating" : "Created";
    case "update":
      return tense === "present" ? "Updating" : "Updated";
    case "request-suggestions":
      return tense === "present" ? "Adding suggestions" : "Added suggestions to";
    default:
      return null;
  }
};
function PureDocumentToolResult({
  type,
  result,
  isReadonly
}) {
  const { setArtifact } = useArtifact();
  return /* @__PURE__ */ jsxs30(
    "button",
    {
      className: "flex w-fit cursor-pointer flex-row items-center gap-2 rounded-xl border bg-background px-3 py-2",
      onClick: (event) => {
        if (isReadonly) {
          toast9.error(
            "Viewing files in shared chats is currently not supported."
          );
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const boundingBox = {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        };
        setArtifact((currentArtifact) => ({
          documentId: result.id,
          kind: result.kind,
          content: currentArtifact.content,
          title: result.title,
          isVisible: true,
          status: "idle",
          boundingBox
        }));
      },
      type: "button",
      children: [
        /* @__PURE__ */ jsx51("div", { className: "text-muted-foreground", children: type === "create" ? /* @__PURE__ */ jsx51(FileIcon, {}) : type === "update" ? /* @__PURE__ */ jsx51(PencilEditIcon, {}) : type === "request-suggestions" ? /* @__PURE__ */ jsx51(MessageIcon, {}) : null }),
        /* @__PURE__ */ jsx51("div", { className: "text-left", children: `${getActionText(type, "past")} "${result.title}"` })
      ]
    }
  );
}
var DocumentToolResult = memo13(PureDocumentToolResult, () => true);
function PureDocumentToolCall({
  type,
  args,
  isReadonly
}) {
  const { setArtifact } = useArtifact();
  return /* @__PURE__ */ jsxs30(
    "button",
    {
      className: "cursor pointer flex w-fit flex-row items-start justify-between gap-3 rounded-xl border px-3 py-2",
      onClick: (event) => {
        if (isReadonly) {
          toast9.error(
            "Viewing files in shared chats is currently not supported."
          );
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const boundingBox = {
          top: rect.top,
          left: rect.left,
          width: rect.width,
          height: rect.height
        };
        setArtifact((currentArtifact) => ({
          ...currentArtifact,
          isVisible: true,
          boundingBox
        }));
      },
      type: "button",
      children: [
        /* @__PURE__ */ jsxs30("div", { className: "flex flex-row items-start gap-3", children: [
          /* @__PURE__ */ jsx51("div", { className: "mt-1 text-neutral-500", children: type === "create" ? /* @__PURE__ */ jsx51(FileIcon, {}) : type === "update" ? /* @__PURE__ */ jsx51(PencilEditIcon, {}) : type === "request-suggestions" ? /* @__PURE__ */ jsx51(MessageIcon, {}) : null }),
          /* @__PURE__ */ jsx51("div", { className: "text-left", children: `${getActionText(type, "present")} ${type === "create" && "title" in args && args.title ? `"${args.title}"` : type === "update" && "description" in args ? `"${args.description}"` : type === "request-suggestions" ? "for document" : ""}` })
        ] }),
        /* @__PURE__ */ jsx51("div", { className: "mt-1 animate-spin", children: /* @__PURE__ */ jsx51(LoaderIcon, {}) })
      ]
    }
  );
}
var DocumentToolCall = memo13(PureDocumentToolCall, () => true);

// src/components/chatbot/document-preview.tsx
import equal2 from "fast-deep-equal";
import {
  memo as memo14,
  useCallback as useCallback9,
  useEffect as useEffect18,
  useMemo as useMemo11,
  useRef as useRef11
} from "react";
import useSWR5 from "swr";
import { jsx as jsx52, jsxs as jsxs31 } from "react/jsx-runtime";
function DocumentPreview({
  isReadonly: _isReadonly,
  result,
  args
}) {
  const { artifact, setArtifact } = useArtifact();
  const { data: documents, isLoading: isDocumentsFetching } = useSWR5(
    result ? `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/document?id=${result.id}` : null,
    fetcher
  );
  const previewDocument = useMemo11(() => documents?.[0], [documents]);
  const hitboxRef = useRef11(null);
  useEffect18(() => {
    const boundingBox = hitboxRef.current?.getBoundingClientRect();
    if (artifact.documentId && boundingBox) {
      setArtifact((currentArtifact) => ({
        ...currentArtifact,
        boundingBox: {
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height
        }
      }));
    }
  }, [artifact.documentId, setArtifact]);
  if (isDocumentsFetching) {
    const kind = result?.kind ?? args?.kind ?? artifact.kind;
    const title = result?.title ?? args?.title ?? artifact.title;
    return /* @__PURE__ */ jsxs31("div", { className: "w-full max-w-[450px]", children: [
      title ? /* @__PURE__ */ jsx52(DocumentHeader, { isStreaming: true, kind, title }) : /* @__PURE__ */ jsxs31("div", { className: "flex flex-row items-center justify-between gap-2 rounded-t-2xl border border-b-0 border-border/50 px-4 py-3 dark:bg-muted", children: [
        /* @__PURE__ */ jsxs31("div", { className: "flex flex-row items-center gap-2.5", children: [
          /* @__PURE__ */ jsx52("div", { className: "size-3.5 animate-pulse rounded bg-muted-foreground/15" }),
          /* @__PURE__ */ jsx52("div", { className: "h-3.5 w-24 animate-pulse rounded bg-muted-foreground/15" })
        ] }),
        /* @__PURE__ */ jsx52("div", { className: "w-8" })
      ] }),
      /* @__PURE__ */ jsx52("div", { className: "h-[257px] overflow-hidden rounded-b-2xl border border-t-0 border-border/50 bg-muted p-6", children: /* @__PURE__ */ jsx52(InlineDocumentSkeleton, {}) })
    ] });
  }
  const document3 = previewDocument ? previewDocument : artifact.status === "streaming" ? {
    title: artifact.title,
    kind: artifact.kind,
    content: artifact.content,
    id: artifact.documentId,
    createdAt: /* @__PURE__ */ new Date(),
    userId: "noop"
  } : null;
  if (!document3) {
    return /* @__PURE__ */ jsx52(LoadingSkeleton, { artifactKind: artifact.kind });
  }
  return /* @__PURE__ */ jsxs31("div", { className: "relative w-full max-w-[450px] cursor-pointer", children: [
    /* @__PURE__ */ jsx52(
      HitboxLayer,
      {
        hitboxRef,
        result,
        setArtifact
      }
    ),
    /* @__PURE__ */ jsx52(
      DocumentHeader,
      {
        isStreaming: artifact.status === "streaming",
        kind: document3.kind,
        title: document3.title
      }
    ),
    /* @__PURE__ */ jsx52(DocumentContent, { document: document3 })
  ] });
}
var LoadingSkeleton = ({ artifactKind }) => /* @__PURE__ */ jsxs31("div", { className: "w-full max-w-[450px]", children: [
  /* @__PURE__ */ jsxs31("div", { className: "flex flex-row items-center justify-between gap-2 rounded-t-2xl border border-b-0 border-border/50 px-4 py-3 dark:bg-muted", children: [
    /* @__PURE__ */ jsxs31("div", { className: "flex flex-row items-center gap-2.5", children: [
      /* @__PURE__ */ jsx52("div", { className: "size-3.5 animate-pulse rounded bg-muted-foreground/15" }),
      /* @__PURE__ */ jsx52("div", { className: "h-3.5 w-24 animate-pulse rounded bg-muted-foreground/15" })
    ] }),
    /* @__PURE__ */ jsx52("div", { className: "w-8" })
  ] }),
  artifactKind === "image" ? /* @__PURE__ */ jsx52("div", { className: "overflow-hidden rounded-b-2xl border border-t-0 border-border/50 bg-muted", children: /* @__PURE__ */ jsx52("div", { className: "h-[257px] w-full animate-pulse bg-muted-foreground/10" }) }) : /* @__PURE__ */ jsx52("div", { className: "h-[257px] overflow-hidden rounded-b-2xl border border-t-0 border-border/50 bg-muted p-6", children: /* @__PURE__ */ jsx52(InlineDocumentSkeleton, {}) })
] });
var PureHitboxLayer = ({
  hitboxRef,
  result,
  setArtifact
}) => {
  const handleClick = useCallback9(
    (event) => {
      const boundingBox = event.currentTarget.getBoundingClientRect();
      setArtifact((artifact) => ({
        ...artifact,
        ...result?.id && { documentId: result.id },
        ...result?.title && { title: result.title },
        ...result?.kind && { kind: result.kind },
        isVisible: true,
        boundingBox: {
          left: boundingBox.x,
          top: boundingBox.y,
          width: boundingBox.width,
          height: boundingBox.height
        }
      }));
    },
    [setArtifact, result]
  );
  return /* @__PURE__ */ jsx52(
    "div",
    {
      "aria-hidden": "true",
      className: "absolute top-0 left-0 z-10 size-full rounded-xl",
      onClick: handleClick,
      ref: hitboxRef,
      role: "presentation",
      children: /* @__PURE__ */ jsx52("div", { className: "flex w-full items-center justify-end p-4", children: /* @__PURE__ */ jsx52("div", { className: "absolute top-[13px] right-[9px] rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", children: /* @__PURE__ */ jsx52(FullscreenIcon, {}) }) })
    }
  );
};
var HitboxLayer = memo14(PureHitboxLayer, (prevProps, nextProps) => {
  if (!equal2(prevProps.result, nextProps.result)) {
    return false;
  }
  return true;
});
var PureDocumentHeader = ({
  title,
  kind,
  isStreaming
}) => /* @__PURE__ */ jsxs31("div", { className: "flex flex-row items-center justify-between gap-2 rounded-t-2xl border border-b-0 border-border/50 px-4 py-3 dark:bg-muted", children: [
  /* @__PURE__ */ jsxs31("div", { className: "flex flex-row items-center gap-2.5", children: [
    /* @__PURE__ */ jsx52("div", { className: "text-muted-foreground", children: isStreaming ? /* @__PURE__ */ jsx52("div", { className: "animate-spin", children: /* @__PURE__ */ jsx52(LoaderIcon, { size: 14 }) }) : kind === "image" ? /* @__PURE__ */ jsx52(ImageIcon, { size: 14 }) : kind === "code" ? /* @__PURE__ */ jsx52(CodeIcon, { size: 14 }) : /* @__PURE__ */ jsx52(FileIcon, { size: 14 }) }),
    /* @__PURE__ */ jsx52("div", { className: "text-sm font-medium", children: title })
  ] }),
  /* @__PURE__ */ jsx52("div", { className: "w-8" })
] });
var DocumentHeader = memo14(PureDocumentHeader, (prevProps, nextProps) => {
  if (prevProps.title !== nextProps.title) {
    return false;
  }
  if (prevProps.isStreaming !== nextProps.isStreaming) {
    return false;
  }
  return true;
});
var DocumentContent = ({ document: document3 }) => {
  const { artifact } = useArtifact();
  const containerClassName = cn(
    "h-[257px] overflow-hidden rounded-b-2xl border border-t-0 border-border/50 dark:bg-muted",
    {
      "p-4 sm:px-10 sm:py-10": document3.kind === "text",
      "p-0": document3.kind === "code"
    }
  );
  const commonProps = {
    content: document3.content ?? "",
    isCurrentVersion: true,
    currentVersionIndex: 0,
    status: artifact.status,
    saveContent: () => null,
    suggestions: []
  };
  const handleSaveContent = () => null;
  return /* @__PURE__ */ jsxs31("div", { className: cn(containerClassName, "relative"), children: [
    document3.kind === "text" ? /* @__PURE__ */ jsx52(Editor, { ...commonProps, onSaveContent: handleSaveContent }) : document3.kind === "code" ? /* @__PURE__ */ jsx52("div", { className: "relative flex w-full flex-1", children: /* @__PURE__ */ jsx52("div", { className: "absolute inset-0", children: /* @__PURE__ */ jsx52(CodeEditor, { ...commonProps, onSaveContent: handleSaveContent }) }) }) : document3.kind === "sheet" ? /* @__PURE__ */ jsx52("div", { className: "relative flex size-full flex-1 p-4", children: /* @__PURE__ */ jsx52("div", { className: "absolute inset-0", children: /* @__PURE__ */ jsx52(SpreadsheetEditor, { ...commonProps }) }) }) : document3.kind === "image" ? /* @__PURE__ */ jsx52(
      ImageEditor,
      {
        content: document3.content ?? "",
        currentVersionIndex: 0,
        isCurrentVersion: true,
        isInline: true,
        status: artifact.status,
        title: document3.title
      }
    ) : null,
    /* @__PURE__ */ jsx52("div", { className: "pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-muted to-transparent dark:from-muted" }),
    document3.kind === "code" && /* @__PURE__ */ jsx52("div", { className: "pointer-events-none absolute inset-y-0 right-0 w-12 bg-gradient-to-l from-muted to-transparent dark:from-muted" })
  ] });
};

// src/components/chatbot/message-actions.tsx
import equal3 from "fast-deep-equal";
import { memo as memo15 } from "react";
import { toast as toast10 } from "sonner";
import { useSWRConfig as useSWRConfig7 } from "swr";
import { useCopyToClipboard } from "usehooks-ts";
import { jsx as jsx53, jsxs as jsxs32 } from "react/jsx-runtime";
function PureMessageActions({
  chatId,
  message: message2,
  vote: vote2,
  isLoading,
  onEdit
}) {
  const { mutate } = useSWRConfig7();
  const [_, copyToClipboard] = useCopyToClipboard();
  if (isLoading) {
    return null;
  }
  const textFromParts = message2.parts?.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
  const handleCopy = async () => {
    if (!textFromParts) {
      toast10.error("There's no text to copy!");
      return;
    }
    await copyToClipboard(textFromParts);
    toast10.success("Copied to clipboard!");
  };
  if (message2.role === "user") {
    return /* @__PURE__ */ jsx53(MessageActions, { className: "-mr-0.5 justify-end opacity-0 transition-opacity duration-150 group-hover/message:opacity-100", children: /* @__PURE__ */ jsxs32("div", { className: "flex items-center gap-0.5", children: [
      onEdit && /* @__PURE__ */ jsx53(
        MessageAction,
        {
          className: "size-7 text-muted-foreground/50 hover:text-foreground",
          "data-testid": "message-edit-button",
          onClick: onEdit,
          tooltip: "Edit",
          children: /* @__PURE__ */ jsx53(PencilEditIcon, {})
        }
      ),
      /* @__PURE__ */ jsx53(
        MessageAction,
        {
          className: "size-7 text-muted-foreground/50 hover:text-foreground",
          onClick: handleCopy,
          tooltip: "Copy",
          children: /* @__PURE__ */ jsx53(CopyIcon, {})
        }
      )
    ] }) });
  }
  return /* @__PURE__ */ jsxs32(MessageActions, { className: "-ml-0.5 opacity-0 transition-opacity duration-150 group-hover/message:opacity-100", children: [
    /* @__PURE__ */ jsx53(
      MessageAction,
      {
        className: "text-muted-foreground/50 hover:text-foreground",
        onClick: handleCopy,
        tooltip: "Copy",
        children: /* @__PURE__ */ jsx53(CopyIcon, {})
      }
    ),
    /* @__PURE__ */ jsx53(
      MessageAction,
      {
        className: "text-muted-foreground/50 hover:text-foreground",
        "data-testid": "message-upvote",
        disabled: vote2?.isUpvoted,
        onClick: () => {
          const upvote = fetch(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote`,
            {
              method: "PATCH",
              body: JSON.stringify({
                chatId,
                messageId: message2.id,
                type: "up"
              })
            }
          );
          toast10.promise(upvote, {
            loading: "Upvoting Response...",
            success: () => {
              mutate(
                `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`,
                (currentVotes) => {
                  if (!currentVotes) {
                    return [];
                  }
                  const votesWithoutCurrent = currentVotes.filter(
                    (currentVote) => currentVote.messageId !== message2.id
                  );
                  return [
                    ...votesWithoutCurrent,
                    {
                      chatId,
                      messageId: message2.id,
                      isUpvoted: true
                    }
                  ];
                },
                { revalidate: false }
              );
              return "Upvoted Response!";
            },
            error: "Failed to upvote response."
          });
        },
        tooltip: "Upvote Response",
        children: /* @__PURE__ */ jsx53(ThumbUpIcon, {})
      }
    ),
    /* @__PURE__ */ jsx53(
      MessageAction,
      {
        className: "text-muted-foreground/50 hover:text-foreground",
        "data-testid": "message-downvote",
        disabled: vote2 && !vote2.isUpvoted,
        onClick: () => {
          const downvote = fetch(
            `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote`,
            {
              method: "PATCH",
              body: JSON.stringify({
                chatId,
                messageId: message2.id,
                type: "down"
              })
            }
          );
          toast10.promise(downvote, {
            loading: "Downvoting Response...",
            success: () => {
              mutate(
                `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/vote?chatId=${chatId}`,
                (currentVotes) => {
                  if (!currentVotes) {
                    return [];
                  }
                  const votesWithoutCurrent = currentVotes.filter(
                    (currentVote) => currentVote.messageId !== message2.id
                  );
                  return [
                    ...votesWithoutCurrent,
                    {
                      chatId,
                      messageId: message2.id,
                      isUpvoted: false
                    }
                  ];
                },
                { revalidate: false }
              );
              return "Downvoted Response!";
            },
            error: "Failed to downvote response."
          });
        },
        tooltip: "Downvote Response",
        children: /* @__PURE__ */ jsx53(ThumbDownIcon, {})
      }
    )
  ] });
}
var MessageActions2 = memo15(
  PureMessageActions,
  (prevProps, nextProps) => {
    if (!equal3(prevProps.vote, nextProps.vote)) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    return true;
  }
);

// src/components/chatbot/message-reasoning.tsx
import { useEffect as useEffect20, useState as useState21 } from "react";

// src/components/ai-elements/reasoning.tsx
import { useControllableState } from "@radix-ui/react-use-controllable-state";
import { cjk as cjk2 } from "@streamdown/cjk";
import { code as code2 } from "@streamdown/code";
import { math as math2 } from "@streamdown/math";
import { mermaid as mermaid2 } from "@streamdown/mermaid";
import { ChevronDownIcon as ChevronDownIcon4 } from "lucide-react";
import {
  createContext as createContext7,
  memo as memo16,
  useCallback as useCallback10,
  useContext as useContext7,
  useEffect as useEffect19,
  useMemo as useMemo12,
  useRef as useRef12,
  useState as useState20
} from "react";
import { Streamdown as Streamdown2 } from "streamdown";
import { Fragment as Fragment9, jsx as jsx54, jsxs as jsxs33 } from "react/jsx-runtime";
var ReasoningContext = createContext7(null);
var useReasoning = () => {
  const context = useContext7(ReasoningContext);
  if (!context) {
    throw new Error("Reasoning components must be used within Reasoning");
  }
  return context;
};
var AUTO_CLOSE_DELAY = 1e3;
var MS_IN_S = 1e3;
var Reasoning = memo16(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }) => {
    const resolvedDefaultOpen = defaultOpen ?? isStreaming;
    const isExplicitlyClosed = defaultOpen === false;
    const [isOpen, setIsOpen] = useControllableState({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open
    });
    const [duration, setDuration] = useControllableState({
      defaultProp: void 0,
      prop: durationProp
    });
    const hasEverStreamedRef = useRef12(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState20(false);
    const startTimeRef = useRef12(null);
    useEffect19(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;
        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);
    useEffect19(() => {
      if (isStreaming && !isOpen && !isExplicitlyClosed) {
        setIsOpen(true);
      }
    }, [isStreaming, isOpen, setIsOpen, isExplicitlyClosed]);
    useEffect19(() => {
      if (hasEverStreamedRef.current && !isStreaming && isOpen && !hasAutoClosed) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);
        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);
    const handleOpenChange = useCallback10(
      (newOpen) => {
        setIsOpen(newOpen);
      },
      [setIsOpen]
    );
    const contextValue = useMemo12(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen]
    );
    return /* @__PURE__ */ jsx54(ReasoningContext.Provider, { value: contextValue, children: /* @__PURE__ */ jsx54(
      Collapsible,
      {
        className: cn("not-prose", className),
        onOpenChange: handleOpenChange,
        open: isOpen,
        ...props,
        children
      }
    ) });
  }
);
var defaultGetThinkingMessage = (isStreaming, duration) => {
  if (isStreaming || duration === 0) {
    return /* @__PURE__ */ jsx54(Shimmer, { className: "font-medium", duration: 1, children: "Thinking..." });
  }
  if (duration === void 0) {
    return /* @__PURE__ */ jsx54("p", { children: "Thought for a few seconds" });
  }
  return /* @__PURE__ */ jsxs33("p", { children: [
    "Thought for ",
    duration,
    " seconds"
  ] });
};
var ReasoningTrigger = memo16(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }) => {
    const { isStreaming, isOpen, duration } = useReasoning();
    return /* @__PURE__ */ jsx54(
      CollapsibleTrigger,
      {
        className: cn(
          "flex w-full items-center gap-2 text-muted-foreground text-[13px] leading-[1.65] transition-colors hover:text-foreground",
          className
        ),
        ...props,
        children: children ?? /* @__PURE__ */ jsxs33(Fragment9, { children: [
          getThinkingMessage(isStreaming, duration),
          /* @__PURE__ */ jsx54(
            ChevronDownIcon4,
            {
              className: cn(
                "size-4 transition-transform",
                isOpen ? "rotate-180" : "rotate-0"
              )
            }
          )
        ] })
      }
    );
  }
);
var streamdownPlugins2 = { cjk: cjk2, code: code2, math: math2, mermaid: mermaid2 };
var ReasoningContent = memo16(
  ({ className, children, ...props }) => {
    const { isStreaming, isOpen } = useReasoning();
    const scrollRef = useRef12(null);
    useEffect19(() => {
      if (isStreaming && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    }, [children, isStreaming]);
    if (!isOpen) return null;
    return /* @__PURE__ */ jsx54(
      "div",
      {
        className: cn(
          "mt-2 animate-in fade-in-0 duration-200 text-muted-foreground/60 [overflow-anchor:none]",
          className
        ),
        children: /* @__PURE__ */ jsx54(
          "div",
          {
            className: "max-h-[200px] overflow-y-auto rounded-lg border border-border/20 bg-muted/30 px-3 py-2 text-[11px] leading-relaxed",
            ref: scrollRef,
            style: { scrollbarWidth: "none", msOverflowStyle: "none" },
            children: /* @__PURE__ */ jsx54(Streamdown2, { plugins: streamdownPlugins2, ...props, children })
          }
        )
      }
    );
  }
);
Reasoning.displayName = "Reasoning";
ReasoningTrigger.displayName = "ReasoningTrigger";
ReasoningContent.displayName = "ReasoningContent";

// src/components/chatbot/message-reasoning.tsx
import { jsx as jsx55, jsxs as jsxs34 } from "react/jsx-runtime";
function MessageReasoning({
  isLoading,
  reasoning
}) {
  const [hasBeenStreaming, setHasBeenStreaming] = useState21(isLoading);
  useEffect20(() => {
    if (isLoading) {
      setHasBeenStreaming(true);
    }
  }, [isLoading]);
  return /* @__PURE__ */ jsxs34(
    Reasoning,
    {
      "data-testid": "message-reasoning",
      defaultOpen: hasBeenStreaming,
      isStreaming: isLoading,
      children: [
        /* @__PURE__ */ jsx55(ReasoningTrigger, {}),
        /* @__PURE__ */ jsx55(ReasoningContent, { children: reasoning })
      ]
    }
  );
}

// src/components/chatbot/preview-attachment.tsx
import Image2 from "next/image";
import { jsx as jsx56, jsxs as jsxs35 } from "react/jsx-runtime";
var PreviewAttachment = ({
  attachment,
  isUploading = false,
  onRemove
}) => {
  const { name, url, contentType } = attachment;
  return /* @__PURE__ */ jsxs35(
    "div",
    {
      className: "group relative h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border/40 bg-muted",
      "data-testid": "input-attachment-preview",
      children: [
        contentType?.startsWith("image") ? /* @__PURE__ */ jsx56(
          Image2,
          {
            alt: name ?? "attachment",
            className: "size-full object-cover",
            height: 96,
            src: url,
            width: 96
          }
        ) : /* @__PURE__ */ jsx56("div", { className: "flex size-full items-center justify-center text-muted-foreground text-xs", children: "File" }),
        isUploading && /* @__PURE__ */ jsx56(
          "div",
          {
            className: "absolute inset-0 flex items-center justify-center rounded-xl bg-black/40 backdrop-blur-sm",
            "data-testid": "input-attachment-loader",
            children: /* @__PURE__ */ jsx56(Spinner, { className: "size-5" })
          }
        ),
        onRemove && !isUploading && /* @__PURE__ */ jsx56(
          "button",
          {
            className: "absolute top-1.5 right-1.5 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur-sm transition-opacity hover:bg-black/80 group-hover:opacity-100",
            onClick: onRemove,
            type: "button",
            children: /* @__PURE__ */ jsx56(CrossSmallIcon, { size: 10 })
          }
        )
      ]
    }
  );
};

// src/components/chatbot/weather.tsx
import cx2 from "classnames";
import { format, isWithinInterval } from "date-fns";
import { useEffect as useEffect21, useState as useState22 } from "react";
import { jsx as jsx57, jsxs as jsxs36 } from "react/jsx-runtime";
var SunIcon = ({ size = 40 }) => /* @__PURE__ */ jsxs36("svg", { fill: "none", height: size, viewBox: "0 0 24 24", width: size, children: [
  /* @__PURE__ */ jsx57("circle", { cx: "12", cy: "12", fill: "currentColor", r: "5" }),
  /* @__PURE__ */ jsx57("line", { stroke: "currentColor", strokeWidth: "2", x1: "12", x2: "12", y1: "1", y2: "3" }),
  /* @__PURE__ */ jsx57(
    "line",
    {
      stroke: "currentColor",
      strokeWidth: "2",
      x1: "12",
      x2: "12",
      y1: "21",
      y2: "23"
    }
  ),
  /* @__PURE__ */ jsx57(
    "line",
    {
      stroke: "currentColor",
      strokeWidth: "2",
      x1: "4.22",
      x2: "5.64",
      y1: "4.22",
      y2: "5.64"
    }
  ),
  /* @__PURE__ */ jsx57(
    "line",
    {
      stroke: "currentColor",
      strokeWidth: "2",
      x1: "18.36",
      x2: "19.78",
      y1: "18.36",
      y2: "19.78"
    }
  ),
  /* @__PURE__ */ jsx57("line", { stroke: "currentColor", strokeWidth: "2", x1: "1", x2: "3", y1: "12", y2: "12" }),
  /* @__PURE__ */ jsx57(
    "line",
    {
      stroke: "currentColor",
      strokeWidth: "2",
      x1: "21",
      x2: "23",
      y1: "12",
      y2: "12"
    }
  ),
  /* @__PURE__ */ jsx57(
    "line",
    {
      stroke: "currentColor",
      strokeWidth: "2",
      x1: "4.22",
      x2: "5.64",
      y1: "19.78",
      y2: "18.36"
    }
  ),
  /* @__PURE__ */ jsx57(
    "line",
    {
      stroke: "currentColor",
      strokeWidth: "2",
      x1: "18.36",
      x2: "19.78",
      y1: "5.64",
      y2: "4.22"
    }
  )
] });
var MoonIcon = ({ size = 40 }) => /* @__PURE__ */ jsx57("svg", { fill: "none", height: size, viewBox: "0 0 24 24", width: size, children: /* @__PURE__ */ jsx57(
  "path",
  {
    d: "M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79z",
    fill: "currentColor"
  }
) });
var CloudIcon = ({ size = 24 }) => /* @__PURE__ */ jsx57("svg", { fill: "none", height: size, viewBox: "0 0 24 24", width: size, children: /* @__PURE__ */ jsx57(
  "path",
  {
    d: "M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2"
  }
) });
var SAMPLE = {
  latitude: 37.763283,
  longitude: -122.41286,
  generationtime_ms: 0.027894973754882812,
  utc_offset_seconds: 0,
  timezone: "GMT",
  timezone_abbreviation: "GMT",
  elevation: 18,
  current_units: { time: "iso8601", interval: "seconds", temperature_2m: "\xB0C" },
  current: { time: "2024-10-07T19:30", interval: 900, temperature_2m: 29.3 },
  hourly_units: { time: "iso8601", temperature_2m: "\xB0C" },
  hourly: {
    time: [
      "2024-10-07T00:00",
      "2024-10-07T01:00",
      "2024-10-07T02:00",
      "2024-10-07T03:00",
      "2024-10-07T04:00",
      "2024-10-07T05:00",
      "2024-10-07T06:00",
      "2024-10-07T07:00",
      "2024-10-07T08:00",
      "2024-10-07T09:00",
      "2024-10-07T10:00",
      "2024-10-07T11:00",
      "2024-10-07T12:00",
      "2024-10-07T13:00",
      "2024-10-07T14:00",
      "2024-10-07T15:00",
      "2024-10-07T16:00",
      "2024-10-07T17:00",
      "2024-10-07T18:00",
      "2024-10-07T19:00",
      "2024-10-07T20:00",
      "2024-10-07T21:00",
      "2024-10-07T22:00",
      "2024-10-07T23:00",
      "2024-10-08T00:00",
      "2024-10-08T01:00",
      "2024-10-08T02:00",
      "2024-10-08T03:00",
      "2024-10-08T04:00",
      "2024-10-08T05:00",
      "2024-10-08T06:00",
      "2024-10-08T07:00",
      "2024-10-08T08:00",
      "2024-10-08T09:00",
      "2024-10-08T10:00",
      "2024-10-08T11:00",
      "2024-10-08T12:00",
      "2024-10-08T13:00",
      "2024-10-08T14:00",
      "2024-10-08T15:00",
      "2024-10-08T16:00",
      "2024-10-08T17:00",
      "2024-10-08T18:00",
      "2024-10-08T19:00",
      "2024-10-08T20:00",
      "2024-10-08T21:00",
      "2024-10-08T22:00",
      "2024-10-08T23:00",
      "2024-10-09T00:00",
      "2024-10-09T01:00",
      "2024-10-09T02:00",
      "2024-10-09T03:00",
      "2024-10-09T04:00",
      "2024-10-09T05:00",
      "2024-10-09T06:00",
      "2024-10-09T07:00",
      "2024-10-09T08:00",
      "2024-10-09T09:00",
      "2024-10-09T10:00",
      "2024-10-09T11:00",
      "2024-10-09T12:00",
      "2024-10-09T13:00",
      "2024-10-09T14:00",
      "2024-10-09T15:00",
      "2024-10-09T16:00",
      "2024-10-09T17:00",
      "2024-10-09T18:00",
      "2024-10-09T19:00",
      "2024-10-09T20:00",
      "2024-10-09T21:00",
      "2024-10-09T22:00",
      "2024-10-09T23:00",
      "2024-10-10T00:00",
      "2024-10-10T01:00",
      "2024-10-10T02:00",
      "2024-10-10T03:00",
      "2024-10-10T04:00",
      "2024-10-10T05:00",
      "2024-10-10T06:00",
      "2024-10-10T07:00",
      "2024-10-10T08:00",
      "2024-10-10T09:00",
      "2024-10-10T10:00",
      "2024-10-10T11:00",
      "2024-10-10T12:00",
      "2024-10-10T13:00",
      "2024-10-10T14:00",
      "2024-10-10T15:00",
      "2024-10-10T16:00",
      "2024-10-10T17:00",
      "2024-10-10T18:00",
      "2024-10-10T19:00",
      "2024-10-10T20:00",
      "2024-10-10T21:00",
      "2024-10-10T22:00",
      "2024-10-10T23:00",
      "2024-10-11T00:00",
      "2024-10-11T01:00",
      "2024-10-11T02:00",
      "2024-10-11T03:00"
    ],
    temperature_2m: [
      36.6,
      32.8,
      29.5,
      28.6,
      29.2,
      28.2,
      27.5,
      26.6,
      26.5,
      26,
      25,
      23.5,
      23.9,
      24.2,
      22.9,
      21,
      24,
      28.1,
      31.4,
      33.9,
      32.1,
      28.9,
      26.9,
      25.2,
      23,
      21.1,
      19.6,
      18.6,
      17.7,
      16.8,
      16.2,
      15.5,
      14.9,
      14.4,
      14.2,
      13.7,
      13.3,
      12.9,
      12.5,
      13.5,
      15.8,
      17.7,
      19.6,
      21,
      21.9,
      22.3,
      22,
      20.7,
      18.9,
      17.9,
      17.3,
      17,
      16.7,
      16.2,
      15.6,
      15.2,
      15,
      15,
      15.1,
      14.8,
      14.8,
      14.9,
      14.7,
      14.8,
      15.3,
      16.2,
      17.9,
      19.6,
      20.5,
      21.6,
      21,
      20.7,
      19.3,
      18.7,
      18.4,
      17.9,
      17.3,
      17,
      17,
      16.8,
      16.4,
      16.2,
      16,
      15.8,
      15.7,
      15.4,
      15.4,
      16.1,
      16.7,
      17,
      18.6,
      19,
      19.5,
      19.4,
      18.5,
      17.9,
      17.5,
      16.7,
      16.3,
      16.1
    ]
  },
  daily_units: {
    time: "iso8601",
    sunrise: "iso8601",
    sunset: "iso8601"
  },
  daily: {
    time: [
      "2024-10-07",
      "2024-10-08",
      "2024-10-09",
      "2024-10-10",
      "2024-10-11"
    ],
    sunrise: [
      "2024-10-07T07:15",
      "2024-10-08T07:16",
      "2024-10-09T07:17",
      "2024-10-10T07:18",
      "2024-10-11T07:19"
    ],
    sunset: [
      "2024-10-07T19:00",
      "2024-10-08T18:58",
      "2024-10-09T18:57",
      "2024-10-10T18:55",
      "2024-10-11T18:54"
    ]
  }
};
function n(num) {
  return Math.ceil(num);
}
function Weather({
  weatherAtLocation = SAMPLE
}) {
  const currentHigh = Math.max(
    ...weatherAtLocation.hourly.temperature_2m.slice(0, 24)
  );
  const currentLow = Math.min(
    ...weatherAtLocation.hourly.temperature_2m.slice(0, 24)
  );
  const isDay = isWithinInterval(new Date(weatherAtLocation.current.time), {
    start: new Date(weatherAtLocation.daily.sunrise[0]),
    end: new Date(weatherAtLocation.daily.sunset[0])
  });
  const [isMobile, setIsMobile] = useState22(false);
  useEffect21(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  const hoursToShow = isMobile ? 5 : 6;
  const currentTimeIndex = weatherAtLocation.hourly.time.findIndex(
    (time) => new Date(time) >= new Date(weatherAtLocation.current.time)
  );
  const displayTimes = weatherAtLocation.hourly.time.slice(
    currentTimeIndex,
    currentTimeIndex + hoursToShow
  );
  const displayTemperatures = weatherAtLocation.hourly.temperature_2m.slice(
    currentTimeIndex,
    currentTimeIndex + hoursToShow
  );
  const location = weatherAtLocation.cityName || `${weatherAtLocation.latitude?.toFixed(1)}\xB0, ${weatherAtLocation.longitude?.toFixed(1)}\xB0`;
  return /* @__PURE__ */ jsxs36(
    "div",
    {
      className: cx2(
        "relative flex w-full flex-col gap-3 overflow-hidden rounded-2xl p-4 shadow-lg backdrop-blur-sm",
        {
          "bg-gradient-to-br from-sky-400 via-blue-500 to-blue-600": isDay
        },
        {
          "bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900": !isDay
        }
      ),
      children: [
        /* @__PURE__ */ jsx57("div", { className: "absolute inset-0 bg-white/10 backdrop-blur-sm" }),
        /* @__PURE__ */ jsxs36("div", { className: "relative z-10", children: [
          /* @__PURE__ */ jsxs36("div", { className: "mb-2 flex items-center justify-between", children: [
            /* @__PURE__ */ jsx57("div", { className: "font-medium text-white/80 text-xs", children: location }),
            /* @__PURE__ */ jsx57("div", { className: "text-white/60 text-xs", children: format(new Date(weatherAtLocation.current.time), "MMM d, h:mm a") })
          ] }),
          /* @__PURE__ */ jsxs36("div", { className: "mb-3 flex items-center justify-between", children: [
            /* @__PURE__ */ jsxs36("div", { className: "flex items-center gap-3", children: [
              /* @__PURE__ */ jsx57(
                "div",
                {
                  className: cx2("text-white/90", {
                    "text-yellow-200": isDay,
                    "text-blue-200": !isDay
                  }),
                  children: isDay ? /* @__PURE__ */ jsx57(SunIcon, { size: 32 }) : /* @__PURE__ */ jsx57(MoonIcon, { size: 32 })
                }
              ),
              /* @__PURE__ */ jsxs36("div", { className: "font-light text-3xl text-white", children: [
                n(weatherAtLocation.current.temperature_2m),
                /* @__PURE__ */ jsx57("span", { className: "text-lg text-white/80", children: weatherAtLocation.current_units.temperature_2m })
              ] })
            ] }),
            /* @__PURE__ */ jsxs36("div", { className: "text-right", children: [
              /* @__PURE__ */ jsxs36("div", { className: "font-medium text-white/90 text-xs", children: [
                "H: ",
                n(currentHigh),
                "\xB0"
              ] }),
              /* @__PURE__ */ jsxs36("div", { className: "text-white/70 text-xs", children: [
                "L: ",
                n(currentLow),
                "\xB0"
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsxs36("div", { className: "rounded-xl bg-white/10 p-3 backdrop-blur-sm", children: [
            /* @__PURE__ */ jsx57("div", { className: "mb-2 font-medium text-white/80 text-xs", children: "Hourly Forecast" }),
            /* @__PURE__ */ jsx57("div", { className: "flex justify-between gap-1", children: displayTimes.map((time, index) => {
              const hourTime = new Date(time);
              const isCurrentHour = hourTime.getHours() === (/* @__PURE__ */ new Date()).getHours();
              return /* @__PURE__ */ jsxs36(
                "div",
                {
                  className: cx2(
                    "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-md px-1 py-1.5",
                    {
                      "bg-white/20": isCurrentHour
                    }
                  ),
                  children: [
                    /* @__PURE__ */ jsx57("div", { className: "font-medium text-white/70 text-xs", children: index === 0 ? "Now" : format(hourTime, "ha") }),
                    /* @__PURE__ */ jsx57(
                      "div",
                      {
                        className: cx2("text-white/60", {
                          "text-yellow-200": isDay,
                          "text-blue-200": !isDay
                        }),
                        children: /* @__PURE__ */ jsx57(CloudIcon, { size: 16 })
                      }
                    ),
                    /* @__PURE__ */ jsxs36("div", { className: "font-medium text-white text-xs", children: [
                      n(displayTemperatures[index]),
                      "\xB0"
                    ] })
                  ]
                },
                time
              );
            }) })
          ] }),
          /* @__PURE__ */ jsxs36("div", { className: "mt-2 flex justify-between text-white/60 text-xs", children: [
            /* @__PURE__ */ jsxs36("div", { children: [
              "Sunrise:",
              " ",
              format(new Date(weatherAtLocation.daily.sunrise[0]), "h:mm a")
            ] }),
            /* @__PURE__ */ jsxs36("div", { children: [
              "Sunset:",
              " ",
              format(new Date(weatherAtLocation.daily.sunset[0]), "h:mm a")
            ] })
          ] })
        ] })
      ]
    }
  );
}

// src/components/chatbot/message.tsx
import { Fragment as Fragment10, jsx as jsx58, jsxs as jsxs37 } from "react/jsx-runtime";
var PurePreviewMessage = ({
  addToolApprovalResponse,
  chatId,
  message: message2,
  vote: vote2,
  isLoading,
  setMessages: _setMessages,
  regenerate: _regenerate,
  isReadonly,
  requiresScrollPadding: _requiresScrollPadding,
  onEdit
}) => {
  const attachmentsFromMessage = message2.parts.filter(
    (part) => part.type === "file"
  );
  useDataStream();
  const isUser = message2.role === "user";
  const isAssistant = message2.role === "assistant";
  const hasAnyContent = message2.parts?.some(
    (part) => part.type === "text" && part.text?.trim().length > 0 || part.type === "reasoning" && "text" in part && part.text?.trim().length > 0 || part.type.startsWith("tool-")
  );
  const isThinking = isAssistant && isLoading && !hasAnyContent;
  const attachments = attachmentsFromMessage.length > 0 && /* @__PURE__ */ jsx58(
    "div",
    {
      className: "flex flex-row justify-end gap-2",
      "data-testid": "message-attachments",
      children: attachmentsFromMessage.map((attachment) => /* @__PURE__ */ jsx58(
        PreviewAttachment,
        {
          attachment: {
            name: attachment.filename ?? "file",
            contentType: attachment.mediaType,
            url: attachment.url
          }
        },
        attachment.url
      ))
    }
  );
  const mergedReasoning = message2.parts?.reduce(
    (acc, part) => {
      if (part.type === "reasoning" && part.text?.trim().length > 0) {
        return {
          text: acc.text ? `${acc.text}

${part.text}` : part.text,
          isStreaming: "state" in part ? part.state === "streaming" : false,
          rendered: false
        };
      }
      return acc;
    },
    { text: "", isStreaming: false, rendered: false }
  ) ?? { text: "", isStreaming: false, rendered: false };
  const parts = message2.parts?.map((part, index) => {
    const { type } = part;
    const key = `message-${message2.id}-part-${index}`;
    if (type === "reasoning") {
      if (!mergedReasoning.rendered && mergedReasoning.text) {
        mergedReasoning.rendered = true;
        return /* @__PURE__ */ jsx58(
          MessageReasoning,
          {
            isLoading: isLoading || mergedReasoning.isStreaming,
            reasoning: mergedReasoning.text
          },
          key
        );
      }
      return null;
    }
    if (type === "text") {
      return /* @__PURE__ */ jsx58(
        MessageContent,
        {
          className: cn("text-[13px] leading-[1.65]", {
            "w-fit max-w-[min(80%,56ch)] overflow-hidden break-words rounded-2xl rounded-br-lg border border-border/30 bg-gradient-to-br from-secondary to-muted px-3.5 py-2 shadow-[var(--shadow-card)]": message2.role === "user"
          }),
          "data-testid": "message-content",
          children: /* @__PURE__ */ jsx58(MessageResponse, { children: sanitizeText(part.text) })
        },
        key
      );
    }
    if (type === "tool-getWeather") {
      const { toolCallId, state } = part;
      const approvalId = part.approval?.id;
      const isDenied = state === "output-denied" || state === "approval-responded" && part.approval?.approved === false;
      const widthClass = "w-[min(100%,450px)]";
      if (state === "output-available") {
        return /* @__PURE__ */ jsx58("div", { className: widthClass, children: /* @__PURE__ */ jsx58(Weather, { weatherAtLocation: part.output }) }, toolCallId);
      }
      if (isDenied) {
        return /* @__PURE__ */ jsx58("div", { className: widthClass, children: /* @__PURE__ */ jsxs37(Tool2, { className: "w-full", defaultOpen: true, children: [
          /* @__PURE__ */ jsx58(ToolHeader, { state: "output-denied", type: "tool-getWeather" }),
          /* @__PURE__ */ jsx58(ToolContent, { children: /* @__PURE__ */ jsx58("div", { className: "px-4 py-3 text-muted-foreground text-sm", children: "Weather lookup was denied." }) })
        ] }) }, toolCallId);
      }
      if (state === "approval-responded") {
        return /* @__PURE__ */ jsx58("div", { className: widthClass, children: /* @__PURE__ */ jsxs37(Tool2, { className: "w-full", defaultOpen: true, children: [
          /* @__PURE__ */ jsx58(ToolHeader, { state, type: "tool-getWeather" }),
          /* @__PURE__ */ jsx58(ToolContent, { children: /* @__PURE__ */ jsx58(ToolInput, { input: part.input }) })
        ] }) }, toolCallId);
      }
      return /* @__PURE__ */ jsx58("div", { className: widthClass, children: /* @__PURE__ */ jsxs37(Tool2, { className: "w-full", defaultOpen: true, children: [
        /* @__PURE__ */ jsx58(ToolHeader, { state, type: "tool-getWeather" }),
        /* @__PURE__ */ jsxs37(ToolContent, { children: [
          (state === "input-available" || state === "approval-requested") && /* @__PURE__ */ jsx58(ToolInput, { input: part.input }),
          state === "approval-requested" && approvalId && /* @__PURE__ */ jsxs37("div", { className: "flex items-center justify-end gap-2 border-t px-4 py-3", children: [
            /* @__PURE__ */ jsx58(
              "button",
              {
                className: "rounded-md px-3 py-1.5 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground",
                onClick: () => {
                  addToolApprovalResponse({
                    id: approvalId,
                    approved: false,
                    reason: "User denied weather lookup"
                  });
                },
                type: "button",
                children: "Deny"
              }
            ),
            /* @__PURE__ */ jsx58(
              "button",
              {
                className: "rounded-md bg-primary px-3 py-1.5 text-primary-foreground text-sm transition-colors hover:bg-primary/90",
                onClick: () => {
                  addToolApprovalResponse({
                    id: approvalId,
                    approved: true
                  });
                },
                type: "button",
                children: "Allow"
              }
            )
          ] })
        ] })
      ] }) }, toolCallId);
    }
    if (type === "tool-createDocument") {
      const { toolCallId } = part;
      if (part.output && "error" in part.output) {
        return /* @__PURE__ */ jsxs37(
          "div",
          {
            className: "rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50",
            children: [
              "Error creating document: ",
              String(part.output.error)
            ]
          },
          toolCallId
        );
      }
      return /* @__PURE__ */ jsx58(
        DocumentPreview,
        {
          isReadonly,
          result: part.output
        },
        toolCallId
      );
    }
    if (type === "tool-updateDocument") {
      const { toolCallId } = part;
      if (part.output && "error" in part.output) {
        return /* @__PURE__ */ jsxs37(
          "div",
          {
            className: "rounded-lg border border-red-200 bg-red-50 p-4 text-red-500 dark:bg-red-950/50",
            children: [
              "Error updating document: ",
              String(part.output.error)
            ]
          },
          toolCallId
        );
      }
      return /* @__PURE__ */ jsx58("div", { className: "relative", children: /* @__PURE__ */ jsx58(
        DocumentPreview,
        {
          args: { ...part.output, isUpdate: true },
          isReadonly,
          result: part.output
        }
      ) }, toolCallId);
    }
    if (type === "tool-requestSuggestions") {
      const { toolCallId, state } = part;
      return /* @__PURE__ */ jsxs37(
        Tool2,
        {
          className: "w-[min(100%,450px)]",
          defaultOpen: true,
          children: [
            /* @__PURE__ */ jsx58(ToolHeader, { state, type: "tool-requestSuggestions" }),
            /* @__PURE__ */ jsxs37(ToolContent, { children: [
              state === "input-available" && /* @__PURE__ */ jsx58(ToolInput, { input: part.input }),
              state === "output-available" && /* @__PURE__ */ jsx58(
                ToolOutput,
                {
                  errorText: void 0,
                  output: "error" in part.output ? /* @__PURE__ */ jsxs37("div", { className: "rounded border p-2 text-red-500", children: [
                    "Error: ",
                    String(part.output.error)
                  ] }) : /* @__PURE__ */ jsx58(
                    DocumentToolResult,
                    {
                      isReadonly,
                      result: part.output,
                      type: "request-suggestions"
                    }
                  )
                }
              )
            ] })
          ]
        },
        toolCallId
      );
    }
    return null;
  });
  const actions = !isReadonly && /* @__PURE__ */ jsx58(
    MessageActions2,
    {
      chatId,
      isLoading,
      message: message2,
      onEdit: onEdit ? () => onEdit(message2) : void 0,
      vote: vote2
    },
    `action-${message2.id}`
  );
  const content = isThinking ? /* @__PURE__ */ jsx58("div", { className: "flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]", children: /* @__PURE__ */ jsx58(Shimmer, { className: "font-medium", duration: 1, children: "Thinking..." }) }) : /* @__PURE__ */ jsxs37(Fragment10, { children: [
    attachments,
    parts,
    actions
  ] });
  return /* @__PURE__ */ jsx58(
    "div",
    {
      className: cn(
        "group/message w-full",
        !isAssistant && "animate-[fade-up_0.25s_cubic-bezier(0.22,1,0.36,1)]"
      ),
      "data-role": message2.role,
      "data-testid": `message-${message2.role}`,
      children: /* @__PURE__ */ jsxs37(
        "div",
        {
          className: cn(
            isUser ? "flex flex-col items-end gap-2" : "flex items-start gap-3"
          ),
          children: [
            isAssistant && /* @__PURE__ */ jsx58("div", { className: "flex h-[calc(13px*1.65)] shrink-0 items-center", children: /* @__PURE__ */ jsx58("div", { className: "flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50", children: /* @__PURE__ */ jsx58(SparklesIcon, { size: 13 }) }) }),
            isAssistant ? /* @__PURE__ */ jsx58("div", { className: "flex min-w-0 flex-1 flex-col gap-2", children: content }) : content
          ]
        }
      )
    }
  );
};
var PreviewMessage = PurePreviewMessage;
var ThinkingMessage = () => {
  return /* @__PURE__ */ jsx58(
    "div",
    {
      className: "group/message w-full",
      "data-role": "assistant",
      "data-testid": "message-assistant-loading",
      children: /* @__PURE__ */ jsxs37("div", { className: "flex items-start gap-3", children: [
        /* @__PURE__ */ jsx58("div", { className: "flex h-[calc(13px*1.65)] shrink-0 items-center", children: /* @__PURE__ */ jsx58("div", { className: "flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground ring-1 ring-border/50", children: /* @__PURE__ */ jsx58(SparklesIcon, { size: 13 }) }) }),
        /* @__PURE__ */ jsx58("div", { className: "flex h-[calc(13px*1.65)] items-center text-[13px] leading-[1.65]", children: /* @__PURE__ */ jsx58(Shimmer, { className: "font-medium", duration: 1, children: "Thinking..." }) })
      ] })
    }
  );
};

// src/components/chatbot/messages.tsx
import { jsx as jsx59, jsxs as jsxs38 } from "react/jsx-runtime";
function PureMessages({
  addToolApprovalResponse,
  chatId,
  status,
  votes,
  messages,
  setMessages,
  regenerate,
  isReadonly,
  isArtifactVisible,
  isLoading,
  selectedModelId: _selectedModelId,
  onEditMessage
}) {
  const {
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    isAtBottom,
    scrollToBottom,
    hasSentMessage,
    reset
  } = useMessages({
    status
  });
  useDataStream();
  const prevChatIdRef = useRef13(chatId);
  useEffect22(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      reset();
    }
  }, [chatId, reset]);
  return /* @__PURE__ */ jsxs38("div", { className: "relative flex-1 bg-background", children: [
    messages.length === 0 && !isLoading && /* @__PURE__ */ jsx59("div", { className: "pointer-events-none absolute inset-0 z-10 flex items-center justify-center", children: /* @__PURE__ */ jsx59(Greeting, {}) }),
    /* @__PURE__ */ jsx59(
      "div",
      {
        className: cn(
          "absolute inset-0 touch-pan-y overflow-y-auto",
          messages.length > 0 ? "bg-background" : "bg-transparent"
        ),
        ref: messagesContainerRef,
        style: isArtifactVisible ? { scrollbarWidth: "none" } : void 0,
        children: /* @__PURE__ */ jsxs38("div", { className: "mx-auto flex min-h-full min-w-0 max-w-4xl flex-col gap-5 px-2 py-6 md:gap-7 md:px-4", children: [
          messages.map((message2, index) => /* @__PURE__ */ jsx59(
            PreviewMessage,
            {
              addToolApprovalResponse,
              chatId,
              isLoading: status === "streaming" && messages.length - 1 === index,
              isReadonly,
              message: message2,
              onEdit: onEditMessage,
              regenerate,
              requiresScrollPadding: hasSentMessage && index === messages.length - 1,
              setMessages,
              vote: votes ? votes.find((vote2) => vote2.messageId === message2.id) : void 0
            },
            message2.id
          )),
          status === "submitted" && messages.at(-1)?.role !== "assistant" && /* @__PURE__ */ jsx59(ThinkingMessage, {}),
          /* @__PURE__ */ jsx59(
            "div",
            {
              className: "min-h-[24px] min-w-[24px] shrink-0",
              ref: messagesEndRef
            }
          )
        ] })
      }
    ),
    /* @__PURE__ */ jsx59(
      "button",
      {
        "aria-label": "Scroll to bottom",
        className: `absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center rounded-full border border-border/50 bg-card/90 px-3.5 shadow-[var(--shadow-float)] backdrop-blur-lg transition-all duration-200 h-7 text-[10px] ${isAtBottom ? "pointer-events-none scale-90 opacity-0" : "pointer-events-auto scale-100 opacity-100"}`,
        onClick: () => scrollToBottom("smooth"),
        type: "button",
        children: /* @__PURE__ */ jsx59(ArrowDownIcon, { className: "size-3 text-muted-foreground" })
      }
    )
  ] });
}
var Messages = PureMessages;

// src/components/chatbot/multimodal-input.tsx
import equal4 from "fast-deep-equal";
import {
  ArrowUpIcon as ArrowUpIcon2,
  BrainIcon,
  EyeIcon,
  LockIcon as LockIcon2,
  WrenchIcon as WrenchIcon3
} from "lucide-react";
import { useRouter as useRouter4 } from "next/navigation";
import { useTheme as useTheme3 } from "next-themes";
import {
  memo as memo18,
  useCallback as useCallback13,
  useEffect as useEffect25,
  useRef as useRef16,
  useState as useState24
} from "react";
import { toast as toast11 } from "sonner";
import useSWR6 from "swr";
import { useLocalStorage, useWindowSize as useWindowSize2 } from "usehooks-ts";

// src/components/ui/command.tsx
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";

// src/components/ui/dialog.tsx
import { XIcon as XIcon3 } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { jsx as jsx60, jsxs as jsxs39 } from "react/jsx-runtime";

// src/components/ui/input-group.tsx
import { cva as cva5 } from "class-variance-authority";

// src/components/ui/textarea.tsx
import { jsx as jsx61 } from "react/jsx-runtime";
function Textarea({ className, ...props }) {
  return /* @__PURE__ */ jsx61(
    "textarea",
    {
      className: cn(
        "flex field-sizing-content min-h-16 w-full resize-none rounded-xl border border-input bg-input/30 px-3 py-3 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      ),
      "data-slot": "textarea",
      ...props
    }
  );
}

// src/components/ui/input-group.tsx
import { jsx as jsx62 } from "react/jsx-runtime";
function InputGroup({ className, ...props }) {
  return /* @__PURE__ */ jsx62(
    "div",
    {
      className: cn(
        "group/input-group relative flex h-9 w-full min-w-0 items-center rounded-4xl border border-input bg-input/30 transition-colors outline-none in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0 has-data-[align=block-end]:rounded-2xl has-data-[align=block-start]:rounded-2xl has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-[3px] has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50 has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-[3px] has-[[data-slot][aria-invalid=true]]:ring-destructive/20 has-[textarea]:rounded-xl has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col has-[>textarea]:h-auto dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40 has-[>[data-align=block-end]]:[&>input]:pt-3 has-[>[data-align=block-start]]:[&>input]:pb-3 has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        className
      ),
      "data-slot": "input-group",
      role: "group",
      ...props
    }
  );
}
var inputGroupAddonVariants = cva5(
  "flex h-auto cursor-text items-center justify-center gap-2 py-2 text-sm font-medium text-muted-foreground select-none group-data-[disabled=true]/input-group:opacity-50 **:data-[slot=kbd]:rounded-4xl **:data-[slot=kbd]:bg-muted-foreground/10 **:data-[slot=kbd]:px-1.5 [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        "inline-start": "order-first pl-3 has-[>button]:-ml-1 has-[>kbd]:ml-[-0.15rem]",
        "inline-end": "order-last pr-3 has-[>button]:-mr-1 has-[>kbd]:mr-[-0.15rem]",
        "block-start": "order-first w-full justify-start px-3 pt-3 group-has-[>input]/input-group:pt-3 [.border-b]:pb-3",
        "block-end": "order-last w-full justify-start px-3 pb-3 group-has-[>input]/input-group:pb-3 [.border-t]:pt-3"
      }
    },
    defaultVariants: {
      align: "inline-start"
    }
  }
);
function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}) {
  return /* @__PURE__ */ jsx62(
    "div",
    {
      className: cn(inputGroupAddonVariants({ align }), className),
      "data-align": align,
      "data-slot": "input-group-addon",
      onClick: (e) => {
        if (e.target.closest("button")) {
          return;
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus();
      },
      role: "group",
      ...props
    }
  );
}
var inputGroupButtonVariants = cva5(
  "flex items-center gap-2 rounded-4xl text-sm shadow-none",
  {
    variants: {
      size: {
        xs: "h-6 gap-1 px-1.5 [&>svg:not([class*='size-'])]:size-3.5",
        sm: "",
        "icon-xs": "size-6 p-0 has-[>svg]:p-0",
        "icon-sm": "size-8 p-0 has-[>svg]:p-0"
      }
    },
    defaultVariants: {
      size: "xs"
    }
  }
);
function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}) {
  return /* @__PURE__ */ jsx62(
    Button,
    {
      className: cn(inputGroupButtonVariants({ size }), className),
      "data-size": size,
      type,
      variant,
      ...props
    }
  );
}
function InputGroupTextarea({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx62(
    Textarea,
    {
      className: cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent",
        className
      ),
      "data-slot": "input-group-control",
      ...props
    }
  );
}

// src/components/ui/command.tsx
import { jsx as jsx63, jsxs as jsxs40 } from "react/jsx-runtime";
function Command({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx63(
    CommandPrimitive,
    {
      className: cn(
        "flex size-full flex-col overflow-hidden rounded-4xl bg-popover p-1 text-popover-foreground",
        className
      ),
      "data-slot": "command",
      ...props
    }
  );
}
function CommandInput({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx63("div", { className: "p-1 pb-0", "data-slot": "command-input-wrapper", children: /* @__PURE__ */ jsxs40(InputGroup, { className: "h-9 bg-input/30", children: [
    /* @__PURE__ */ jsx63(
      CommandPrimitive.Input,
      {
        className: cn(
          "w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className
        ),
        "data-slot": "command-input",
        ...props
      }
    ),
    /* @__PURE__ */ jsx63(InputGroupAddon, { children: /* @__PURE__ */ jsx63(SearchIcon, { className: "size-4 shrink-0 opacity-50" }) })
  ] }) });
}
function CommandList({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx63(
    CommandPrimitive.List,
    {
      className: cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      ),
      "data-slot": "command-list",
      ...props
    }
  );
}
function CommandGroup({
  className,
  ...props
}) {
  return /* @__PURE__ */ jsx63(
    CommandPrimitive.Group,
    {
      className: cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-3 **:[[cmdk-group-heading]]:py-2 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className
      ),
      "data-slot": "command-group",
      ...props
    }
  );
}
function CommandItem({
  className,
  children,
  ...props
}) {
  return /* @__PURE__ */ jsx63(
    CommandPrimitive.Item,
    {
      className: cn(
        "group/command-item relative flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-2xl data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:*:[svg]:text-foreground",
        className
      ),
      "data-slot": "command-item",
      ...props,
      children
    }
  );
}

// src/components/ui/popover.tsx
import { Popover } from "radix-ui";
import { jsx as jsx64 } from "react/jsx-runtime";
function PopoverRoot({ ...props }) {
  return /* @__PURE__ */ jsx64(Popover.Root, { "data-slot": "popover", ...props });
}
function PopoverTrigger({
  ...props
}) {
  return /* @__PURE__ */ jsx64(Popover.Trigger, { "data-slot": "popover-trigger", ...props });
}
function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}) {
  return /* @__PURE__ */ jsx64(Popover.Portal, { children: /* @__PURE__ */ jsx64(
    Popover.Content,
    {
      align,
      className: cn(
        "z-50 w-72 rounded-xl border border-border/60 bg-card/95 p-4 shadow-[var(--shadow-float)] backdrop-blur-xl outline-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      ),
      "data-slot": "popover-content",
      sideOffset,
      ...props
    }
  ) });
}

// src/components/ai-elements/model-selector.tsx
import { jsx as jsx65 } from "react/jsx-runtime";
var ModelSelector = (props) => /* @__PURE__ */ jsx65(PopoverRoot, { ...props });
var ModelSelectorTrigger = (props) => /* @__PURE__ */ jsx65(PopoverTrigger, { ...props });
var ModelSelectorContent = ({
  className,
  children,
  title: _title,
  ...props
}) => /* @__PURE__ */ jsx65(
  PopoverContent,
  {
    align: "start",
    className: cn(
      "w-[280px] p-0 rounded-xl border border-border/60 bg-card/95 backdrop-blur-xl shadow-[var(--shadow-float)]",
      className
    ),
    side: "top",
    sideOffset: 8,
    ...props,
    children: /* @__PURE__ */ jsx65(Command, { className: "**:data-[slot=command-input-wrapper]:h-auto", children })
  }
);
var ModelSelectorInput = ({
  className,
  ...props
}) => /* @__PURE__ */ jsx65(
  CommandInput,
  {
    className: cn("h-auto py-2.5 text-[13px]", className),
    ...props
  }
);
var ModelSelectorList = ({
  className,
  ...props
}) => /* @__PURE__ */ jsx65(CommandList, { className: cn("max-h-[280px]", className), ...props });
var ModelSelectorGroup = (props) => /* @__PURE__ */ jsx65(CommandGroup, { ...props });
var ModelSelectorItem = ({
  className,
  ...props
}) => /* @__PURE__ */ jsx65(
  CommandItem,
  {
    className: cn("w-full text-[13px] rounded-lg", className),
    ...props
  }
);
var ModelSelectorLogo = ({
  provider,
  className,
  ...props
}) => /* @__PURE__ */ jsx65(
  "img",
  {
    ...props,
    alt: `${provider} logo`,
    className: cn("size-4 dark:invert", className),
    height: 16,
    src: `https://models.dev/logos/${provider}.svg`,
    width: 16
  }
);
var ModelSelectorName = ({
  className,
  ...props
}) => /* @__PURE__ */ jsx65("span", { className: cn("flex-1 truncate text-left", className), ...props });

// src/components/ai-elements/prompt-input.tsx
import {
  CornerDownLeftIcon,
  ImageIcon as ImageIcon2,
  PlusIcon,
  SquareIcon,
  XIcon as XIcon4
} from "lucide-react";
import { nanoid as nanoid2 } from "nanoid";
import {
  Children,
  createContext as createContext8,
  useCallback as useCallback11,
  useContext as useContext8,
  useEffect as useEffect23,
  useMemo as useMemo13,
  useRef as useRef14,
  useState as useState23
} from "react";

// src/components/ui/hover-card.tsx
import { HoverCard as HoverCardPrimitive } from "radix-ui";
import { jsx as jsx66 } from "react/jsx-runtime";

// src/components/ai-elements/prompt-input.tsx
import { Fragment as Fragment11, jsx as jsx67, jsxs as jsxs41 } from "react/jsx-runtime";
var convertBlobUrlToDataUrl = async (url) => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};
var PromptInputController = createContext8(
  null
);
var ProviderAttachmentsContext = createContext8(
  null
);
var useOptionalPromptInputController = () => useContext8(PromptInputController);
var useOptionalProviderAttachments = () => useContext8(ProviderAttachmentsContext);
var LocalAttachmentsContext = createContext8(null);
var usePromptInputAttachments = () => {
  const provider = useOptionalProviderAttachments();
  const local = useContext8(LocalAttachmentsContext);
  const context = local ?? provider;
  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within a PromptInput or PromptInputProvider"
    );
  }
  return context;
};
var LocalReferencedSourcesContext = createContext8(null);
var PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  syncHiddenInput,
  maxFiles,
  maxFileSize,
  onError,
  onSubmit,
  children,
  ...props
}) => {
  const controller = useOptionalPromptInputController();
  const usingProvider = !!controller;
  const inputRef = useRef14(null);
  const formRef = useRef14(null);
  const [items, setItems] = useState23([]);
  const files = usingProvider ? controller.attachments.files : items;
  const [referencedSources, setReferencedSources] = useState23([]);
  const filesRef = useRef14(files);
  useEffect23(() => {
    filesRef.current = files;
  }, [files]);
  const openFileDialogLocal = useCallback11(() => {
    inputRef.current?.click();
  }, []);
  const matchesAccept = useCallback11(
    (f) => {
      if (!accept || accept.trim() === "") {
        return true;
      }
      const patterns = accept.split(",").map((s) => s.trim()).filter(Boolean);
      return patterns.some((pattern) => {
        if (pattern.endsWith("/*")) {
          const prefix = pattern.slice(0, -1);
          return f.type.startsWith(prefix);
        }
        return f.type === pattern;
      });
    },
    [accept]
  );
  const addLocal = useCallback11(
    (fileList) => {
      const incoming = [...fileList];
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types."
        });
        return;
      }
      const withinSize = (f) => maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size."
        });
        return;
      }
      setItems((prev) => {
        const capacity = typeof maxFiles === "number" ? Math.max(0, maxFiles - prev.length) : void 0;
        const capped = typeof capacity === "number" ? sized.slice(0, capacity) : sized;
        if (typeof capacity === "number" && sized.length > capacity) {
          onError?.({
            code: "max_files",
            message: "Too many files. Some were not added."
          });
        }
        const next = [];
        for (const file of capped) {
          next.push({
            filename: file.name,
            id: nanoid2(),
            mediaType: file.type,
            type: "file",
            url: URL.createObjectURL(file)
          });
        }
        return [...prev, ...next];
      });
    },
    [matchesAccept, maxFiles, maxFileSize, onError]
  );
  const removeLocal = useCallback11(
    (id) => setItems((prev) => {
      const found = prev.find((file) => file.id === id);
      if (found?.url) {
        URL.revokeObjectURL(found.url);
      }
      return prev.filter((file) => file.id !== id);
    }),
    []
  );
  const addWithProviderValidation = useCallback11(
    (fileList) => {
      const incoming = [...fileList];
      const accepted = incoming.filter((f) => matchesAccept(f));
      if (incoming.length && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types."
        });
        return;
      }
      const withinSize = (f) => maxFileSize ? f.size <= maxFileSize : true;
      const sized = accepted.filter(withinSize);
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size."
        });
        return;
      }
      const currentCount = files.length;
      const capacity = typeof maxFiles === "number" ? Math.max(0, maxFiles - currentCount) : void 0;
      const capped = typeof capacity === "number" ? sized.slice(0, capacity) : sized;
      if (typeof capacity === "number" && sized.length > capacity) {
        onError?.({
          code: "max_files",
          message: "Too many files. Some were not added."
        });
      }
      if (capped.length > 0) {
        controller?.attachments.add(capped);
      }
    },
    [matchesAccept, maxFileSize, maxFiles, onError, files.length, controller]
  );
  const clearAttachments = useCallback11(
    () => usingProvider ? controller?.attachments.clear() : setItems((prev) => {
      for (const file of prev) {
        if (file.url) {
          URL.revokeObjectURL(file.url);
        }
      }
      return [];
    }),
    [usingProvider, controller]
  );
  const clearReferencedSources = useCallback11(
    () => setReferencedSources([]),
    []
  );
  const add = usingProvider ? addWithProviderValidation : addLocal;
  const remove = usingProvider ? controller.attachments.remove : removeLocal;
  const openFileDialog = usingProvider ? controller.attachments.openFileDialog : openFileDialogLocal;
  const clear = useCallback11(() => {
    clearAttachments();
    clearReferencedSources();
  }, [clearAttachments, clearReferencedSources]);
  useEffect23(() => {
    if (!usingProvider) {
      return;
    }
    controller.__registerFileInput(inputRef, () => inputRef.current?.click());
  }, [usingProvider, controller]);
  useEffect23(() => {
    if (syncHiddenInput && inputRef.current && files.length === 0) {
      inputRef.current.value = "";
    }
  }, [files, syncHiddenInput]);
  useEffect23(() => {
    const form = formRef.current;
    if (!form) {
      return;
    }
    if (globalDrop) {
      return;
    }
    const onDragOver = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    form.addEventListener("dragover", onDragOver);
    form.addEventListener("drop", onDrop);
    return () => {
      form.removeEventListener("dragover", onDragOver);
      form.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);
  useEffect23(() => {
    if (!globalDrop) {
      return;
    }
    const onDragOver = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    const onDrop = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        add(e.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);
  useEffect23(
    () => () => {
      if (!usingProvider) {
        for (const f of filesRef.current) {
          if (f.url) {
            URL.revokeObjectURL(f.url);
          }
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup only on unmount; filesRef always current
    [usingProvider]
  );
  const handleChange = useCallback11(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files);
      }
      event.currentTarget.value = "";
    },
    [add]
  );
  const attachmentsCtx = useMemo13(
    () => ({
      add,
      clear: clearAttachments,
      fileInputRef: inputRef,
      files: files.map((item) => ({ ...item, id: item.id })),
      openFileDialog,
      remove
    }),
    [files, add, remove, clearAttachments, openFileDialog]
  );
  const refsCtx = useMemo13(
    () => ({
      add: (incoming) => {
        const array = Array.isArray(incoming) ? incoming : [incoming];
        setReferencedSources((prev) => [
          ...prev,
          ...array.map((s) => ({ ...s, id: nanoid2() }))
        ]);
      },
      clear: clearReferencedSources,
      remove: (id) => {
        setReferencedSources((prev) => prev.filter((s) => s.id !== id));
      },
      sources: referencedSources
    }),
    [referencedSources, clearReferencedSources]
  );
  const handleSubmit = useCallback11(
    async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const text2 = usingProvider ? controller.textInput.value : (() => {
        const formData = new FormData(form);
        return formData.get("message") || "";
      })();
      if (!usingProvider) {
        form.reset();
      }
      try {
        const convertedFiles = await Promise.all(
          files.map(async ({ id: _id, ...item }) => {
            if (item.url?.startsWith("blob:")) {
              const dataUrl = await convertBlobUrlToDataUrl(item.url);
              return {
                ...item,
                url: dataUrl ?? item.url
              };
            }
            return item;
          })
        );
        const result = onSubmit({ files: convertedFiles, text: text2 }, event);
        if (result instanceof Promise) {
          try {
            await result;
            clear();
            if (usingProvider) {
              controller.textInput.clear();
            }
          } catch {
          }
        } else {
          clear();
          if (usingProvider) {
            controller.textInput.clear();
          }
        }
      } catch {
      }
    },
    [usingProvider, controller, files, onSubmit, clear]
  );
  const inner = /* @__PURE__ */ jsxs41(Fragment11, { children: [
    /* @__PURE__ */ jsx67(
      "input",
      {
        accept,
        "aria-label": "Upload files",
        className: "hidden",
        multiple,
        onChange: handleChange,
        ref: inputRef,
        title: "Upload files",
        type: "file"
      }
    ),
    /* @__PURE__ */ jsx67(
      "form",
      {
        className: cn("w-full", className),
        onSubmit: handleSubmit,
        ref: formRef,
        ...props,
        children: /* @__PURE__ */ jsx67(InputGroup, { className: "overflow-hidden", children })
      }
    )
  ] });
  const withReferencedSources = /* @__PURE__ */ jsx67(LocalReferencedSourcesContext.Provider, { value: refsCtx, children: inner });
  return /* @__PURE__ */ jsx67(LocalAttachmentsContext.Provider, { value: attachmentsCtx, children: withReferencedSources });
};
var PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = "What would you like to know?",
  ...props
}) => {
  const controller = useOptionalPromptInputController();
  const attachments = usePromptInputAttachments();
  const [isComposing, setIsComposing] = useState23(false);
  const handleKeyDown = useCallback11(
    (e) => {
      onKeyDown?.(e);
      if (e.defaultPrevented) {
        return;
      }
      if (e.key === "Enter") {
        if (isComposing || e.nativeEvent.isComposing) {
          return;
        }
        if (e.shiftKey) {
          return;
        }
        e.preventDefault();
        const { form } = e.currentTarget;
        const submitButton = form?.querySelector(
          'button[type="submit"]'
        );
        if (submitButton?.disabled) {
          return;
        }
        form?.requestSubmit();
      }
      if (e.key === "Backspace" && e.currentTarget.value === "" && attachments.files.length > 0) {
        e.preventDefault();
        const lastAttachment = attachments.files.at(-1);
        if (lastAttachment) {
          attachments.remove(lastAttachment.id);
        }
      }
    },
    [onKeyDown, isComposing, attachments]
  );
  const handlePaste = useCallback11(
    (event) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      const files = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }
      if (files.length > 0) {
        event.preventDefault();
        attachments.add(files);
      }
    },
    [attachments]
  );
  const handleCompositionEnd = useCallback11(() => setIsComposing(false), []);
  const handleCompositionStart = useCallback11(() => setIsComposing(true), []);
  const controlledProps = controller ? {
    onChange: (e) => {
      controller.textInput.setInput(e.currentTarget.value);
      onChange?.(e);
    },
    value: controller.textInput.value
  } : {
    onChange
  };
  return /* @__PURE__ */ jsx67(
    InputGroupTextarea,
    {
      className: cn("field-sizing-content max-h-48 min-h-16", className),
      name: "message",
      onCompositionEnd: handleCompositionEnd,
      onCompositionStart: handleCompositionStart,
      onKeyDown: handleKeyDown,
      onPaste: handlePaste,
      placeholder,
      ...props,
      ...controlledProps
    }
  );
};
var PromptInputFooter = ({
  className,
  ...props
}) => /* @__PURE__ */ jsx67(
  InputGroupAddon,
  {
    align: "block-end",
    className: cn("justify-between gap-1", className),
    ...props
  }
);
var PromptInputTools = ({
  className,
  ...props
}) => /* @__PURE__ */ jsx67(
  "div",
  {
    className: cn("flex min-w-0 items-center gap-1", className),
    ...props
  }
);
var PromptInputSubmit = ({
  className,
  variant = "default",
  size = "icon-sm",
  status,
  onStop,
  onClick,
  children,
  ...props
}) => {
  const isGenerating = status === "submitted" || status === "streaming";
  let Icon = /* @__PURE__ */ jsx67(CornerDownLeftIcon, { className: "size-4" });
  if (status === "submitted") {
    Icon = /* @__PURE__ */ jsx67(Spinner, {});
  } else if (status === "streaming") {
    Icon = /* @__PURE__ */ jsx67(SquareIcon, { className: "size-4" });
  } else if (status === "error") {
    Icon = /* @__PURE__ */ jsx67(XIcon4, { className: "size-4" });
  }
  const handleClick = useCallback11(
    (e) => {
      if (isGenerating && onStop) {
        e.preventDefault();
        onStop();
        return;
      }
      onClick?.(e);
    },
    [isGenerating, onStop, onClick]
  );
  return /* @__PURE__ */ jsx67(
    InputGroupButton,
    {
      "aria-label": isGenerating ? "Stop" : "Submit",
      className: cn(className),
      onClick: handleClick,
      size,
      type: isGenerating && onStop ? "button" : "submit",
      variant,
      ...props,
      children: children ?? Icon
    }
  );
};

// src/components/chatbot/slash-commands.tsx
import {
  BombIcon,
  ListIcon,
  PaletteIcon,
  PenLineIcon,
  PenSquareIcon as PenSquareIcon2,
  Trash2Icon,
  XIcon as XIcon5
} from "lucide-react";
import { useEffect as useEffect24, useRef as useRef15 } from "react";
import { jsx as jsx68, jsxs as jsxs42 } from "react/jsx-runtime";
var slashCommands = [
  {
    name: "new",
    description: "Start a new chat",
    icon: /* @__PURE__ */ jsx68(PenSquareIcon2, { className: "size-3.5" }),
    action: "new"
  },
  {
    name: "clear",
    description: "Clear current chat",
    icon: /* @__PURE__ */ jsx68(Trash2Icon, { className: "size-3.5" }),
    action: "clear"
  },
  {
    name: "rename",
    description: "Rename current chat",
    icon: /* @__PURE__ */ jsx68(PenLineIcon, { className: "size-3.5" }),
    action: "rename"
  },
  {
    name: "model",
    description: "Change the AI model",
    icon: /* @__PURE__ */ jsx68(ListIcon, { className: "size-3.5" }),
    action: "model"
  },
  {
    name: "theme",
    description: "Toggle dark/light mode",
    icon: /* @__PURE__ */ jsx68(PaletteIcon, { className: "size-3.5" }),
    action: "theme"
  },
  {
    name: "delete",
    description: "Delete current chat",
    icon: /* @__PURE__ */ jsx68(XIcon5, { className: "size-3.5" }),
    action: "delete"
  },
  {
    name: "purge",
    description: "Delete all chats",
    icon: /* @__PURE__ */ jsx68(BombIcon, { className: "size-3.5" }),
    action: "purge"
  }
];
function SlashCommandMenu({
  query,
  onSelect,
  onClose: _onClose,
  selectedIndex
}) {
  const menuRef = useRef15(null);
  const filtered = slashCommands.filter(
    (cmd) => cmd.name.startsWith(query.toLowerCase())
  );
  useEffect24(() => {
    const selected = menuRef.current?.querySelector("[data-selected='true']");
    if (selected) {
      selected.scrollIntoView({ block: "nearest" });
    }
  }, []);
  if (filtered.length === 0) {
    return null;
  }
  return /* @__PURE__ */ jsxs42(
    "div",
    {
      className: "absolute bottom-full left-0 right-0 z-50 mb-2 overflow-hidden rounded-xl border border-border/50 bg-card/95 shadow-[var(--shadow-float)] backdrop-blur-xl",
      ref: menuRef,
      children: [
        /* @__PURE__ */ jsx68("div", { className: "px-4 py-2.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/40", children: "Commands" }),
        /* @__PURE__ */ jsx68("div", { className: "max-h-64 overflow-y-auto pb-1 no-scrollbar", children: filtered.map((cmd, index) => /* @__PURE__ */ jsxs42(
          "button",
          {
            className: cn(
              "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
              index === selectedIndex ? "bg-muted/70" : "hover:bg-muted/40"
            ),
            "data-selected": index === selectedIndex,
            onClick: () => onSelect(cmd),
            onMouseDown: (e) => e.preventDefault(),
            type: "button",
            children: [
              /* @__PURE__ */ jsx68("div", { className: "flex size-6 shrink-0 items-center justify-center text-muted-foreground/60", children: cmd.icon }),
              /* @__PURE__ */ jsxs42("span", { className: "font-mono text-[13px] text-foreground", children: [
                "/",
                cmd.name
              ] }),
              /* @__PURE__ */ jsx68("span", { className: "text-[12px] text-muted-foreground/50", children: cmd.description }),
              cmd.shortcut && /* @__PURE__ */ jsx68("span", { className: "ml-auto text-[11px] text-muted-foreground/30", children: cmd.shortcut })
            ]
          },
          cmd.name
        )) })
      ]
    }
  );
}

// src/components/chatbot/suggested-actions.tsx
import { motion as motion8 } from "framer-motion";
import { memo as memo17 } from "react";

// lib/constants.ts
var isProductionEnvironment = process.env.NODE_ENV === "production";
var isDevelopmentEnvironment = process.env.NODE_ENV === "development";
var isTestEnvironment = Boolean(
  process.env.PLAYWRIGHT_TEST_BASE_URL || process.env.PLAYWRIGHT || process.env.CI_PLAYWRIGHT
);
var DUMMY_PASSWORD = generateDummyPassword();
var suggestions = [
  "What are the advantages of using Next.js?",
  "Write code to demonstrate Dijkstra's algorithm",
  "Help me write an essay about Silicon Valley",
  "What is the weather in San Francisco?"
];

// src/components/ai-elements/suggestion.tsx
import { useCallback as useCallback12 } from "react";

// src/components/ui/scroll-area.tsx
import { ScrollArea as ScrollAreaPrimitive } from "radix-ui";
import { jsx as jsx69, jsxs as jsxs43 } from "react/jsx-runtime";

// src/components/ai-elements/suggestion.tsx
import { jsx as jsx70, jsxs as jsxs44 } from "react/jsx-runtime";
var Suggestion = ({
  suggestion: suggestion2,
  onClick,
  className,
  variant = "outline",
  size = "sm",
  children,
  ...props
}) => {
  const handleClick = useCallback12(() => {
    onClick?.(suggestion2);
  }, [onClick, suggestion2]);
  return /* @__PURE__ */ jsx70(
    Button,
    {
      className: cn("cursor-pointer rounded-full px-4", className),
      onClick: handleClick,
      size,
      type: "button",
      variant,
      ...props,
      children: children || suggestion2
    }
  );
};

// src/components/chatbot/suggested-actions.tsx
import { jsx as jsx71 } from "react/jsx-runtime";
function PureSuggestedActions({ chatId, sendMessage }) {
  const suggestedActions = suggestions;
  return /* @__PURE__ */ jsx71(
    "div",
    {
      className: "flex w-full gap-2.5 overflow-x-auto pb-1 sm:grid sm:grid-cols-2 sm:overflow-visible",
      "data-testid": "suggested-actions",
      style: {
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
        msOverflowStyle: "none"
      },
      children: suggestedActions.map((suggestedAction, index) => /* @__PURE__ */ jsx71(
        motion8.div,
        {
          animate: { opacity: 1, y: 0 },
          className: "min-w-[200px] shrink-0 sm:min-w-0 sm:shrink",
          exit: { opacity: 0, y: 16 },
          initial: { opacity: 0, y: 16 },
          transition: {
            delay: 0.06 * index,
            duration: 0.4,
            ease: [0.22, 1, 0.36, 1]
          },
          children: /* @__PURE__ */ jsx71(
            Suggestion,
            {
              className: "h-auto w-full whitespace-nowrap rounded-xl border border-border/50 bg-card/30 px-4 py-3 text-left text-[12px] leading-relaxed text-muted-foreground transition-all duration-200 sm:whitespace-normal sm:p-4 sm:text-[13px] hover:-translate-y-0.5 hover:bg-card/60 hover:text-foreground hover:shadow-[var(--shadow-card)]",
              onClick: (suggestion2) => {
                window.history.pushState(
                  {},
                  "",
                  `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
                );
                sendMessage({
                  role: "user",
                  parts: [{ type: "text", text: suggestion2 }]
                });
              },
              suggestion: suggestedAction,
              children: suggestedAction
            }
          )
        },
        suggestedAction
      ))
    }
  );
}
var SuggestedActions = memo17(
  PureSuggestedActions,
  (prevProps, nextProps) => {
    if (prevProps.chatId !== nextProps.chatId) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    return true;
  }
);

// src/components/chatbot/multimodal-input.tsx
import { jsx as jsx72, jsxs as jsxs45 } from "react/jsx-runtime";
function setCookie(name, value) {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}`;
}
function PureMultimodalInput({
  chatId,
  input,
  setInput,
  status,
  stop,
  attachments,
  setAttachments,
  messages,
  setMessages,
  sendMessage,
  className,
  selectedVisibilityType,
  selectedModelId,
  onModelChange,
  editingMessage,
  onCancelEdit,
  isLoading
}) {
  const router = useRouter4();
  const { setTheme, resolvedTheme } = useTheme3();
  const textareaRef = useRef16(null);
  const { width } = useWindowSize2();
  const hasAutoFocused = useRef16(false);
  useEffect25(() => {
    if (!hasAutoFocused.current && width) {
      const timer = setTimeout(() => {
        textareaRef.current?.focus();
        hasAutoFocused.current = true;
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [width]);
  const [localStorageInput, setLocalStorageInput] = useLocalStorage(
    "input",
    ""
  );
  useEffect25(() => {
    if (textareaRef.current) {
      const domValue = textareaRef.current.value;
      const finalValue = domValue || localStorageInput || "";
      setInput(finalValue);
    }
  }, [localStorageInput, setInput]);
  useEffect25(() => {
    setLocalStorageInput(input);
  }, [input, setLocalStorageInput]);
  const handleInput = (event) => {
    const val = event.target.value;
    setInput(val);
    if (val.startsWith("/") && !val.includes(" ")) {
      setSlashOpen(true);
      setSlashQuery(val.slice(1));
      setSlashIndex(0);
    } else {
      setSlashOpen(false);
    }
  };
  const handleSlashSelect = (cmd) => {
    setSlashOpen(false);
    setInput("");
    switch (cmd.action) {
      case "new":
        router.push("/");
        break;
      case "clear":
        setMessages(() => []);
        break;
      case "rename":
        toast11("Rename is available from the sidebar chat menu.");
        break;
      case "model": {
        const modelBtn = document.querySelector(
          "[data-testid='model-selector']"
        );
        modelBtn?.click();
        break;
      }
      case "theme":
        setTheme(resolvedTheme === "dark" ? "light" : "dark");
        break;
      case "delete":
        toast11("Delete this chat?", {
          action: {
            label: "Delete",
            onClick: () => {
              fetch(
                `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/chat?id=${chatId}`,
                { method: "DELETE" }
              );
              router.push("/");
              toast11.success("Chat deleted");
            }
          }
        });
        break;
      case "purge":
        toast11("Delete all chats?", {
          action: {
            label: "Delete all",
            onClick: () => {
              fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/history`, {
                method: "DELETE"
              });
              router.push("/");
              toast11.success("All chats deleted");
            }
          }
        });
        break;
      default:
        break;
    }
  };
  const fileInputRef = useRef16(null);
  const [uploadQueue, setUploadQueue] = useState24([]);
  const [slashOpen, setSlashOpen] = useState24(false);
  const [slashQuery, setSlashQuery] = useState24("");
  const [slashIndex, setSlashIndex] = useState24(0);
  const submitForm = useCallback13(() => {
    window.history.pushState(
      {},
      "",
      `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/chat/${chatId}`
    );
    sendMessage({
      role: "user",
      parts: [
        ...attachments.map((attachment) => ({
          type: "file",
          url: attachment.url,
          name: attachment.name,
          mediaType: attachment.contentType
        })),
        {
          type: "text",
          text: input
        }
      ]
    });
    setAttachments([]);
    setLocalStorageInput("");
    setInput("");
    if (width && width > 768) {
      textareaRef.current?.focus();
    }
  }, [
    input,
    setInput,
    attachments,
    sendMessage,
    setAttachments,
    setLocalStorageInput,
    width,
    chatId
  ]);
  const uploadFile = useCallback13(async (file) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/files/upload`,
        {
          method: "POST",
          body: formData
        }
      );
      if (response.ok) {
        const data = await response.json();
        const { url, pathname, contentType } = data;
        return {
          url,
          name: pathname,
          contentType
        };
      }
      const { error } = await response.json();
      toast11.error(error);
    } catch (_error) {
      toast11.error("Failed to upload file, please try again!");
    }
  }, []);
  const handleFileChange = useCallback13(
    async (event) => {
      const files = Array.from(event.target.files || []);
      setUploadQueue(files.map((file) => file.name));
      try {
        const uploadPromises = files.map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== void 0
        );
        setAttachments((currentAttachments) => [
          ...currentAttachments,
          ...successfullyUploadedAttachments
        ]);
      } catch (_error) {
        toast11.error("Failed to upload files");
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile]
  );
  const handlePaste = useCallback13(
    async (event) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      const imageItems = Array.from(items).filter(
        (item) => item.type.startsWith("image/")
      );
      if (imageItems.length === 0) {
        return;
      }
      event.preventDefault();
      setUploadQueue((prev) => [...prev, "Pasted image"]);
      try {
        const uploadPromises = imageItems.map((item) => item.getAsFile()).filter((file) => file !== null).map((file) => uploadFile(file));
        const uploadedAttachments = await Promise.all(uploadPromises);
        const successfullyUploadedAttachments = uploadedAttachments.filter(
          (attachment) => attachment !== void 0 && attachment.url !== void 0 && attachment.contentType !== void 0
        );
        setAttachments((curr) => [
          ...curr,
          ...successfullyUploadedAttachments
        ]);
      } catch (_error) {
        toast11.error("Failed to upload pasted image(s)");
      } finally {
        setUploadQueue([]);
      }
    },
    [setAttachments, uploadFile]
  );
  useEffect25(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }
    textarea.addEventListener("paste", handlePaste);
    return () => textarea.removeEventListener("paste", handlePaste);
  }, [handlePaste]);
  return /* @__PURE__ */ jsxs45("div", { className: cn("relative flex w-full flex-col gap-4", className), children: [
    editingMessage && onCancelEdit && /* @__PURE__ */ jsxs45("div", { className: "flex items-center gap-2 text-[12px] text-muted-foreground", children: [
      /* @__PURE__ */ jsx72("span", { children: "Editing message" }),
      /* @__PURE__ */ jsx72(
        "button",
        {
          className: "rounded px-1.5 py-0.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-foreground",
          onMouseDown: (e) => {
            e.preventDefault();
            onCancelEdit();
          },
          type: "button",
          children: "Cancel"
        }
      )
    ] }),
    !editingMessage && !isLoading && messages.length === 0 && attachments.length === 0 && uploadQueue.length === 0 && /* @__PURE__ */ jsx72(
      SuggestedActions,
      {
        chatId,
        selectedVisibilityType,
        sendMessage
      }
    ),
    /* @__PURE__ */ jsx72(
      "input",
      {
        className: "pointer-events-none fixed -top-4 -left-4 size-0.5 opacity-0",
        multiple: true,
        onChange: handleFileChange,
        ref: fileInputRef,
        tabIndex: -1,
        type: "file"
      }
    ),
    /* @__PURE__ */ jsx72("div", { className: "relative", children: slashOpen && /* @__PURE__ */ jsx72(
      SlashCommandMenu,
      {
        onClose: () => setSlashOpen(false),
        onSelect: handleSlashSelect,
        query: slashQuery,
        selectedIndex: slashIndex
      }
    ) }),
    /* @__PURE__ */ jsxs45(
      PromptInput,
      {
        className: "[&>div]:rounded-2xl [&>div]:border [&>div]:border-border/30 [&>div]:bg-card/70 [&>div]:shadow-[var(--shadow-composer)] [&>div]:transition-shadow [&>div]:duration-300 [&>div]:focus-within:shadow-[var(--shadow-composer-focus)]",
        onSubmit: () => {
          if (input.startsWith("/")) {
            const query = input.slice(1).trim();
            const cmd = slashCommands.find((c) => c.name === query);
            if (cmd) {
              handleSlashSelect(cmd);
            }
            return;
          }
          if (!input.trim() && attachments.length === 0) {
            return;
          }
          if (status === "ready" || status === "error") {
            submitForm();
          } else {
            toast11.error("Please wait for the model to finish its response!");
          }
        },
        children: [
          (attachments.length > 0 || uploadQueue.length > 0) && /* @__PURE__ */ jsxs45(
            "div",
            {
              className: "flex w-full self-start flex-row gap-2 overflow-x-auto px-3 pt-3 no-scrollbar",
              "data-testid": "attachments-preview",
              children: [
                attachments.map((attachment) => /* @__PURE__ */ jsx72(
                  PreviewAttachment,
                  {
                    attachment,
                    onRemove: () => {
                      setAttachments(
                        (currentAttachments) => currentAttachments.filter((a) => a.url !== attachment.url)
                      );
                      if (fileInputRef.current) {
                        fileInputRef.current.value = "";
                      }
                    }
                  },
                  attachment.url
                )),
                uploadQueue.map((filename) => /* @__PURE__ */ jsx72(
                  PreviewAttachment,
                  {
                    attachment: {
                      url: "",
                      name: filename,
                      contentType: ""
                    },
                    isUploading: true
                  },
                  filename
                ))
              ]
            }
          ),
          /* @__PURE__ */ jsx72(
            PromptInputTextarea,
            {
              className: "min-h-24 text-[13px] leading-relaxed px-4 pt-3.5 pb-1.5 placeholder:text-muted-foreground/35",
              "data-testid": "multimodal-input",
              onChange: handleInput,
              onKeyDown: (e) => {
                if (slashOpen) {
                  const filtered = slashCommands.filter(
                    (cmd) => cmd.name.startsWith(slashQuery.toLowerCase())
                  );
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setSlashIndex((i) => Math.min(i + 1, filtered.length - 1));
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setSlashIndex((i) => Math.max(i - 1, 0));
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    if (filtered[slashIndex]) {
                      handleSlashSelect(filtered[slashIndex]);
                    }
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSlashOpen(false);
                    return;
                  }
                }
                if (e.key === "Escape" && editingMessage && onCancelEdit) {
                  e.preventDefault();
                  onCancelEdit();
                }
              },
              placeholder: editingMessage ? "Edit your message..." : "Ask anything...",
              ref: textareaRef,
              value: input
            }
          ),
          /* @__PURE__ */ jsxs45(PromptInputFooter, { className: "px-3 pb-3", children: [
            /* @__PURE__ */ jsxs45(PromptInputTools, { children: [
              /* @__PURE__ */ jsx72(
                AttachmentsButton,
                {
                  fileInputRef,
                  selectedModelId,
                  status
                }
              ),
              /* @__PURE__ */ jsx72(
                ModelSelectorCompact,
                {
                  onModelChange,
                  selectedModelId
                }
              )
            ] }),
            status === "submitted" ? /* @__PURE__ */ jsx72(StopButton, { setMessages, stop }) : /* @__PURE__ */ jsx72(
              PromptInputSubmit,
              {
                className: cn(
                  "h-7 w-7 rounded-xl transition-all duration-200",
                  input.trim() ? "bg-foreground text-background hover:opacity-85 active:scale-95" : "bg-muted text-muted-foreground/25 cursor-not-allowed"
                ),
                "data-testid": "send-button",
                disabled: !input.trim() || uploadQueue.length > 0,
                status,
                variant: "secondary",
                children: /* @__PURE__ */ jsx72(ArrowUpIcon2, { className: "size-4" })
              }
            )
          ] })
        ]
      }
    )
  ] });
}
var MultimodalInput = memo18(
  PureMultimodalInput,
  (prevProps, nextProps) => {
    if (prevProps.input !== nextProps.input) {
      return false;
    }
    if (prevProps.status !== nextProps.status) {
      return false;
    }
    if (!equal4(prevProps.attachments, nextProps.attachments)) {
      return false;
    }
    if (prevProps.selectedVisibilityType !== nextProps.selectedVisibilityType) {
      return false;
    }
    if (prevProps.selectedModelId !== nextProps.selectedModelId) {
      return false;
    }
    if (prevProps.editingMessage !== nextProps.editingMessage) {
      return false;
    }
    if (prevProps.isLoading !== nextProps.isLoading) {
      return false;
    }
    if (prevProps.messages.length !== nextProps.messages.length) {
      return false;
    }
    return true;
  }
);
function PureAttachmentsButton({
  fileInputRef,
  status,
  selectedModelId
}) {
  const { data: modelsResponse } = useSWR6(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    (url) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 36e5 }
  );
  const caps = modelsResponse?.capabilities ?? modelsResponse;
  const hasVision = caps?.[selectedModelId]?.vision ?? false;
  return /* @__PURE__ */ jsx72(
    Button,
    {
      className: cn(
        "h-7 w-7 rounded-lg border border-border/40 p-1 transition-colors",
        hasVision ? "text-foreground hover:border-border hover:text-foreground" : "text-muted-foreground/30 cursor-not-allowed"
      ),
      "data-testid": "attachments-button",
      disabled: status !== "ready" || !hasVision,
      onClick: (event) => {
        event.preventDefault();
        fileInputRef.current?.click();
      },
      variant: "ghost",
      children: /* @__PURE__ */ jsx72(PaperclipIcon, { size: 14, style: { width: 14, height: 14 } })
    }
  );
}
var AttachmentsButton = memo18(PureAttachmentsButton);
function PureModelSelectorCompact({
  selectedModelId,
  onModelChange
}) {
  const [open, setOpen] = useState24(false);
  const { data: modelsData } = useSWR6(
    `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/models`,
    (url) => fetch(url).then((r) => r.json()),
    { revalidateOnFocus: false, dedupingInterval: 36e5 }
  );
  const capabilities = modelsData?.capabilities ?? modelsData;
  const dynamicModels = modelsData?.models;
  const activeModels = dynamicModels ?? chatModels;
  const selectedModel = activeModels.find((m) => m.id === selectedModelId) ?? activeModels.find((m) => m.id === DEFAULT_CHAT_MODEL) ?? activeModels[0];
  const [provider] = selectedModel.id.split("/");
  return /* @__PURE__ */ jsxs45(ModelSelector, { onOpenChange: setOpen, open, children: [
    /* @__PURE__ */ jsx72(ModelSelectorTrigger, { asChild: true, children: /* @__PURE__ */ jsxs45(
      Button,
      {
        className: "h-7 max-w-[200px] justify-between gap-1.5 rounded-lg px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground",
        "data-testid": "model-selector",
        variant: "ghost",
        children: [
          provider && /* @__PURE__ */ jsx72(ModelSelectorLogo, { provider }),
          /* @__PURE__ */ jsx72(ModelSelectorName, { children: selectedModel.name })
        ]
      }
    ) }),
    /* @__PURE__ */ jsxs45(ModelSelectorContent, { children: [
      /* @__PURE__ */ jsx72(ModelSelectorInput, { placeholder: "Search models..." }),
      /* @__PURE__ */ jsx72(ModelSelectorList, { children: (() => {
        const curatedIds = new Set(chatModels.map((m) => m.id));
        const allModels = dynamicModels ? [
          ...chatModels,
          ...dynamicModels.filter((m) => !curatedIds.has(m.id))
        ] : chatModels;
        const grouped = {};
        for (const model of allModels) {
          const key = curatedIds.has(model.id) ? "_available" : model.provider;
          if (!grouped[key]) {
            grouped[key] = [];
          }
          grouped[key].push({ model, curated: curatedIds.has(model.id) });
        }
        const sortedKeys = Object.keys(grouped).sort((a, b) => {
          if (a === "_available") {
            return -1;
          }
          if (b === "_available") {
            return 1;
          }
          return a.localeCompare(b);
        });
        const providerNames = {
          alibaba: "Alibaba",
          anthropic: "Anthropic",
          "arcee-ai": "Arcee AI",
          bytedance: "ByteDance",
          cohere: "Cohere",
          deepseek: "DeepSeek",
          google: "Google",
          inception: "Inception",
          kwaipilot: "Kwaipilot",
          meituan: "Meituan",
          meta: "Meta",
          minimax: "MiniMax",
          mistral: "Mistral",
          moonshotai: "Moonshot",
          morph: "Morph",
          nvidia: "Nvidia",
          openai: "OpenAI",
          perplexity: "Perplexity",
          "prime-intellect": "Prime Intellect",
          xiaomi: "Xiaomi",
          xai: "xAI",
          zai: "Zai"
        };
        return sortedKeys.map((key) => /* @__PURE__ */ jsx72(
          ModelSelectorGroup,
          {
            heading: key === "_available" ? "Available" : providerNames[key] ?? key,
            children: grouped[key].map(({ model, curated }) => {
              const logoProvider = model.id.split("/")[0];
              return /* @__PURE__ */ jsxs45(
                ModelSelectorItem,
                {
                  className: cn(
                    "flex w-full",
                    model.id === selectedModel.id && "border-b border-dashed border-foreground/50",
                    !curated && "opacity-40 cursor-default"
                  ),
                  onSelect: () => {
                    if (!curated) {
                      return;
                    }
                    onModelChange?.(model.id);
                    setCookie("chat-model", model.id);
                    setOpen(false);
                    setTimeout(() => {
                      document.querySelector(
                        "[data-testid='multimodal-input']"
                      )?.focus();
                    }, 50);
                  },
                  value: model.id,
                  children: [
                    /* @__PURE__ */ jsx72(ModelSelectorLogo, { provider: logoProvider }),
                    /* @__PURE__ */ jsx72(ModelSelectorName, { children: model.name }),
                    /* @__PURE__ */ jsxs45("div", { className: "ml-auto flex items-center gap-2 text-foreground/70", children: [
                      capabilities?.[model.id]?.tools && /* @__PURE__ */ jsx72(WrenchIcon3, { className: "size-3.5" }),
                      capabilities?.[model.id]?.vision && /* @__PURE__ */ jsx72(EyeIcon, { className: "size-3.5" }),
                      capabilities?.[model.id]?.reasoning && /* @__PURE__ */ jsx72(BrainIcon, { className: "size-3.5" }),
                      !curated && /* @__PURE__ */ jsx72(LockIcon2, { className: "size-3 text-muted-foreground/50" })
                    ] })
                  ]
                },
                model.id
              );
            })
          },
          key
        ));
      })() })
    ] })
  ] });
}
var ModelSelectorCompact = memo18(PureModelSelectorCompact);
function PureStopButton({
  stop,
  setMessages
}) {
  return /* @__PURE__ */ jsx72(
    Button,
    {
      className: "h-7 w-7 rounded-xl bg-foreground p-1 text-background transition-all duration-200 hover:opacity-85 active:scale-95 disabled:bg-muted disabled:text-muted-foreground/25 disabled:cursor-not-allowed",
      "data-testid": "stop-button",
      onClick: (event) => {
        event.preventDefault();
        stop();
        setMessages((messages) => messages);
      },
      children: /* @__PURE__ */ jsx72(StopIcon, { size: 14 })
    }
  );
}
var StopButton = memo18(PureStopButton);

// src/components/chatbot/shell.tsx
import { Fragment as Fragment12, jsx as jsx73, jsxs as jsxs46 } from "react/jsx-runtime";
function ChatShell() {
  const { basePath } = useChatbotConfig();
  const {
    chatId,
    messages,
    setMessages,
    sendMessage,
    status,
    stop,
    regenerate,
    addToolApprovalResponse,
    input,
    setInput,
    visibilityType,
    isReadonly,
    isLoading,
    votes,
    currentModelId,
    setCurrentModelId,
    showCreditCardAlert,
    setShowCreditCardAlert
  } = useActiveChat();
  const [editingMessage, setEditingMessage] = useState25(
    null
  );
  const [attachments, setAttachments] = useState25([]);
  const isArtifactVisible = useArtifactSelector((state) => state.isVisible);
  const { setArtifact } = useArtifact();
  const stopRef = useRef17(stop);
  stopRef.current = stop;
  const prevChatIdRef = useRef17(chatId);
  useEffect26(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stopRef.current();
      setArtifact(initialArtifactData);
      setEditingMessage(null);
      setAttachments([]);
    }
  }, [chatId, setArtifact]);
  return /* @__PURE__ */ jsxs46(Fragment12, { children: [
    /* @__PURE__ */ jsxs46("div", { className: "flex h-dvh w-full flex-row overflow-hidden", children: [
      /* @__PURE__ */ jsxs46(
        "div",
        {
          className: cn(
            "flex min-w-0 flex-col bg-sidebar transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            isArtifactVisible ? "w-[40%]" : "w-full"
          ),
          children: [
            /* @__PURE__ */ jsx73(
              ChatHeader,
              {
                chatId,
                isReadonly,
                selectedVisibilityType: visibilityType
              }
            ),
            /* @__PURE__ */ jsxs46("div", { className: "relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-tl-[12px] md:border-t md:border-l md:border-border/40", children: [
              /* @__PURE__ */ jsx73(
                Messages,
                {
                  addToolApprovalResponse,
                  chatId,
                  isArtifactVisible,
                  isLoading,
                  isReadonly,
                  messages,
                  onEditMessage: (msg) => {
                    const text2 = msg.parts?.filter((p) => p.type === "text").map((p) => p.text).join("");
                    setInput(text2 ?? "");
                    setEditingMessage(msg);
                  },
                  regenerate,
                  selectedModelId: currentModelId,
                  setMessages,
                  status,
                  votes
                }
              ),
              /* @__PURE__ */ jsx73("div", { className: "sticky bottom-0 z-1 mx-auto flex w-full max-w-4xl gap-2 border-t-0 bg-background px-2 pb-3 md:px-4 md:pb-4", children: !isReadonly && /* @__PURE__ */ jsx73(
                MultimodalInput,
                {
                  attachments,
                  chatId,
                  editingMessage,
                  input,
                  isLoading,
                  messages,
                  onCancelEdit: () => {
                    setEditingMessage(null);
                    setInput("");
                  },
                  onModelChange: setCurrentModelId,
                  selectedModelId: currentModelId,
                  selectedVisibilityType: visibilityType,
                  sendMessage: editingMessage ? async () => {
                    const msg = editingMessage;
                    setEditingMessage(null);
                    await submitEditedMessage({
                      message: msg,
                      text: input,
                      setMessages,
                      regenerate,
                      basePath
                    });
                    setInput("");
                  } : sendMessage,
                  setAttachments,
                  setInput,
                  setMessages,
                  status,
                  stop
                }
              ) })
            ] })
          ]
        }
      ),
      /* @__PURE__ */ jsx73(
        Artifact2,
        {
          addToolApprovalResponse,
          attachments,
          chatId,
          input,
          isReadonly,
          messages,
          regenerate,
          selectedModelId: currentModelId,
          selectedVisibilityType: visibilityType,
          sendMessage,
          setAttachments,
          setInput,
          setMessages,
          status,
          stop,
          votes
        }
      )
    ] }),
    /* @__PURE__ */ jsx73(DataStreamHandler, {}),
    /* @__PURE__ */ jsx73(
      AlertDialog,
      {
        onOpenChange: setShowCreditCardAlert,
        open: showCreditCardAlert,
        children: /* @__PURE__ */ jsxs46(AlertDialogContent, { children: [
          /* @__PURE__ */ jsxs46(AlertDialogHeader, { children: [
            /* @__PURE__ */ jsx73(AlertDialogTitle, { children: "Activate AI Gateway" }),
            /* @__PURE__ */ jsxs46(AlertDialogDescription, { children: [
              "This application requires",
              " ",
              process.env.NODE_ENV === "production" ? "the owner" : "you",
              " to activate Vercel AI Gateway."
            ] })
          ] }),
          /* @__PURE__ */ jsxs46(AlertDialogFooter, { children: [
            /* @__PURE__ */ jsx73(AlertDialogCancel, { children: "Cancel" }),
            /* @__PURE__ */ jsx73(
              AlertDialogAction,
              {
                onClick: () => {
                  window.open(
                    "https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card",
                    "_blank"
                  );
                  window.location.href = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/`;
                },
                children: "Activate"
              }
            )
          ] })
        ] })
      }
    )
  ] });
}

// src/components/panel.tsx
import { jsx as jsx74, jsxs as jsxs47 } from "react/jsx-runtime";
function createPanel(config) {
  return function Panel({ user: user2, onSignOut, className, children }) {
    return /* @__PURE__ */ jsx74(ChatbotProvider, { config, children: /* @__PURE__ */ jsx74(DataStreamProvider, { children: /* @__PURE__ */ jsx74(Suspense, { fallback: /* @__PURE__ */ jsx74("div", { className: "flex h-dvh bg-sidebar" }), children: /* @__PURE__ */ jsxs47(SidebarProvider, { children: [
      /* @__PURE__ */ jsx74(AppSidebar, { onSignOut, user: user2 }),
      /* @__PURE__ */ jsxs47(SidebarInset, { className, children: [
        /* @__PURE__ */ jsx74(
          Toaster,
          {
            position: "top-center",
            theme: "system",
            toastOptions: {
              className: "!bg-card !text-foreground !border-border/50 !shadow-[var(--shadow-float)]"
            }
          }
        ),
        /* @__PURE__ */ jsx74(Suspense, { fallback: /* @__PURE__ */ jsx74("div", { className: "flex h-dvh" }), children: /* @__PURE__ */ jsx74(ActiveChatProvider, { children: /* @__PURE__ */ jsx74(ChatShell, {}) }) }),
        children
      ] })
    ] }) }) }) });
  };
}

// src/handlers/chat.ts
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId as generateId2,
  stepCountIs,
  streamText
} from "ai";
import { z as z2 } from "zod";

// src/handlers/utils.ts
function err(status, message2) {
  return Response.json({ error: message2 }, { status });
}
var badRequest = (msg = "Bad request") => err(400, msg);
var unauthorized = () => err(401, "Unauthorized");
var forbidden = () => err(403, "Forbidden");
var notFound = (msg = "Not found") => err(404, msg);
var notImplemented = () => err(501, "Not implemented");

// src/handlers/chat.ts
var textPartSchema = z2.object({
  type: z2.enum(["text"]),
  text: z2.string().min(1).max(2e3)
});
var filePartSchema = z2.object({
  type: z2.enum(["file"]),
  mediaType: z2.enum(["image/jpeg", "image/png"]),
  name: z2.string().min(1).max(100),
  url: z2.string().url()
});
var postBodySchema = z2.object({
  id: z2.string().uuid(),
  message: z2.object({
    id: z2.string().uuid(),
    role: z2.enum(["user"]),
    parts: z2.array(z2.union([textPartSchema, filePartSchema]))
  }).optional(),
  messages: z2.array(
    z2.object({
      id: z2.string(),
      role: z2.enum(["user", "assistant"]),
      parts: z2.array(z2.record(z2.unknown()))
    })
  ).optional(),
  selectedChatModel: z2.string(),
  selectedVisibilityType: z2.enum(["public", "private"])
});
function dbToUIMessages(messages) {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: "",
    parts: m.parts,
    metadata: {
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt)
    }
  }));
}
function titleFromParts(parts) {
  const text2 = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join("");
  return text2.replace(/\s+/g, " ").trim().slice(0, 80) || "New chat";
}
async function handleChatPost(request, { config }) {
  let body;
  try {
    body = postBodySchema.parse(await request.json());
  } catch {
    return badRequest("Invalid request body.");
  }
  const { id, message: message2, messages, selectedChatModel, selectedVisibilityType } = body;
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  const chatModelId = config.models.some((m) => m.id === selectedChatModel) ? selectedChatModel : config.defaultModel;
  if (config.storage.getMessageCountByUserId) {
    const count2 = await config.storage.getMessageCountByUserId(user2.id, 1);
    if (count2 > config.maxMessagesPerHour) {
      return Response.json({ error: "Rate limit exceeded" }, { status: 429 });
    }
  }
  const isToolApprovalFlow = Boolean(messages);
  const { getChatById } = config.storage;
  const fetchChat = getChatById ? (chatId) => getChatById(chatId) : (chatId) => config.storage.getChat(chatId, user2.id);
  const existingChat = await fetchChat(id);
  let title = null;
  if (existingChat) {
    if (existingChat.userId !== user2.id) {
      return forbidden();
    }
  } else if (message2?.role === "user") {
    title = titleFromParts(message2.parts);
    await config.storage.saveChat({
      id,
      userId: user2.id,
      title: "New chat",
      visibility: selectedVisibilityType,
      createdAt: /* @__PURE__ */ new Date()
    });
  }
  const dbMessages = await config.storage.getMessagesByChatId(id);
  let uiMessages;
  if (isToolApprovalFlow && messages) {
    const base = dbToUIMessages(dbMessages);
    const approvalStates = new Map(
      messages.flatMap(
        (m) => m.parts.filter(
          (p) => p.state === "approval-responded" || p.state === "output-denied"
        ).map((p) => [String(p.toolCallId ?? ""), p])
      )
    );
    uiMessages = base.map((msg) => ({
      ...msg,
      parts: msg.parts.map((part) => {
        const p = part;
        if ("toolCallId" in p && approvalStates.has(String(p.toolCallId))) {
          return {
            ...part,
            ...approvalStates.get(String(p.toolCallId))
          };
        }
        return part;
      })
    }));
  } else {
    uiMessages = [
      ...dbToUIMessages(dbMessages),
      message2
    ];
  }
  if (message2?.role === "user") {
    await config.storage.saveMessages([
      {
        chatId: id,
        id: message2.id,
        role: "user",
        parts: message2.parts,
        attachments: [],
        createdAt: /* @__PURE__ */ new Date()
      }
    ]);
  }
  const modelRecord = config.models.find((m) => m.id === chatModelId);
  const isReasoningModel = modelRecord?.reasoning === true;
  const modelMessages = await convertToModelMessages(uiMessages);
  const registry = config.artifacts.length > 0 ? buildRegistry(config.artifacts) : null;
  const systemPrompt = registry ? buildSystemPrompt(config.systemPrompt, registry) : config.systemPrompt;
  const stream2 = createUIMessageStream({
    originalMessages: isToolApprovalFlow ? uiMessages : void 0,
    execute: async ({ writer: dataStream }) => {
      const proposeActionTool = registry ? buildProposeActionTool({ registry, dataStream }) : null;
      const result = streamText({
        model: config.getLanguageModel(chatModelId),
        system: systemPrompt,
        messages: modelMessages,
        stopWhen: stepCountIs(5),
        tools: proposeActionTool ? { "propose-action": proposeActionTool } : void 0,
        experimental_telemetry: { isEnabled: false }
      });
      dataStream.merge(
        result.toUIMessageStream({ sendReasoning: isReasoningModel })
      );
      if (title) {
        dataStream.write({ type: "data-chat-title", data: title });
        if (config.storage.updateChatTitle) {
          await config.storage.updateChatTitle(id, title);
        }
      }
    },
    generateId: generateId2,
    onFinish: async ({ messages: finishedMessages }) => {
      if (isToolApprovalFlow) {
        for (const msg of finishedMessages) {
          const alreadyExists = uiMessages.some((m) => m.id === msg.id);
          if (alreadyExists && config.storage.updateMessage) {
            await config.storage.updateMessage(msg.id, msg.parts);
          } else {
            await config.storage.saveMessages([
              {
                id: msg.id,
                role: msg.role,
                parts: msg.parts,
                createdAt: /* @__PURE__ */ new Date(),
                attachments: [],
                chatId: id
              }
            ]);
          }
        }
      } else if (finishedMessages.length > 0) {
        await config.storage.saveMessages(
          finishedMessages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts,
            createdAt: /* @__PURE__ */ new Date(),
            attachments: [],
            chatId: id
          }))
        );
      }
    },
    onError: () => "Oops, an error occurred!"
  });
  return createUIMessageStreamResponse({ stream: stream2 });
}
async function handleChatDelete(request, { config }) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return badRequest("Parameter id is required.");
  }
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  const chat2 = await config.storage.getChat(id, user2.id);
  if (!chat2) {
    return notFound("Chat not found");
  }
  if (chat2.userId !== user2.id) {
    return forbidden();
  }
  await config.storage.deleteChat(id);
  return Response.json({ id }, { status: 200 });
}
var visibilityPatchSchema = z2.object({
  chatId: z2.string().uuid(),
  visibility: z2.enum(["public", "private"])
});
async function handleChatVisibilityPatch(request, { config }) {
  const body = await request.json().catch(() => null);
  const parsed = visibilityPatchSchema.safeParse(body);
  if (!parsed.success) {
    return badRequest("chatId and visibility required");
  }
  const { chatId, visibility } = parsed.data;
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  const chat2 = await config.storage.getChat(chatId, user2.id);
  if (!chat2) {
    return notFound("Chat not found");
  }
  if (chat2.userId !== user2.id) {
    return forbidden();
  }
  if (!config.storage.updateChatVisibility) {
    return Response.json({ error: "Not supported" }, { status: 501 });
  }
  await config.storage.updateChatVisibility(chatId, visibility);
  return Response.json({ chatId, visibility }, { status: 200 });
}

// src/handlers/document.ts
import { z as z3 } from "zod";
var documentSchema2 = z3.object({
  content: z3.string(),
  title: z3.string(),
  kind: z3.string(),
  isManualEdit: z3.boolean().optional()
});
async function handleDocumentGet(request, { config }) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return badRequest("Parameter id is missing");
  }
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  if (!config.storage.getDocumentsById) {
    return notImplemented();
  }
  const documents = await config.storage.getDocumentsById(id);
  const [document3] = documents;
  if (!document3) {
    return notFound("Document not found");
  }
  if (document3.userId !== user2.id) {
    return forbidden();
  }
  return Response.json(documents, { status: 200 });
}
async function handleDocumentPost(request, { config }) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return badRequest("Parameter id is required.");
  }
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  if (!config.storage.saveDocument || !config.storage.getDocumentsById) {
    return notImplemented();
  }
  let body;
  try {
    body = documentSchema2.parse(await request.json());
  } catch {
    return badRequest("Invalid request body.");
  }
  const documents = await config.storage.getDocumentsById(id);
  if (documents.length > 0 && documents[0].userId !== user2.id) {
    return forbidden();
  }
  if (body.isManualEdit && documents.length > 0 && config.storage.updateDocumentContent) {
    const result = await config.storage.updateDocumentContent(id, body.content);
    return Response.json(result, { status: 200 });
  }
  const document3 = await config.storage.saveDocument({
    id,
    content: body.content,
    title: body.title,
    kind: body.kind,
    userId: user2.id,
    createdAt: /* @__PURE__ */ new Date()
  });
  return Response.json(document3, { status: 200 });
}
async function handleDocumentDelete(request, { config }) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const timestamp2 = searchParams.get("timestamp");
  if (!id) {
    return badRequest("Parameter id is required.");
  }
  if (!timestamp2) {
    return badRequest("Parameter timestamp is required.");
  }
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  if (!config.storage.getDocumentsById || !config.storage.deleteDocumentsByIdAfterTimestamp) {
    return notImplemented();
  }
  const documents = await config.storage.getDocumentsById(id);
  const [document3] = documents;
  if (!document3) {
    return notFound("Document not found");
  }
  if (document3.userId !== user2.id) {
    return forbidden();
  }
  const parsedTimestamp = new Date(timestamp2);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    return badRequest("Invalid timestamp.");
  }
  const deleted = await config.storage.deleteDocumentsByIdAfterTimestamp(
    id,
    parsedTimestamp
  );
  return Response.json(deleted, { status: 200 });
}

// src/handlers/history.ts
async function handleHistoryGet(request, { config }) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    Math.max(Number.parseInt(searchParams.get("limit") ?? "10", 10), 1),
    50
  );
  const startingAfter = searchParams.get("starting_after") ?? void 0;
  const endingBefore = searchParams.get("ending_before") ?? void 0;
  if (startingAfter && endingBefore) {
    return badRequest(
      "Only one of starting_after or ending_before can be provided."
    );
  }
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  const chats = await config.storage.getChatsByUserId(user2.id, {
    limit,
    startingAfter: startingAfter ?? null,
    endingBefore: endingBefore ?? null
  });
  return Response.json(chats);
}
async function handleHistoryDelete(request, { config }) {
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  if (!config.storage.deleteAllChatsByUserId) {
    return notImplemented();
  }
  await config.storage.deleteAllChatsByUserId(user2.id);
  return new Response(null, { status: 204 });
}

// src/handlers/messages.ts
async function handleMessagesGet(request, { config }) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");
  if (!chatId) {
    return badRequest("chatId required");
  }
  const user2 = await config.auth(request);
  const { getChatById } = config.storage;
  const fetchChat = getChatById ? (id) => getChatById(id) : (_id) => Promise.resolve(null);
  const [chat2, messages] = await Promise.all([
    fetchChat(chatId),
    config.storage.getMessagesByChatId(chatId)
  ]);
  if (!chat2) {
    return Response.json({
      messages: [],
      visibility: "private",
      userId: null,
      isReadonly: false
    });
  }
  if (chat2.visibility === "private" && (!user2 || user2.id !== chat2.userId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const isReadonly = !user2 || user2.id !== chat2.userId;
  const uiMessages = messages.map((m) => ({
    id: m.id,
    role: m.role,
    parts: m.parts,
    metadata: {
      createdAt: m.createdAt instanceof Date ? m.createdAt.toISOString() : String(m.createdAt)
    }
  }));
  return Response.json({
    messages: uiMessages,
    visibility: chat2.visibility,
    userId: chat2.userId,
    isReadonly
  });
}
async function handleMessagesDelete(request, { config }) {
  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get("messageId");
  if (!messageId) {
    return badRequest("messageId required");
  }
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  if (!config.storage.getMessageById || !config.storage.deleteMessagesByChatIdAfterTimestamp) {
    return Response.json({ error: "Not supported" }, { status: 501 });
  }
  const message2 = await config.storage.getMessageById(messageId);
  if (!message2) {
    return notFound("Message not found");
  }
  const chat2 = await config.storage.getChat(message2.chatId, user2.id);
  if (!chat2 || chat2.userId !== user2.id) {
    return forbidden();
  }
  await config.storage.deleteMessagesByChatIdAfterTimestamp(
    message2.chatId,
    message2.createdAt
  );
  return Response.json({ success: true }, { status: 200 });
}

// src/handlers/models.ts
function handleModelsGet(_request, { config }) {
  const models = config.models.map(({ id, name, provider, description }) => ({
    id,
    name,
    provider,
    description
  }));
  return Response.json(models, {
    headers: { "Cache-Control": "public, max-age=300, s-maxage=300" }
  });
}

// src/handlers/vote.ts
import { z as z4 } from "zod";
var voteSchema = z4.object({
  chatId: z4.string(),
  messageId: z4.string(),
  type: z4.enum(["up", "down"])
});
async function handleVoteGet(request, { config }) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");
  if (!chatId) {
    return badRequest("Parameter chatId is required.");
  }
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  const chat2 = await config.storage.getChat(chatId, user2.id);
  if (!chat2) {
    return notFound("Chat not found");
  }
  if (chat2.userId !== user2.id) {
    return forbidden();
  }
  if (!config.storage.getVotesByChatId) {
    return notImplemented();
  }
  const votes = await config.storage.getVotesByChatId(chatId);
  return Response.json(votes, { status: 200 });
}
async function handleVotePatch(request, { config }) {
  let body;
  try {
    body = voteSchema.parse(await request.json());
  } catch {
    return badRequest("Parameters chatId, messageId, and type are required.");
  }
  const user2 = await config.auth(request);
  if (!user2) {
    return unauthorized();
  }
  const chat2 = await config.storage.getChat(body.chatId, user2.id);
  if (!chat2) {
    return notFound("Chat not found");
  }
  if (chat2.userId !== user2.id) {
    return forbidden();
  }
  if (!config.storage.voteMessage) {
    return notImplemented();
  }
  await config.storage.voteMessage(
    body.chatId,
    body.messageId,
    body.type === "up"
  );
  return new Response("Message voted", { status: 200 });
}

// src/core/dispatcher.ts
function createDispatcher(config) {
  const ctx = { config };
  return async function dispatch(request, context) {
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
        if (method === "PATCH") {
          return handleChatVisibilityPatch(request, ctx);
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
        if (method === "DELETE") {
          return handleMessagesDelete(request, ctx);
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

// src/core/factory.ts
function resolveConfig(config) {
  return {
    auth: config.auth,
    storage: config.storage,
    getLanguageModel: config.getLanguageModel,
    defaultModel: config.defaultModel,
    models: config.models,
    systemPrompt: config.systemPrompt,
    artifacts: config.artifacts ?? [],
    name: config.name ?? "Chatbot",
    greeting: config.greeting ?? "Hello! How can I help you today?",
    greetingSubtext: config.greetingSubtext ?? "",
    features: {
      history: config.features?.history ?? true,
      fileUploads: config.features?.fileUploads ?? false,
      voting: config.features?.voting ?? true,
      guestMode: config.features?.guestMode ?? false
    },
    maxMessagesPerHour: config.maxMessagesPerHour ?? 100,
    basePath: config.basePath ?? "/api/chatbot"
  };
}
function Chatbot(config) {
  const resolved = resolveConfig(config);
  const dispatch = createDispatcher(resolved);
  const handler = (req, ctx) => dispatch(req, ctx);
  return {
    handlers: {
      GET: handler,
      POST: handler,
      DELETE: handler,
      PATCH: handler
    },
    Panel: createPanel(resolved),
    config: resolved
  };
}

// src/storage/drizzle/index.ts
import "server-only";
function DrizzleAdapter(queries) {
  return {
    async getChat(id, userId) {
      const c = await queries.getChatById({ id });
      if (!c || c.userId !== userId) {
        return null;
      }
      return c;
    },
    async getChatById(id) {
      const c = await queries.getChatById({ id });
      return c ?? null;
    },
    async getChatsByUserId(userId, options = {}) {
      const { limit = 20, startingAfter = null, endingBefore = null } = options;
      const { chats } = await queries.getChatsByUserId({
        id: userId,
        limit,
        startingAfter: startingAfter ?? null,
        endingBefore: endingBefore ?? null
      });
      return chats;
    },
    async saveChat(c) {
      await queries.saveChat(c);
    },
    async deleteChat(id) {
      await queries.deleteChatById({ id });
    },
    async getMessagesByChatId(chatId) {
      return await queries.getMessagesByChatId({ id: chatId });
    },
    async saveMessages(messages) {
      await queries.saveMessages({ messages });
    },
    async updateChatTitle(chatId, title) {
      await queries.updateChatTitleById({ chatId, title });
    },
    async updateMessage(id, parts) {
      await queries.updateMessage({ id, parts });
    },
    async getMessageCountByUserId(userId, windowHours) {
      return await queries.getMessageCountByUserId({
        id: userId,
        differenceInHours: windowHours
      });
    },
    async voteMessage(chatId, messageId, isUpvoted) {
      await queries.voteMessage({
        chatId,
        messageId,
        type: isUpvoted ? "up" : "down"
      });
    },
    async getVotesByChatId(chatId) {
      return await queries.getVotesByChatId({ id: chatId });
    },
    async saveDocument(doc) {
      await queries.saveDocument({
        id: doc.id,
        title: doc.title,
        kind: doc.kind,
        content: doc.content ?? "",
        userId: doc.userId
      });
    },
    async getDocumentById(id) {
      const doc = await queries.getDocumentById({ id });
      return doc ?? null;
    },
    async getDocumentsById(id) {
      return await queries.getDocumentsById({ id });
    },
    async updateDocumentContent(id, content) {
      await queries.updateDocumentContent({ id, content });
    },
    async deleteDocumentsByIdAfterTimestamp(id, timestamp2) {
      await queries.deleteDocumentsByIdAfterTimestamp({ id, timestamp: timestamp2 });
    },
    async deleteAllChatsByUserId(userId) {
      await queries.deleteAllChatsByUserId({ userId });
    }
  };
}

// src/storage/memory.ts
function MemoryAdapter() {
  const chats = /* @__PURE__ */ new Map();
  const messages = /* @__PURE__ */ new Map();
  const votes = /* @__PURE__ */ new Map();
  const documents = /* @__PURE__ */ new Map();
  return {
    getChat(id, userId) {
      const c = chats.get(id);
      if (!c || c.userId !== userId) {
        return Promise.resolve(null);
      }
      return Promise.resolve(c);
    },
    getChatById(id) {
      return Promise.resolve(chats.get(id) ?? null);
    },
    getChatsByUserId(userId, options = {}) {
      const { limit = 20 } = options;
      const all = Array.from(chats.values()).filter((c) => c.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      if (options.startingAfter) {
        const cursor = chats.get(options.startingAfter);
        if (!cursor) {
          return Promise.resolve([]);
        }
        return Promise.resolve(
          all.filter((c) => c.createdAt > cursor.createdAt).slice(0, limit)
        );
      }
      if (options.endingBefore) {
        const cursor = chats.get(options.endingBefore);
        if (!cursor) {
          return Promise.resolve([]);
        }
        return Promise.resolve(
          all.filter((c) => c.createdAt < cursor.createdAt).slice(0, limit)
        );
      }
      return Promise.resolve(all.slice(0, limit));
    },
    saveChat(chat2) {
      chats.set(chat2.id, chat2);
      return Promise.resolve();
    },
    deleteChat(id) {
      chats.delete(id);
      messages.delete(id);
      votes.delete(id);
      return Promise.resolve();
    },
    getMessagesByChatId(chatId) {
      return Promise.resolve(
        (messages.get(chatId) ?? []).sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        )
      );
    },
    saveMessages(newMessages) {
      for (const msg of newMessages) {
        const existing = messages.get(msg.chatId) ?? [];
        existing.push(msg);
        messages.set(msg.chatId, existing);
      }
      return Promise.resolve();
    },
    updateChatTitle(chatId, title) {
      const c = chats.get(chatId);
      if (c) {
        chats.set(chatId, { ...c, title });
      }
      return Promise.resolve();
    },
    updateMessage(id, parts) {
      for (const [chatId, msgs] of messages) {
        const idx = msgs.findIndex((m) => m.id === id);
        if (idx !== -1) {
          msgs[idx] = { ...msgs[idx], parts };
          messages.set(chatId, msgs);
          return Promise.resolve();
        }
      }
      return Promise.resolve();
    },
    getMessageCountByUserId(userId, windowHours) {
      const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1e3);
      let count2 = 0;
      for (const [chatId, msgs] of messages) {
        const chat2 = chats.get(chatId);
        if (!chat2 || chat2.userId !== userId) {
          continue;
        }
        count2 += msgs.filter(
          (m) => m.role === "user" && m.createdAt >= cutoff
        ).length;
      }
      return Promise.resolve(count2);
    },
    voteMessage(chatId, messageId, isUpvoted) {
      const existing = votes.get(chatId) ?? [];
      const idx = existing.findIndex((v) => v.messageId === messageId);
      if (idx === -1) {
        existing.push({ chatId, messageId, isUpvoted });
      } else {
        existing[idx] = { chatId, messageId, isUpvoted };
      }
      votes.set(chatId, existing);
      return Promise.resolve();
    },
    getVotesByChatId(chatId) {
      return Promise.resolve(votes.get(chatId) ?? []);
    },
    saveDocument(doc) {
      const versions = documents.get(doc.id) ?? [];
      versions.push(doc);
      documents.set(doc.id, versions);
      return Promise.resolve();
    },
    getDocumentById(id) {
      const versions = documents.get(id);
      if (!versions || versions.length === 0) {
        return Promise.resolve(null);
      }
      return Promise.resolve(versions.at(-1) ?? null);
    },
    getDocumentsById(id) {
      return Promise.resolve(
        (documents.get(id) ?? []).sort(
          (a, b) => a.createdAt.getTime() - b.createdAt.getTime()
        )
      );
    },
    updateDocumentContent(id, content) {
      const versions = documents.get(id);
      if (!versions || versions.length === 0) {
        return Promise.resolve();
      }
      const latest = versions.at(-1);
      if (latest) {
        versions[versions.length - 1] = { ...latest, content };
        documents.set(id, versions);
      }
      return Promise.resolve();
    },
    deleteDocumentsByIdAfterTimestamp(id, timestamp2) {
      const versions = documents.get(id);
      if (!versions) {
        return Promise.resolve();
      }
      documents.set(
        id,
        versions.filter((d) => d.createdAt <= timestamp2)
      );
      return Promise.resolve();
    },
    deleteAllChatsByUserId(userId) {
      for (const [id, c] of chats) {
        if (c.userId === userId) {
          chats.delete(id);
          messages.delete(id);
          votes.delete(id);
        }
      }
      return Promise.resolve();
    }
  };
}
export {
  ArtifactRenderer,
  Chatbot,
  DrizzleAdapter,
  MemoryAdapter,
  ThemeProvider,
  TooltipProvider,
  buildProposeActionTool,
  buildRegistry,
  buildSystemPrompt,
  defineArtifact
};
