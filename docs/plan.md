# mighty-chatbot — Architecture & Implementation Plan

## Vision

A **Next.js chatbot library** that you initialize once, mount route handlers for,
and drop components into — modeled after how NextAuth v5 works. The core (streaming
chat, message persistence, history) is standard and pre-built. The edges
(artifacts, system prompt, models, storage) are configurable. No separate
deployment, no postMessage glue code.

---

## Integration Surface — What a Developer Actually Does

Three steps. That's it.

### Step 1: Initialize

```ts
// chatbot.config.ts (in the host app)
import { Chatbot } from "mighty-chatbot";
import { DrizzleAdapter } from "mighty-chatbot/adapters/drizzle";
import { db } from "@/lib/db";

export const chatbot = Chatbot({
  storage: DrizzleAdapter(db),
  defaultModel: "claude-sonnet-4-6",
  models: ["claude-sonnet-4-6", "gpt-4o"],
  systemPrompt: "You are a helpful assistant...",
  artifacts: [eventCardArtifact, productCardArtifact], // ← host app's custom types
  features: {
    history: true,
    fileUploads: false,
    voting: false,
  },
});
```

### Step 2: Mount the route handlers

```ts
// app/api/chatbot/[...slug]/route.ts
import { chatbot } from "@/chatbot.config";
export const { GET, POST } = chatbot.handlers;
```

### Step 3: Use the component

```tsx
// anywhere in the host app
import { chatbot } from "@/chatbot.config";

export default function DashboardLayout({ children }) {
  return (
    <div className='flex h-dvh'>
      <main className='flex-1'>{children}</main>
      <aside className='w-[380px] border-l'>
        <chatbot.Panel
          context={{ view: "dashboard", userId: session.user.id }}
          onAction={handleAction}
        />
      </aside>
    </div>
  );
}
```

---

## Core Concepts

### 1. `Chatbot()` Factory

Returns a `ChatbotInstance` with three things: the route handlers, the React
component, and the resolved config. The host app imports and uses all three from
the single initialized instance.

```ts
interface ChatbotInstance {
  handlers: { GET: NextRouteHandler; POST: NextRouteHandler };
  Panel: React.ComponentType<PanelProps>;
  config: ResolvedChatbotConfig;
}
```

### 2. Storage Adapter

The only required integration point besides mounting routes. Abstracts all DB
access behind a typed interface. The Drizzle adapter is the default — ships with
schema and migrations. Host apps that already have a DB can implement the
interface themselves or merge the Drizzle schema into their own.

```ts
interface StorageAdapter {
  // Chats
  getChat(id: string, userId: string): Promise<Chat | null>;
  getChatsByUserId(userId: string): Promise<Chat[]>;
  saveChat(chat: Chat): Promise<void>;
  deleteChat(id: string): Promise<void>;

  // Messages
  getMessagesByChatId(chatId: string): Promise<Message[]>;
  saveMessages(messages: Message[]): Promise<void>;

  // Optional — omit to disable the feature
  voteMessage?(
    chatId: string,
    messageId: string,
    isUpvoted: boolean,
  ): Promise<void>;
  getVotesByChatId?(chatId: string): Promise<Vote[]>;
  saveDocument?(doc: Document): Promise<void>;
  getDocumentById?(id: string): Promise<Document | null>;
}
```

The Drizzle adapter wraps the existing `lib/db/queries.ts` logic. Nothing is
rewritten — it's extracted behind the interface.

### 3. `<Panel>` Props

```ts
interface PanelProps {
  context?: Record<string, unknown>; // injected into AI system prompt server-side
  onAction?: (action: ActionEvent) => void; // fired when artifact confirmed
  className?: string;
}
```

`context` updates are sent to the API on the next message — no realtime sync
needed. The AI sees the current context on every request.

### 4. Artifacts

The main extension point. An artifact is a typed AI output that renders as a
custom React component inside the chat. Host apps define their own — the library
ships with none by default (or ships demonstrative examples that can be deleted).

```ts
// lib/chatbot/artifact-types.ts (the contract — in the library)
interface ArtifactDefinition<T extends z.ZodType> {
  type: string;
  schema: T; // Zod schema the AI must produce
  component: React.ComponentType<{
    data: z.infer<T>;
    onConfirm: (action: ActionEvent) => void;
    onDismiss: () => void;
  }>;
}

function defineArtifact<T extends z.ZodType>(def: ArtifactDefinition<T>) {
  return def; // identity function — exists for type inference
}
```

```ts
// artifacts/event-card/index.ts (in the host app)
import { defineArtifact } from "mighty-chatbot";
import { z } from "zod";

export const eventCardArtifact = defineArtifact({
  type: "event-card",
  schema: z.object({
    eventId: z.string(),
    title: z.string(),
    proposedDate: z.string(),
  }),
  component: EventCardArtifact, // the React component
});
```

Artifacts registered in `Chatbot({ artifacts: [...] })` are:

- Fed as schemas into the AI system prompt (AI knows what it can produce)
- Registered in the renderer (the right component renders for each type)
- Available as `propose-action` tool output from the streaming endpoint

### 5. Route Handlers

The catch-all `[...slug]` route handles all chatbot API traffic internally.
The host app doesn't need to know about individual endpoints — they're an
implementation detail.

```
POST /api/chatbot/chat        ← streaming chat (SSE)
GET  /api/chatbot/history     ← chat list for sidebar
GET  /api/chatbot/messages    ← messages for a chat
POST /api/chatbot/vote        ← upvote/downvote (if feature enabled)
POST /api/chatbot/files       ← file upload (if feature enabled)
```

