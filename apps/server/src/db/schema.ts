import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    workspace: text("workspace", { enum: ["topic", "project"] }).notNull(),
    parentId: text("parent_id").references((): ReturnType<typeof text> => categories.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    protected: integer("protected", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("categories_sibling_name").on(table.workspace, table.parentId, table.normalizedName)],
);

export const knowledgeTypes = sqliteTable("knowledge_types", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  sortOrder: integer("sort_order").notNull(),
  templateMarkdown: text("template_markdown").notNull().default(""),
});

export const nodes = sqliteTable("nodes", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  contentMarkdown: text("content_markdown").notNull(),
  knowledgeTypeId: text("knowledge_type_id").notNull().references(() => knowledgeTypes.id),
  topicCategoryId: text("topic_category_id").notNull().references(() => categories.id),
  projectCategoryId: text("project_category_id").notNull().references(() => categories.id),
  sourceType: text("source_type"),
  sourceDetails: text("source_details"),
  version: integer("version").notNull().default(1),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const tags = sqliteTable("tags", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const nodeTags = sqliteTable(
  "node_tags",
  {
    nodeId: text("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
    tagId: text("tag_id").notNull().references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.nodeId, table.tagId] })],
);

export const revisions = sqliteTable(
  "revisions",
  {
    id: text("id").primaryKey(),
    nodeId: text("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshotJson: text("snapshot_json").notNull(),
    reason: text("reason").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [uniqueIndex("revisions_node_number").on(table.nodeId, table.revisionNumber)],
);

export const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  nodeId: text("node_id").notNull().references(() => nodes.id, { onDelete: "cascade" }),
  originalName: text("original_name").notNull(),
  storedName: text("stored_name").notNull(),
  mediaType: text("media_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  createdAt: text("created_at").notNull(),
  deletedAt: text("deleted_at"),
});

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  schemaVersion: text("schema_version").notNull(),
  externalSubmissionId: text("external_submission_id").notNull().unique(),
  sourceJson: text("source_json").notNull(),
  receivedAt: text("received_at").notNull(),
});

export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id").notNull().references(() => submissions.id, { onDelete: "cascade" }),
    clientNodeId: text("client_node_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    reconciledTopicId: text("reconciled_topic_id").references(() => categories.id),
    reconciledProjectId: text("reconciled_project_id").references(() => categories.id),
    status: text("status", { enum: ["pending", "approved", "rejected"] }).notNull().default("pending"),
    canonicalNodeId: text("canonical_node_id").references(() => nodes.id),
    createdAt: text("created_at").notNull(),
    reviewedAt: text("reviewed_at"),
  },
  (table) => [uniqueIndex("proposals_submission_client").on(table.submissionId, table.clientNodeId)],
);

export const layoutStates = sqliteTable(
  "layout_states",
  {
    workspace: text("workspace", { enum: ["topic", "project"] }).notNull(),
    rootId: text("root_id").notNull().references(() => categories.id, { onDelete: "cascade" }),
    stateJson: text("state_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.workspace, table.rootId] })],
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  valueJson: text("value_json").notNull(),
  updatedAt: text("updated_at").notNull(),
});
