# Knowt

Knowt is a local-first engineering knowledge system. It stores every knowledge node once while presenting it through two independent hierarchies: **Topic** (what it is about) and **Project** (where it was first learned).

This repository currently implements the first end-to-end foundation:

- SQLite canonical storage with seeded Topic roots and the protected General project
- manual node creation and explicit-save editing
- immutable revision history and revision restore
- normalized reusable tags
- global SQLite FTS5 search with highlighted excerpts
- soft-delete Trash and restore
- versioned structured inbox ingestion and a review/approval queue
- React/TypeScript spatial Topic and Project workspaces with persistent expansion and viewport state
- an optional AI service boundary; core behavior never depends on Ollama

## Run locally

Requirements: Python 3.12+, Node.js 20+, and pnpm.

```powershell
python -m venv .venv
.venv\Scripts\python -m pip install -e ".[dev]"
pnpm --dir frontend install
```

Start the API:

```powershell
.venv\Scripts\python -m uvicorn backend.app.main:app --reload --port 8000
```

Start the frontend in another terminal:

```powershell
pnpm --dir frontend dev
```

Open `http://localhost:5173`. By default the database lives at `data/knowt.sqlite3`. Override it with `KNOWT_DB_PATH`.

## Verify

```powershell
.venv\Scripts\python -m pytest
pnpm --dir frontend test
pnpm --dir frontend build
```

## Structured inbox contract

Submit JSON to `POST /api/inbox/submissions` using schema version `1.0`. Submissions are staged only; they cannot modify canonical nodes until a proposal is explicitly approved.
The machine-readable contract lives at [`contracts/inbox-v1.schema.json`](contracts/inbox-v1.schema.json). The phased technical roadmap is in [`docs/implementation-plan.md`](docs/implementation-plan.md).

```json
{
  "schema_version": "1.0",
  "submission_id": "7e026e5a-d293-4b40-9f93-384e42eb29b8",
  "source": {
    "system": "ChatGPT",
    "created_at": "2026-09-07T12:00:00Z",
    "conversation_title": "AXI DMA debugging"
  },
  "nodes": [
    {
      "client_node_id": "node-1",
      "title": "AXI DMA scatter/gather descriptor alignment",
      "knowledge_type": "Debug",
      "content_markdown": "Descriptor rings must follow the alignment required by the configured data width.",
      "topic": {"path_hint": ["Digital Design", "FPGA", "AXI"], "origin": "llm"},
      "project": {"path_hint": ["General"], "origin": "user"},
      "tags": ["AXI", "DMA"]
    }
  ]
}
```

## Design boundaries

- The browser talks only to the local API.
- External/cloud LLM integrations are write-only inbox producers; there is no read API intended for them.
- AI-generated or external changes remain proposals until reviewed.
- Embeddings and future Ollama features are derived/optional and must never block editing or keyword search.