The base path (`/api/chatbot`) is wherever the host app mounts the handlers.
The Panel component reads this from the initialized config.

---

## Folder Structure (Package Internals)

```
mighty-chatbot/
│
├── src/
│   ├── index.ts                   ← public API: Chatbot, defineArtifact, types
│   │
│   ├── core/
│   │   ├── factory.ts             ← Chatbot() factory function
│   │   ├── config.ts              ← ChatbotConfig + ResolvedChatbotConfig types
│   │   └── types.ts               ← Chat, Message, Vote, ActionEvent, etc.
│   │
│   ├── storage/
│   │   ├── adapter.ts             ← StorageAdapter interface
│   │   └── drizzle/
│   │       ├── index.ts           ← DrizzleAdapter() factory
│   │       ├── schema.ts          ← Drizzle schema (mergeable into host app's DB)
│   │       └── migrations/        ← migration files for the chatbot tables
│   │
│   ├── handlers/
│   │   ├── index.ts               ← builds + exports { GET, POST } catch-all
│   │   ├── chat.ts                ← streaming chat handler
│   │   ├── history.ts
│   │   ├── messages.ts
│   │   ├── vote.ts
│   │   └── files.ts
│   │
│   ├── components/
│   │   ├── Panel.tsx              ← main component export
│   │   ├── Messages.tsx
│   │   ├── Message.tsx
│   │   ├── Input.tsx
│   │   ├── History.tsx
│   │   └── ArtifactRenderer.tsx   ← looks up registry, renders component
│   │
│   ├── artifacts/
│   │   ├── types.ts               ← ArtifactDefinition interface + defineArtifact
│   │   └── registry.ts            ← runtime registry built from config
│   │
│   └── ai/
│       ├── models.ts
│       ├── prompts.ts             ← base prompt + context + artifact schema injection
│       └── tools/
│           └── propose-action.ts  ← structured AI tool for artifact output
│
└── demo/                          ← local Next.js dev app (not published)
    ├── app/
    │   ├── api/chatbot/[...slug]/route.ts
    │   └── page.tsx
    ├── artifacts/
    │   └── example-card/
    └── chatbot.config.ts
```

---

## Implementation Phases

### Phase 1 — Structural cleanup (prerequisite) ✅

- [x] Rename `components/chat/` → `components/chatbot/`
- [x] Strip out `IS_DEMO`, `basePath`, and other Vercel-coupled config from `next.config.ts`
- [x] Remove parallel route artifacts (`app/(chat)/default.tsx`, slot references in layout)
- [x] Consolidate all DB access behind a single `queries.ts` interface (it mostly is already)

### Phase 2 — Define the contracts ✅

- [x] Write `StorageAdapter` interface in `src/storage/adapter.ts`
- [x] Write `ArtifactDefinition` interface + `defineArtifact` in `src/artifacts/types.ts`
- [x] Write `ChatbotConfig` type in `src/core/config.ts`
- [x] Write `ChatbotInstance` type and stub `Chatbot()` factory

### Phase 3 — Storage adapter ✅

- [x] Wrap existing `lib/db/queries.ts` in a `DrizzleAdapter` that satisfies `StorageAdapter`
- [x] Verify the interface covers all query patterns used by API routes
- [x] Write an in-memory adapter for testing / zero-config dev

### Phase 4 — Route handlers

- [ ] Refactor API routes to call through `StorageAdapter` instead of directly into Drizzle
- [ ] Build the `[...slug]` catch-all dispatcher
- [ ] Export `handlers` from the factory instance

### Phase 5 — Artifact system

- [ ] Build `ArtifactRegistry` from the `artifacts` config array
- [ ] Inject artifact schemas into the AI system prompt
- [ ] Refactor `ArtifactRenderer` to look up the runtime registry
- [ ] Convert or remove existing built-in artifacts (code, text, image, sheet) —
      keep as demonstrative examples or delete; they're not part of the core

### Phase 6 — Package + demo app

- [ ] Move current Next.js app to `demo/`
- [ ] Set up `src/` as the published package entry point
- [ ] Wire the demo app to use the library via the three integration steps
- [ ] Confirm end-to-end: init → mount → component → artifact confirm → onAction

### Phase 7 — Documentation + DX

- [ ] Write `chatbot.config.ts` reference
- [ ] Write artifact authoring guide
- [ ] Write storage adapter guide (including schema merge pattern for Drizzle)
- [ ] README reflects new purpose

---

## Open Questions

- [ ] **Auth:** Does the host app's session flow into the chatbot, or does the chatbot
      manage its own auth?
      Option A: `Chatbot({ auth: hostAppAuthAdapter })` — chatbot calls host app's
      session resolution, no duplicate auth
      Option B: chatbot has its own NextAuth setup, `AUTH_SECRET` must be shared
      Option C: no auth at all — `userId` passed via `context` prop, host app is responsible

- [ ] **Drizzle schema merge vs separate DB:** Should the host app merge chatbot tables
      into their own Drizzle schema (cleaner, one DB) or point the adapter at a second
      connection string (more isolated, less tidy)?

- [ ] **History persistence:** Optional per instance — if `features.history: false`,
      the adapter's chat/message methods can be stubs. Worth making this a first-class
      no-op path.

- [ ] **Package distribution:** Local package in a monorepo first, or publish to npm
      from the start? Local is faster to iterate on.
