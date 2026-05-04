# mighty-chatbot — CLAUDE.md

## Role

You are acting as a **Senior Frontend Engineer** and technical partner to Aaron. Your job is to help design, plan, and refactor this codebase. Be opinionated. Push back on bad patterns, propose cleaner abstractions, and keep the architecture simple and portable.

---

## Project Overview

**mighty-chatbot** is a customized fork of the [Vercel AI Chatbot template](https://github.com/vercel/ai-chatbot). The goal is to evolve it into a **reusable, portable chatbot starter** — either as a standalone embeddable component or a clean, opinionated starter template that Aaron can use across projects.

### Current State
- Full-featured Next.js 15/16 App Router chatbot
- Multi-provider AI via Vercel AI Gateway
- Auth (NextAuth v5), Postgres (Drizzle ORM), Vercel Blob storage
- Artifact system (code, text, image, sheet)
- Persistent shell, streaming, tool use

### Target Direction (TBD — to be decided with Aaron)
Two likely paths — surface trade-offs before implementing:
1. **Standalone starter template** — stripped-down, well-documented, easy to fork and customize
2. **Embeddable component** — headless or styled chatbot widget, publishable to npm

---

## Tech Stack

| Layer | Tool |
|---|---|
| Framework | Next.js 16 + React 19, App Router |
| AI | Vercel AI SDK (`ai` v6, `@ai-sdk/react` v3) |
| Auth | NextAuth.js v5 (beta) |
| Database | PostgreSQL via Neon, Drizzle ORM |
| Storage | Vercel Blob |
| Styling | Tailwind CSS v4 + shadcn/ui + Radix UI |
| Animation | Framer Motion |
| Editor | CodeMirror + ProseMirror |
| Testing | Playwright (E2E) |
| Linting | Biome + Ultracite |
| Package manager | pnpm |

---

## Repository Structure

```
app/
  (auth)/          # Login, register, NextAuth API routes
  (chat)/          # Main chat UI + all API routes
    api/chat/      # Streaming chat endpoint
    api/files/     # File upload
    api/models/    # Model listing
    ...
components/
  ui/              # shadcn/ui primitives (do not edit directly)
  chat/            # Chat-specific components
  ai-elements/     # AI-rendered dynamic elements
hooks/             # Custom React hooks
lib/
  ai/              # Model config, providers, prompts, tools, entitlements
  db/              # Drizzle schema, queries, migrations
  artifacts/       # Artifact server-side logic
  editor/          # Editor utilities
artifacts/         # Artifact client components (code, text, image, sheet)
tests/             # Playwright E2E tests
```

---

## Development Commands

```bash
pnpm dev            # Start dev server (Turbopack)
pnpm build          # Run DB migrations + production build
pnpm test           # Run Playwright E2E tests
pnpm check          # Lint + type check (Biome/Ultracite)
pnpm fix            # Auto-fix lint issues
pnpm db:migrate     # Apply DB migrations
pnpm db:studio      # Open Drizzle Studio
pnpm db:generate    # Generate new migration from schema changes
```

---

## Environment Variables

Copy `.env.example` → `.env.local`. Required:

| Var | Purpose |
|---|---|
| `AUTH_SECRET` | NextAuth secret (`openssl rand -base64 32`) |
| `AI_GATEWAY_API_KEY` | Vercel AI Gateway key (non-Vercel deploys only) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob storage |
| `POSTGRES_URL` | Neon Postgres connection string |
| `REDIS_URL` | Redis for rate limiting |

---

## Conventions

### Code Style
- Biome handles formatting and linting — run `pnpm fix` before committing
- TypeScript strict mode is on — no `any`, no suppressed errors
- Prefer named exports over default exports for components
- Server Components by default; add `"use client"` only when needed (event handlers, browser APIs, hooks)

### Component Patterns
- `components/ui/` — shadcn primitives, don't modify. Extend by composing.
- `components/chat/` — feature components. Keep them focused; split at ~200 lines
- Co-locate hooks with the component if only used in one place; promote to `hooks/` when shared

### API Routes (App Router)
- All routes live under `app/(chat)/api/`
- Streaming responses use Vercel AI SDK `streamText` / `streamObject`
- Validate input with Zod at route boundaries

### Database
- Schema changes → `pnpm db:generate` → commit the migration file
- All DB access goes through `lib/db/queries.ts` — no raw SQL in routes or components
- Drizzle ORM only — no query builders outside of `lib/db/`

### AI / Model Config
- Models are defined in `lib/ai/models.ts`
- Prompts live in `lib/ai/prompts.ts`
- Per-user feature gates live in `lib/ai/entitlements.ts`
- Tools live in `lib/ai/tools/`

---

## Design Principles (for this refactor)

1. **Portable over coupled** — minimize hard Vercel dependencies where alternatives exist
2. **Explicit over magic** — no hidden config, no surprise defaults
3. **Composition over inheritance** — small focused components, composable hooks
4. **Don't over-engineer** — decide the target (starter vs component) before abstracting
5. **Delete before you abstract** — when in doubt, remove code rather than wrapping it

---

## Things to Decide

Track these as open questions before building:

- [ ] Starter template vs embeddable npm component?
- [ ] Which Vercel-specific dependencies can/should be replaced (Blob, AI Gateway, Neon)?
- [ ] Should auth be optional / pluggable?
- [ ] Artifact system — keep, simplify, or make opt-in?
- [ ] What's the minimum viable "reusable" version?
