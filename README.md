# Knowt

Knowt is a local-first engineering knowledge system built around one canonical Knowledge Node and two independent ways to organise it: topical knowledge and project context. This repository contains the non-AI V1 MVP described in the planning specification.

## What is included

- A spatial, downward knowledge tree with pan, zoom, semantic detail levels, persisted expansion/viewport state, drag-to-reparent, right-click actions and multi-select `Create Parent`.
- Separate Topical and Project workspaces. Every Knowledge Node has exactly one path in each workspace and one Knowledge Type.
- A Milkdown Crepe visual Markdown editor with tabs, split view, tags, source metadata, images/attachments and immutable revisions on every explicit save.
- Full-text keyword search with paths back into either tree.
- Structured JSON ingestion through MCP, REST and a watched inbox, with schema validation, idempotent submission IDs, quarantine and an explicit Review Queue.
- Recoverable Trash, protected fallback categories and a redistribution preview before category deletion.
- Versioned ZIP export/import of the SQLite database, settings and attachments, with validation and a retained backup before replacement.
- No AI runtime or Ollama dependency. The later AI boundary can be added behind the application services without changing the canonical data model.

## Run locally

Prerequisites: Node.js 24 or newer and pnpm 11.

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api` to the Fastify server on `http://127.0.0.1:4318`.

For a production-style run:

```powershell
pnpm build
pnpm --filter @knowt/server start
```

Then open `http://127.0.0.1:4318`.

Run the complete verification suite with:

```powershell
pnpm check
```

## Local data

By default, runtime data is stored below `data/` and is ignored by Git:

- `data/knowt.sqlite` — canonical SQLite database
- `data/attachments/` — content-addressed attachment files
- `data/inbox/` — watched JSON submissions
- `data/processed/` — accepted inbox files
- `data/quarantine/` — invalid inbox files plus error reports

Set `KNOWT_DB_PATH` to override the database file and `KNOWT_PORT` to override the server port. The inbox folder can be changed from Settings.

The external ingestion contract is [contracts/inbox-v1.schema.json](contracts/inbox-v1.schema.json). Files should be written atomically, for example by writing a temporary file and then renaming it into the inbox.

For ChatGPT desktop and Codex, use the local MCP setup and ingestion prompt in [docs/chatgpt-integration.md](docs/chatgpt-integration.md). The repository includes a project-scoped MCP connection at `.codex/config.toml`. A hosted custom GPT can instead use the fallback [contracts/chatgpt-action.openapi.json](contracts/chatgpt-action.openapi.json) over a secured HTTPS deployment. Both integrations expose only current topical headings and stage all submitted packets for review.

## Repository map

```text
apps/web/             React application and interaction layer
apps/server/          Fastify API, application services and persistence
packages/contracts/   Shared Zod schemas and TypeScript domain contracts
contracts/            Versioned external JSON contracts
docs/                 Architecture and implementation notes
```

See [docs/implementation-plan.md](docs/implementation-plan.md) for the architectural boundaries and extension points.
