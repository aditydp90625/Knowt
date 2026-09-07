from __future__ import annotations

import os
import uuid
from contextlib import contextmanager
from pathlib import Path

os.environ["KNOWT_DB_PATH"] = ":memory:"

from fastapi.testclient import TestClient

from backend.app.main import app


@contextmanager
def isolated_client():
    path = Path("data") / f"test-{uuid.uuid4()}.sqlite3"
    os.environ["KNOWT_DB_PATH"] = str(path.resolve())
    try:
        with TestClient(app) as client:
            yield client
    finally:
        for suffix in ("", "-wal", "-shm"):
            candidate = Path(f"{path}{suffix}")
            if candidate.exists():
                candidate.unlink()


def test_core_node_lifecycle():
    with isolated_client() as client:
        topic = client.get("/api/taxonomy/topic").json()["categories"]
        project = client.get("/api/taxonomy/project").json()["categories"]
        types = client.get("/api/knowledge-types").json()
        digital = next(item for item in topic if item["name"] == "Digital Design")
        general = next(item for item in project if item["name"] == "General")
        debug = next(item for item in types if item["name"] == "Debug")

        created = client.post("/api/nodes", json={
            "title": "AXI DMA descriptor alignment",
            "content_markdown": "Descriptors require aligned addresses.",
            "knowledge_type_id": debug["id"],
            "topic_category_id": digital["id"],
            "project_category_id": general["id"],
            "tags": ["DMA", "dma", "AXI"],
        })
        assert created.status_code == 201
        node = created.json()
        assert node["tags"] == ["AXI", "DMA"]
        assert client.get("/api/search", params={"q": "descriptor"}).json()[0]["id"] == node["id"]

        edited = {**node, "title": "AXI DMA descriptor rules", "tags": ["AXI"]}
        for derived in ("id", "created_at", "updated_at", "deleted_at", "topic_path", "project_path", "knowledge_type"):
            edited.pop(derived, None)
        assert client.put(f"/api/nodes/{node['id']}", json=edited).status_code == 200
        assert len(client.get(f"/api/nodes/{node['id']}/revisions").json()) == 2

        assert client.delete(f"/api/nodes/{node['id']}").status_code == 204
        assert len(client.get("/api/trash").json()) == 1
        assert client.post(f"/api/nodes/{node['id']}/restore").status_code == 200


def test_inbox_is_staged_before_approval():
    with isolated_client() as client:
        response = client.post("/api/inbox/submissions", json={
            "schema_version": "1.0",
            "submission_id": "submission-one",
            "source": {"system": "ChatGPT", "created_at": "2026-09-07T12:00:00Z"},
            "nodes": [{
                "client_node_id": "node-1",
                "title": "Clock domain crossing synchronizer",
                "knowledge_type": "Reference",
                "content_markdown": "Use a two-flop synchronizer for a single-bit level signal.",
                "topic": {"path_hint": ["Digital Design"], "origin": "llm"},
                "project": {"path_hint": ["General"], "origin": "user"},
                "tags": ["CDC"]
            }]
        })
        assert response.status_code == 202
        assert client.get("/api/search", params={"q": "synchronizer"}).json() == []
        proposal = client.get("/api/proposals").json()[0]
        approved = client.post(f"/api/proposals/{proposal['id']}/approve", json={})
        assert approved.status_code == 200
        assert len(client.get("/api/search", params={"q": "synchronizer"}).json()) == 1
