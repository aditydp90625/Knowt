from __future__ import annotations

import json
import re
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware

from .db import connect, initialise, json_object, transaction
from .models import (
    CategoryCreate,
    CategoryMove,
    InboxSubmission,
    LayoutStateWrite,
    NodeCreate,
    NodeUpdate,
    NodeWrite,
    ProposalDecision,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def row_dict(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


def category_or_404(connection: sqlite3.Connection, category_id: str) -> sqlite3.Row:
    row = connection.execute("SELECT * FROM categories WHERE id = ?", (category_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Category not found")
    return row


def node_or_404(connection: sqlite3.Connection, node_id: str, include_deleted: bool = False) -> sqlite3.Row:
    clause = "" if include_deleted else " AND deleted_at IS NULL"
    row = connection.execute(f"SELECT * FROM nodes WHERE id = ?{clause}", (node_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Knowledge node not found")
    return row


def tags_for_node(connection: sqlite3.Connection, node_id: str) -> list[str]:
    rows = connection.execute(
        """SELECT t.name FROM tags t JOIN node_tags nt ON nt.tag_id = t.id
           WHERE nt.node_id = ? ORDER BY t.name COLLATE NOCASE""",
        (node_id,),
    ).fetchall()
    return [row["name"] for row in rows]


def hydrate_node(connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
    result = dict(row)
    result["tags"] = tags_for_node(connection, row["id"])
    result["topic_path"] = category_path(connection, row["topic_category_id"])
    result["project_path"] = category_path(connection, row["project_category_id"])
    knowledge_type = connection.execute(
        "SELECT name FROM knowledge_types WHERE id = ?", (row["knowledge_type_id"],)
    ).fetchone()
    result["knowledge_type"] = knowledge_type["name"]
    return result


def category_path(connection: sqlite3.Connection, category_id: str) -> list[dict]:
    rows = connection.execute(
        """WITH RECURSIVE path(id, parent_id, name, depth) AS (
             SELECT id, parent_id, name, 0 FROM categories WHERE id = ?
             UNION ALL
             SELECT c.id, c.parent_id, c.name, path.depth + 1
             FROM categories c JOIN path ON path.parent_id = c.id
           ) SELECT id, name FROM path ORDER BY depth DESC""",
        (category_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def validate_node_relations(connection: sqlite3.Connection, value: NodeWrite) -> None:
    topic = category_or_404(connection, value.topic_category_id)
    project = category_or_404(connection, value.project_category_id)
    if topic["workspace"] != "topic" or project["workspace"] != "project":
        raise HTTPException(422, "Topic and Project must reference their respective workspaces")
    knowledge_type = connection.execute(
        "SELECT enabled FROM knowledge_types WHERE id = ?", (value.knowledge_type_id,)
    ).fetchone()
    if not knowledge_type:
        raise HTTPException(422, "Unknown Knowledge Type")
    if not knowledge_type["enabled"]:
        raise HTTPException(422, "That Knowledge Type is disabled")


def replace_tags(connection: sqlite3.Connection, node_id: str, tags: list[str]) -> None:
    connection.execute("DELETE FROM node_tags WHERE node_id = ?", (node_id,))
    for tag_name in tags:
        normalized = tag_name.casefold()
        tag = connection.execute("SELECT id FROM tags WHERE name_normalized = ?", (normalized,)).fetchone()
        tag_id = tag["id"] if tag else str(uuid.uuid4())
        if not tag:
            connection.execute(
                "INSERT INTO tags VALUES (?, ?, ?, ?)", (tag_id, tag_name, normalized, now_iso())
            )
        connection.execute("INSERT INTO node_tags VALUES (?, ?)", (node_id, tag_id))


def snapshot(connection: sqlite3.Connection, node_id: str) -> dict:
    return hydrate_node(connection, node_or_404(connection, node_id, include_deleted=True))


def add_revision(connection: sqlite3.Connection, node_id: str, reason: str) -> None:
    number = connection.execute(
        "SELECT COALESCE(MAX(revision_number), 0) + 1 AS number FROM revisions WHERE node_id = ?",
        (node_id,),
    ).fetchone()["number"]
    connection.execute(
        "INSERT INTO revisions VALUES (?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), node_id, number, json.dumps(snapshot(connection, node_id)), reason, now_iso()),
    )


def refresh_fts(connection: sqlite3.Connection, node_id: str) -> None:
    connection.execute("DELETE FROM nodes_fts WHERE node_id = ?", (node_id,))
    row = connection.execute("SELECT * FROM nodes WHERE id = ? AND deleted_at IS NULL", (node_id,)).fetchone()
    if row:
        connection.execute(
            "INSERT INTO nodes_fts(node_id, title, content, tags) VALUES (?, ?, ?, ?)",
            (node_id, row["title"], row["content_markdown"], " ".join(tags_for_node(connection, node_id))),
        )


def create_node_record(connection: sqlite3.Connection, value: NodeWrite, reason: str = "Created") -> dict:
    validate_node_relations(connection, value)
    node_id = str(uuid.uuid4())
    timestamp = now_iso()
    connection.execute(
        """INSERT INTO nodes
           (id, title, content_markdown, knowledge_type_id, topic_category_id,
            project_category_id, source_type, source_details, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            node_id, value.title.strip(), value.content_markdown.strip(), value.knowledge_type_id,
            value.topic_category_id, value.project_category_id, value.source_type,
            value.source_details, timestamp, timestamp,
        ),
    )
    replace_tags(connection, node_id, value.tags)
    add_revision(connection, node_id, reason)
    refresh_fts(connection, node_id)
    return snapshot(connection, node_id)


def find_path(connection: sqlite3.Connection, workspace: str, names: list[str]) -> str | None:
    parent_id: str | None = None
    matched: str | None = None
    for name in names:
        if parent_id is None:
            row = connection.execute(
                "SELECT id FROM categories WHERE workspace = ? AND parent_id IS NULL AND name_normalized = ?",
                (workspace, name.casefold()),
            ).fetchone()
        else:
            row = connection.execute(
                "SELECT id FROM categories WHERE workspace = ? AND parent_id = ? AND name_normalized = ?",
                (workspace, parent_id, name.casefold()),
            ).fetchone()
        if not row:
            break
        matched = parent_id = row["id"]
    return matched


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialise()
    yield


app = FastAPI(title="Knowt API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "ai_required": False}


@app.get("/api/knowledge-types")
def list_knowledge_types(enabled_only: bool = True) -> list[dict]:
    connection = connect()
    try:
        clause = "WHERE enabled = 1" if enabled_only else ""
        return [dict(row) for row in connection.execute(
            f"SELECT * FROM knowledge_types {clause} ORDER BY sort_order"
        ).fetchall()]
    finally:
        connection.close()


@app.get("/api/taxonomy/{workspace}")
def taxonomy(workspace: str) -> dict:
    if workspace not in {"topic", "project"}:
        raise HTTPException(404, "Unknown workspace")
    connection = connect()
    try:
        categories = [dict(row) for row in connection.execute(
            "SELECT * FROM categories WHERE workspace = ? ORDER BY parent_id, name COLLATE NOCASE", (workspace,)
        ).fetchall()]
        field = "topic_category_id" if workspace == "topic" else "project_category_id"
        nodes = [hydrate_node(connection, row) for row in connection.execute(
            f"SELECT * FROM nodes WHERE deleted_at IS NULL ORDER BY title COLLATE NOCASE"
        ).fetchall()]
        counts = {row["category_id"]: row["count"] for row in connection.execute(
            f"SELECT {field} AS category_id, COUNT(*) AS count FROM nodes WHERE deleted_at IS NULL GROUP BY {field}"
        ).fetchall()}
        for category in categories:
            category["direct_node_count"] = counts.get(category["id"], 0)
        return {"categories": categories, "nodes": nodes}
    finally:
        connection.close()


@app.post("/api/categories", status_code=201)
def create_category(value: CategoryCreate) -> dict:
    with transaction() as connection:
        if value.parent_id:
            parent = category_or_404(connection, value.parent_id)
            if parent["workspace"] != value.workspace:
                raise HTTPException(422, "Parent belongs to the other workspace")
        category_id = str(uuid.uuid4())
        timestamp = now_iso()
        try:
            connection.execute(
                "INSERT INTO categories VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
                (category_id, value.workspace, value.parent_id, value.name.strip(), value.name.strip().casefold(), timestamp, timestamp),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(409, "A category with that name already exists here") from error
        return row_dict(category_or_404(connection, category_id))


@app.patch("/api/categories/{category_id}/move")
def move_category(category_id: str, value: CategoryMove) -> dict:
    with transaction() as connection:
        category = category_or_404(connection, category_id)
        if category["protected"]:
            raise HTTPException(409, "Protected categories cannot be moved")
        if value.parent_id == category_id:
            raise HTTPException(409, "A category cannot contain itself")
        if value.parent_id:
            parent = category_or_404(connection, value.parent_id)
            if parent["workspace"] != category["workspace"]:
                raise HTTPException(422, "Parent belongs to the other workspace")
            descendant = connection.execute(
                """WITH RECURSIVE descendants(id) AS (
                     SELECT id FROM categories WHERE parent_id = ?
                     UNION ALL SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
                   ) SELECT 1 FROM descendants WHERE id = ?""",
                (category_id, value.parent_id),
            ).fetchone()
            if descendant:
                raise HTTPException(409, "Circular category moves are not allowed")
        try:
            connection.execute(
                "UPDATE categories SET parent_id = ?, updated_at = ? WHERE id = ?",
                (value.parent_id, now_iso(), category_id),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(409, "A category with that name already exists at the destination") from error
        return row_dict(category_or_404(connection, category_id))


@app.get("/api/categories/{category_id}/delete-preview")
def delete_category_preview(category_id: str) -> dict:
    connection = connect()
    try:
        category = category_or_404(connection, category_id)
        if category["protected"]:
            raise HTTPException(409, "Protected categories cannot be deleted")
        field = "topic_category_id" if category["workspace"] == "topic" else "project_category_id"
        children = connection.execute("SELECT COUNT(*) AS count FROM categories WHERE parent_id = ?", (category_id,)).fetchone()["count"]
        nodes = connection.execute(f"SELECT COUNT(*) AS count FROM nodes WHERE {field} = ?", (category_id,)).fetchone()["count"]
        fallback = category["parent_id"]
        if not fallback:
            fallback_name = "Miscellaneous" if category["workspace"] == "topic" else "General"
            fallback = connection.execute(
                "SELECT id FROM categories WHERE workspace = ? AND parent_id IS NULL AND name = ?",
                (category["workspace"], fallback_name),
            ).fetchone()["id"]
        return {"category": dict(category), "child_categories": children, "direct_nodes": nodes, "destination": category_path(connection, fallback)}
    finally:
        connection.close()


@app.delete("/api/categories/{category_id}", status_code=204)
def delete_category(category_id: str) -> Response:
    with transaction() as connection:
        category = category_or_404(connection, category_id)
        if category["protected"]:
            raise HTTPException(409, "Protected categories cannot be deleted")
        fallback = category["parent_id"]
        if not fallback:
            fallback_name = "Miscellaneous" if category["workspace"] == "topic" else "General"
            fallback = connection.execute(
                "SELECT id FROM categories WHERE workspace = ? AND parent_id IS NULL AND name = ?",
                (category["workspace"], fallback_name),
            ).fetchone()["id"]
        field = "topic_category_id" if category["workspace"] == "topic" else "project_category_id"
        connection.execute("UPDATE categories SET parent_id = ? WHERE parent_id = ?", (fallback, category_id))
        connection.execute(f"UPDATE nodes SET {field} = ?, updated_at = ? WHERE {field} = ?", (fallback, now_iso(), category_id))
        connection.execute("DELETE FROM categories WHERE id = ?", (category_id,))
    return Response(status_code=204)


@app.post("/api/nodes", status_code=201)
def create_node(value: NodeCreate) -> dict:
    with transaction() as connection:
        return create_node_record(connection, value)


@app.get("/api/nodes/{node_id}")
def get_node(node_id: str) -> dict:
    connection = connect()
    try:
        return hydrate_node(connection, node_or_404(connection, node_id))
    finally:
        connection.close()


@app.put("/api/nodes/{node_id}")
def update_node(node_id: str, value: NodeUpdate) -> dict:
    with transaction() as connection:
        node_or_404(connection, node_id)
        validate_node_relations(connection, value)
        connection.execute(
            """UPDATE nodes SET title = ?, content_markdown = ?, knowledge_type_id = ?,
               topic_category_id = ?, project_category_id = ?, source_type = ?, source_details = ?,
               updated_at = ? WHERE id = ?""",
            (
                value.title.strip(), value.content_markdown.strip(), value.knowledge_type_id,
                value.topic_category_id, value.project_category_id, value.source_type,
                value.source_details, now_iso(), node_id,
            ),
        )
        replace_tags(connection, node_id, value.tags)
        add_revision(connection, node_id, "Saved")
        refresh_fts(connection, node_id)
        return snapshot(connection, node_id)


@app.delete("/api/nodes/{node_id}", status_code=204)
def trash_node(node_id: str) -> Response:
    with transaction() as connection:
        node_or_404(connection, node_id)
        connection.execute("UPDATE nodes SET deleted_at = ?, updated_at = ? WHERE id = ?", (now_iso(), now_iso(), node_id))
        refresh_fts(connection, node_id)
    return Response(status_code=204)


@app.get("/api/trash")
def trash() -> list[dict]:
    connection = connect()
    try:
        return [hydrate_node(connection, row) for row in connection.execute(
            "SELECT * FROM nodes WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC"
        ).fetchall()]
    finally:
        connection.close()


@app.post("/api/nodes/{node_id}/restore")
def restore_node(node_id: str) -> dict:
    with transaction() as connection:
        row = node_or_404(connection, node_id, include_deleted=True)
        if row["deleted_at"] is None:
            return hydrate_node(connection, row)
        for workspace, field, fallback_name in (
            ("topic", "topic_category_id", "Miscellaneous"),
            ("project", "project_category_id", "General"),
        ):
            exists = connection.execute("SELECT 1 FROM categories WHERE id = ?", (row[field],)).fetchone()
            if not exists:
                fallback = connection.execute(
                    "SELECT id FROM categories WHERE workspace = ? AND parent_id IS NULL AND name = ?",
                    (workspace, fallback_name),
                ).fetchone()["id"]
                connection.execute(f"UPDATE nodes SET {field} = ? WHERE id = ?", (fallback, node_id))
        connection.execute("UPDATE nodes SET deleted_at = NULL, updated_at = ? WHERE id = ?", (now_iso(), node_id))
        add_revision(connection, node_id, "Restored from Trash")
        refresh_fts(connection, node_id)
        return snapshot(connection, node_id)


@app.get("/api/nodes/{node_id}/revisions")
def revisions(node_id: str) -> list[dict]:
    connection = connect()
    try:
        node_or_404(connection, node_id, include_deleted=True)
        rows = connection.execute(
            "SELECT id, revision_number, reason, created_at FROM revisions WHERE node_id = ? ORDER BY revision_number DESC",
            (node_id,),
        ).fetchall()
        return [dict(row) for row in rows]
    finally:
        connection.close()


@app.post("/api/nodes/{node_id}/revisions/{revision_id}/restore")
def restore_revision(node_id: str, revision_id: str) -> dict:
    with transaction() as connection:
        node_or_404(connection, node_id, include_deleted=True)
        revision = connection.execute(
            "SELECT snapshot_json FROM revisions WHERE id = ? AND node_id = ?", (revision_id, node_id)
        ).fetchone()
        if not revision:
            raise HTTPException(404, "Revision not found")
        saved = json.loads(revision["snapshot_json"])
        value = NodeWrite(
            title=saved["title"], content_markdown=saved["content_markdown"],
            knowledge_type_id=saved["knowledge_type_id"], topic_category_id=saved["topic_category_id"],
            project_category_id=saved["project_category_id"], tags=saved["tags"],
            source_type=saved.get("source_type"), source_details=saved.get("source_details"),
        )
        validate_node_relations(connection, value)
        connection.execute(
            """UPDATE nodes SET title=?, content_markdown=?, knowledge_type_id=?, topic_category_id=?,
               project_category_id=?, source_type=?, source_details=?, deleted_at=NULL, updated_at=? WHERE id=?""",
            (value.title, value.content_markdown, value.knowledge_type_id, value.topic_category_id,
             value.project_category_id, value.source_type, value.source_details, now_iso(), node_id),
        )
        replace_tags(connection, node_id, value.tags)
        add_revision(connection, node_id, "Restored previous revision")
        refresh_fts(connection, node_id)
        return snapshot(connection, node_id)


@app.get("/api/search")
def search(q: str = Query(min_length=1, max_length=200), limit: int = Query(30, ge=1, le=100)) -> list[dict]:
    tokens = re.findall(r"[\w-]+", q, re.UNICODE)
    if not tokens:
        return []
    fts_query = " AND ".join(f'"{token.replace(chr(34), chr(34) * 2)}"*' for token in tokens)
    connection = connect()
    try:
        rows = connection.execute(
            """SELECT n.*, snippet(nodes_fts, 2, '<mark>', '</mark>', ' … ', 28) AS excerpt,
                      CASE WHEN lower(n.title) = lower(?) THEN 0 ELSE 1 END AS exact_rank,
                      bm25(nodes_fts, 8.0, 2.0, 3.0) AS text_rank
               FROM nodes_fts JOIN nodes n ON n.id = nodes_fts.node_id
               WHERE nodes_fts MATCH ? AND n.deleted_at IS NULL
               ORDER BY exact_rank, text_rank LIMIT ?""",
            (q, fts_query, limit),
        ).fetchall()
        result = []
        for row in rows:
            item = hydrate_node(connection, row)
            item["excerpt"] = row["excerpt"]
            result.append(item)
        return result
    finally:
        connection.close()


@app.post("/api/inbox/submissions", status_code=202)
def submit_inbox(value: InboxSubmission) -> dict:
    with transaction() as connection:
        submission_id = str(uuid.uuid4())
        try:
            connection.execute(
                "INSERT INTO submissions VALUES (?, ?, ?, ?, ?)",
                (submission_id, value.schema_version, value.submission_id, value.source.model_dump_json(), now_iso()),
            )
        except sqlite3.IntegrityError as error:
            raise HTTPException(409, "This submission_id has already been received") from error
        misc_id = find_path(connection, "topic", ["Miscellaneous"])
        general_id = find_path(connection, "project", ["General"])
        for proposed in value.nodes:
            topic_id = find_path(connection, "topic", proposed.topic.path_hint) or misc_id
            project_id = find_path(connection, "project", proposed.project.path_hint) or general_id
            connection.execute(
                "INSERT INTO proposals VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL, ?, NULL)",
                (
                    str(uuid.uuid4()), submission_id, proposed.client_node_id,
                    proposed.model_dump_json(), topic_id, project_id, now_iso(),
                ),
            )
        return {"submission_id": submission_id, "proposal_count": len(value.nodes), "status": "staged"}


@app.get("/api/proposals")
def list_proposals(status: str = "pending") -> list[dict]:
    if status not in {"pending", "approved", "rejected"}:
        raise HTTPException(422, "Unknown proposal status")
    connection = connect()
    try:
        rows = connection.execute(
            """SELECT p.*, s.source_json FROM proposals p JOIN submissions s ON s.id = p.submission_id
               WHERE p.status = ? ORDER BY p.created_at""",
            (status,),
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["payload"] = json_object(item.pop("payload_json"), {})
            item["source"] = json_object(item.pop("source_json"), {})
            item["topic_path"] = category_path(connection, item["reconciled_topic_id"]) if item["reconciled_topic_id"] else []
            item["project_path"] = category_path(connection, item["reconciled_project_id"]) if item["reconciled_project_id"] else []
            result.append(item)
        return result
    finally:
        connection.close()


@app.post("/api/proposals/{proposal_id}/approve")
def approve_proposal(proposal_id: str, decision: ProposalDecision) -> dict:
    with transaction() as connection:
        proposal = connection.execute("SELECT * FROM proposals WHERE id = ?", (proposal_id,)).fetchone()
        if not proposal:
            raise HTTPException(404, "Proposal not found")
        if proposal["status"] != "pending":
            raise HTTPException(409, "Proposal has already been reviewed")
        if decision.node:
            value = decision.node
        else:
            payload = json.loads(proposal["payload_json"])
            knowledge_type = connection.execute(
                "SELECT id FROM knowledge_types WHERE name = ? AND enabled = 1", (payload["knowledge_type"],)
            ).fetchone()
            if not knowledge_type or not proposal["reconciled_topic_id"] or not proposal["reconciled_project_id"]:
                raise HTTPException(422, "Proposal has unresolved mandatory fields")
            value = NodeWrite(
                title=payload["title"], content_markdown=payload["content_markdown"],
                knowledge_type_id=knowledge_type["id"], topic_category_id=proposal["reconciled_topic_id"],
                project_category_id=proposal["reconciled_project_id"], tags=payload.get("tags", []),
                source_type="Cloud LLM", source_details=None,
            )
        node = create_node_record(connection, value, reason="Approved from Review Queue")
        connection.execute(
            "UPDATE proposals SET status='approved', canonical_node_id=?, reviewed_at=? WHERE id=?",
            (node["id"], now_iso(), proposal_id),
        )
        return node


@app.post("/api/proposals/{proposal_id}/reject", status_code=204)
def reject_proposal(proposal_id: str) -> Response:
    with transaction() as connection:
        changed = connection.execute(
            "UPDATE proposals SET status='rejected', reviewed_at=? WHERE id=? AND status='pending'",
            (now_iso(), proposal_id),
        ).rowcount
        if not changed:
            raise HTTPException(404, "Pending proposal not found")
    return Response(status_code=204)


@app.get("/api/layout/{workspace}/{root_id}")
def get_layout(workspace: str, root_id: str) -> dict:
    connection = connect()
    try:
        row = connection.execute(
            "SELECT state_json FROM layout_state WHERE workspace=? AND root_id=?", (workspace, root_id)
        ).fetchone()
        return {"state": json_object(row["state_json"], {}) if row else {}}
    finally:
        connection.close()


@app.put("/api/layout/{workspace}/{root_id}", status_code=204)
def save_layout(workspace: str, root_id: str, value: LayoutStateWrite) -> Response:
    with transaction() as connection:
        root = category_or_404(connection, root_id)
        if root["workspace"] != workspace or root["parent_id"] is not None:
            raise HTTPException(422, "Layout state must belong to a root in this workspace")
        connection.execute(
            """INSERT INTO layout_state VALUES (?, ?, ?, ?)
               ON CONFLICT(workspace, root_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at""",
            (workspace, root_id, json.dumps(value.state), now_iso()),
        )
    return Response(status_code=204)

