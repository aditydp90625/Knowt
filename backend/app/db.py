from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


TOPIC_ROOTS = [
    "Tools", "RF", "Electrical", "Embedded", "Digital Design", "Electronics",
    "Software", "Mechanical", "Robotics", "ML", "DSP", "Biology", "Chemistry",
    "Miscellaneous",
]
TOOL_CHILDREN = ["Altium", "CST", "AWR", "Vivado", "Vitis", "LTSpice"]


def database_path() -> Path:
    configured = os.getenv("KNOWT_DB_PATH")
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[2] / "data" / "knowt.sqlite3"


def connect() -> sqlite3.Connection:
    path = database_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=15, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")
    return connection


@contextmanager
def transaction() -> Iterator[sqlite3.Connection]:
    connection = connect()
    try:
        connection.execute("BEGIN IMMEDIATE")
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    workspace TEXT NOT NULL CHECK (workspace IN ('topic', 'project')),
    parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL,
    protected INTEGER NOT NULL DEFAULT 0 CHECK (protected IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workspace, parent_id, name_normalized)
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_root_name
ON categories(workspace, name_normalized) WHERE parent_id IS NULL;

CREATE TABLE IF NOT EXISTS knowledge_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    sort_order INTEGER NOT NULL,
    template_markdown TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    content_markdown TEXT NOT NULL CHECK (length(trim(content_markdown)) > 0),
    knowledge_type_id TEXT NOT NULL REFERENCES knowledge_types(id),
    topic_category_id TEXT NOT NULL REFERENCES categories(id),
    project_category_id TEXT NOT NULL REFERENCES categories(id),
    source_type TEXT,
    source_details TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_normalized TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (node_id, tag_id)
);

CREATE TABLE IF NOT EXISTS revisions (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    revision_number INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(node_id, revision_number)
);

CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
    node_id UNINDEXED,
    title,
    content,
    tags,
    tokenize='unicode61 remove_diacritics 2'
);

CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    schema_version TEXT NOT NULL,
    external_submission_id TEXT NOT NULL UNIQUE,
    source_json TEXT NOT NULL,
    received_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS proposals (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
    client_node_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    reconciled_topic_id TEXT REFERENCES categories(id),
    reconciled_project_id TEXT REFERENCES categories(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    canonical_node_id TEXT REFERENCES nodes(id),
    created_at TEXT NOT NULL,
    reviewed_at TEXT,
    UNIQUE(submission_id, client_node_id)
);

CREATE TABLE IF NOT EXISTS layout_state (
    workspace TEXT NOT NULL,
    root_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace, root_id)
);
"""


KNOWLEDGE_TYPES = [
    ("reference", "Reference", "Factual or explanatory information", 1, 10, ""),
    ("practice", "Practice", "Useful engineering technique, convention or pattern", 1, 20, "## Context\n\n## Practice\n\n## Why it works\n"),
    ("debug", "Debug", "Knowledge discovered while diagnosing a real problem", 1, 30, "## Symptom\n\n## Cause\n\n## Resolution\n"),
    ("result", "Result", "Measured, observed or experimentally obtained result", 1, 40, "## Setup\n\n## Result\n\n## Interpretation\n"),
    ("decision", "Decision", "A decision and its rationale", 0, 50, "## Decision\n\n## Rationale\n\n## Alternatives\n"),
    ("project-record", "Project Record", "Project-specific record of work", 0, 60, ""),
]


def initialise() -> None:
    import uuid
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    with transaction() as connection:
        connection.executescript(SCHEMA)
        connection.executemany(
            """INSERT OR IGNORE INTO knowledge_types
               (id, name, description, enabled, sort_order, template_markdown)
               VALUES (?, ?, ?, ?, ?, ?)""",
            KNOWLEDGE_TYPES,
        )
        existing = connection.execute("SELECT COUNT(*) AS count FROM categories").fetchone()["count"]
        if existing == 0:
            topic_ids: dict[str, str] = {}
            for name in TOPIC_ROOTS:
                category_id = str(uuid.uuid4())
                topic_ids[name] = category_id
                connection.execute(
                    "INSERT INTO categories VALUES (?, 'topic', NULL, ?, ?, ?, ?, ?)",
                    (category_id, name, name.casefold(), int(name == "Miscellaneous"), now, now),
                )
            tools_id = topic_ids["Tools"]
            for name in TOOL_CHILDREN:
                connection.execute(
                    "INSERT INTO categories VALUES (?, 'topic', ?, ?, ?, 0, ?, ?)",
                    (str(uuid.uuid4()), tools_id, name, name.casefold(), now, now),
                )
            connection.execute(
                "INSERT INTO categories VALUES (?, 'project', NULL, 'General', 'general', 1, ?, ?)",
                (str(uuid.uuid4()), now, now),
            )


def json_object(value: str | None, fallback):
    return json.loads(value) if value else fallback

