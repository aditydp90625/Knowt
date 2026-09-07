# Knowt implementation plan

The planning specification is the product source of truth. This document records technical decisions, the currently implemented slice, and the sequence for completing V1 without broadening the product.

## Architecture decisions

| Concern | Decision | Reason |
| --- | --- | --- |
| Canonical persistence | SQLite through Python's built-in driver | Local, inspectable, portable, and keeps the initial data layer explicit |
| API | FastAPI with Pydantic boundary models | Versioned validation and a typed OpenAPI surface |
| Keyword retrieval | SQLite FTS5 | Offline, fast, and independent of Ollama |
| Frontend | React + TypeScript + Vite | Matches the recommended stack and supports a componentized spatial UI |
| Spatial tree | Deterministic SVG hierarchy layout | Downward-only, settles immediately, and remains stable between sessions |
| Rich content | Canonical Markdown with a formatting-assisted editor | Explicit save boundaries and portable content; a full WYSIWYG layer remains a later V1 increment |
| AI | Optional service boundary, not a database dependency | AI failures cannot block canonical editing, tree navigation, or keyword search |
| External ingestion | Pydantic validation plus a published JSON Schema | Invalid submissions cannot modify canonical records |

## Implemented foundation

- [x] Canonical node with exactly one Topic, Project, and Knowledge Type
- [x] Seeded initial Topic taxonomy, Tools children, Miscellaneous, and General
- [x] Reusable case-normalized tags
- [x] Explicit create/save with immutable revision snapshots
- [x] Revision restore API that creates a new revision
- [x] Soft-delete Trash and recovery
- [x] Global FTS5 title/content/tag search and highlighted excerpts
- [x] Structured inbox schema `1.0`, idempotent submission IDs, and staging
- [x] Review Queue approve/reject flow
- [x] Downward-growing Topic and Project SVG workspaces
- [x] Separate root selector and explicit expand/collapse control
- [x] Persisted pan viewport and expanded branches per workspace root
- [x] Clean reading inspector and explicit Edit mode
- [x] Core API and layout tests

## Next V1 increments

### 1. Finish structural editing

- Category rename, precise move picker, drag reparent, and circular-move feedback
- Multi-select and Create Parent
- Category deletion preview UI wired to the existing preview endpoint
- Short-lived undo records for structural operations
- Search-result focus that expands, centers, and highlights the ancestor path

Acceptance: every structural mutation has a preview where destructive, persists after restart, and never produces cycles or orphaned nodes.

### 2. Complete the editor and files

- Replace the formatting-assisted textarea with a visual Markdown-backed editor
- Inline image paste/drop/picker
- Attachment storage outside SQLite under the Knowledge Base data directory
- Attachment metadata, safe filenames, orphan cleanup, and export portability tests
- Revision inspector and side-by-side comparison

Acceptance: common formatting needs no Markdown entry, all files are copied locally, and restoring a revision never loses attachment history.

### 3. Complete ingestion operations

- Watched inbox directory with stable-write detection
- Quarantine directory and human-readable validation reports
- Editable proposal fields and approve-all-clean
- 30-day rejected-proposal expiration
- Duplicate-resolution UI states: separate, update, merge, already captured

Acceptance: malformed or partially written input cannot change canonical data, and every accepted external change passes through review.

### 4. Portability and settings

- Settings persistence and Knowledge Type template editing
- Validated ZIP export manifest containing SQLite, attachments, configuration, and derived embedding metadata
- Transactional replace-import with backup and complete preflight validation
- Theme selection and configurable data/inbox locations

Acceptance: an export imports on a clean machine with identical canonical node, revision, tag, taxonomy, and attachment data.

### 5. Optional local AI

- Ollama health/model settings and connection test
- Pluggable embedding provider and rebuild job
- Hybrid exact/keyword/semantic ranking
- Semantic duplicate candidates and merge proposal generation
- Taxonomy reconciliation using retrieved approved examples

Acceptance: disabling or stopping Ollama changes only AI-enhanced behavior; all non-AI acceptance tests still pass unchanged.

## Data safety invariants

1. Proposals and derived AI data never become canonical without an explicit commit action.
2. Canonical node writes and their revision snapshots share one database transaction.
3. Delete is soft by default; permanent deletion is a separate, explicit operation.
4. Miscellaneous and General are protected fallbacks.
5. Imports validate completely before the active Knowledge Base is replaced.
6. Cloud-originated integrations have a write-only submission contract and no canonical read credentials.

