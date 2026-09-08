# Knowt V1 architecture

## Guiding decisions

Knowt is a local-first modular monolith. The browser owns interaction state; Fastify owns validation and use-case orchestration; repositories own persistence. SQLite is the canonical source of truth. This keeps the MVP straightforward to run while preserving explicit seams for later background jobs, richer importers and local AI.

The implementation deliberately uses established libraries for non-domain work:

| Concern | Library | Role |
| --- | --- | --- |
| Web application | React, Vite | UI composition and development/build tooling |
| UI and UX primitives | Mantine, Tabler Icons, Radix Context Menu | Accessible controls, overlays, feedback and contextual actions |
| Server state | TanStack Query | Fetching, caching and mutation invalidation |
| Spatial graph | React Flow, Dagre | Canvas interaction and downward tree layout |
| Markdown editing | Milkdown Crepe | Visual Markdown editing without a custom editor stack |
| Markdown rendering | react-markdown, remark-gfm, remark-math, rehype-katex | Safe preview with tables, task lists and maths |
| HTTP API | Fastify | Typed, low-overhead local API and static web serving |
| Persistence | Drizzle ORM, Node SQLite | Schema-aware repository access without a native addon build chain |
| Runtime contracts | Zod, JSON Schema | Internal API validation and external ingestion validation |
| Files and archives | Chokidar, JSZip | Stable-file inbox watching and portable exports |

## Module boundaries

```text
React views and graph interaction
            |
       typed API client
            |
 Fastify routes / validation
            |
 repositories + application services
            |
 SQLite, attachments and inbox folders
```

- `packages/contracts` contains domain DTOs and Zod schemas shared by both applications. It has no server or UI dependencies.
- `apps/server/src/repositories` contains the rules that must remain true regardless of interface: one topic/project assignment, cycle prevention, sibling-name uniqueness, protected fallbacks, optimistic versions, revisions and soft deletion.
- `apps/server/src/services` contains workflows spanning persistence and files: structured inbox watching and validated export/import.
- `apps/web/src/components` contains editor and page-level workflows. `apps/web/src/tree` contains layout projection and canvas interaction, independent of HTTP details.
- `apps/web/src/api/client.ts` is the UI's sole HTTP boundary.

## Canonical model

A Knowledge Node is stored once and references one Topic category, one Project category and one Knowledge Type. Tags are many-to-many. Attachments are immutable, content-addressed files with database metadata. Explicit create/update/restore operations write immutable revision snapshots. Tree layout state is keyed by workspace and visible root so each view can preserve its own viewport, expansion set and manual positions.

Categories are adjacency-list trees. Repository checks prevent cross-workspace parents and cycles. Deleting a category first computes a redistribution preview; children and direct Knowledge Nodes move to the parent, or to the protected `Miscellaneous`/`General` fallback for root deletion.

SQLite FTS5 indexes title, Markdown content and tags. Search results include both category paths, letting the web client switch workspace, select the correct visible root and expand the route to the result.

## Structured ingestion

The versioned external contract remains separate from internal DTOs. A submission is validated, recorded idempotently, reconciled against existing path hints and staged as one or more proposals. Nothing becomes canonical until approval. Files watched in the inbox are processed only after their size and modification time stabilise, then moved to `processed` or `quarantine`.

This is also the future AI integration seam: an Ollama adapter can produce the same external proposal contract over HTTP. It should not receive direct database write access.

## Portability and failure handling

Export produces a ZIP containing a checkpointed SQLite snapshot, settings, attachments and a versioned manifest. Import expands to staging, rejects unsafe paths or incompatible/malformed archives, validates the database, and only then swaps state. The previous database and attachments are retained as timestamped backups.

Mutations return domain errors rather than silently repairing ambiguous input. Node moves use an expected version to prevent stale edits. UI mutations invalidate canonical queries and move actions expose a short-lived undo path.

## Intended next extensions

1. Add focused end-to-end browser tests for the highest-risk interaction paths.
2. Add optional Ollama proposal generation behind a server-side interface, writing only to the Review Queue.
3. Add richer import adapters that translate source formats into the same versioned ingestion contract.
4. Add graph virtualisation or root-level lazy loading only when real data demonstrates the need.

These are extensions, not prerequisites for the non-AI V1 data model.
