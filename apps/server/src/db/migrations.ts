import type { DatabaseSync } from "node:sqlite";

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  workspace TEXT NOT NULL CHECK (workspace IN ('topic', 'project')),
  parent_id TEXT REFERENCES categories(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  protected INTEGER NOT NULL DEFAULT 0 CHECK (protected IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_sibling_name
  ON categories(workspace, parent_id, normalized_name);
CREATE UNIQUE INDEX IF NOT EXISTS categories_root_name
  ON categories(workspace, normalized_name) WHERE parent_id IS NULL;

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
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  content_markdown TEXT NOT NULL CHECK(length(trim(content_markdown)) > 0),
  knowledge_type_id TEXT NOT NULL REFERENCES knowledge_types(id),
  topic_category_id TEXT NOT NULL REFERENCES categories(id),
  project_category_id TEXT NOT NULL REFERENCES categories(id),
  source_type TEXT,
  source_details TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  normalized_name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS node_tags (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(node_id, tag_id)
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
CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
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
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
  canonical_node_id TEXT REFERENCES nodes(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  UNIQUE(submission_id, client_node_id)
);
CREATE TABLE IF NOT EXISTS layout_states (
  workspace TEXT NOT NULL CHECK(workspace IN ('topic', 'project')),
  root_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(workspace, root_id)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
  node_id UNINDEXED,
  title,
  content,
  tags,
  tokenize='unicode61 remove_diacritics 2'
);
`;

export function migrate(database: DatabaseSync): void {
  const current = (database.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  if (current >= 1) return;

  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(INITIAL_SCHEMA);
    database.exec("PRAGMA user_version = 1");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
