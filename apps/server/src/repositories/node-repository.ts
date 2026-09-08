import type { KnowledgeNode, NodeWrite, RevisionSummary, SearchResult, Workspace } from "@knowt/contracts";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { DatabaseContext } from "../db/database.js";
import { knowledgeTypes, nodeTags, nodes, revisions, tags } from "../db/schema.js";
import { conflict, invalid, notFound } from "../domain/errors.js";
import { cleanTags, ftsQuery, markdownToPlainText, normalizeLabel } from "../domain/text.js";
import { CategoryRepository } from "./category-repository.js";

type NodeRow = typeof nodes.$inferSelect;
type Snapshot = Omit<NodeWrite, "expectedVersion">;

export class NodeRepository {
  private readonly categories: CategoryRepository;

  constructor(private readonly context: DatabaseContext) {
    this.categories = new CategoryRepository(context);
  }

  list(includeDeleted = false): KnowledgeNode[] {
    const rows = includeDeleted
      ? this.context.orm.select().from(nodes).orderBy(asc(nodes.title)).all()
      : this.context.orm.select().from(nodes).where(isNull(nodes.deletedAt)).orderBy(asc(nodes.title)).all();
    return rows.map((row) => this.hydrate(row));
  }

  get(id: string, includeDeleted = false): KnowledgeNode {
    const row = this.context.orm.select().from(nodes).where(eq(nodes.id, id)).get();
    if (!row || (!includeDeleted && row.deletedAt)) throw notFound("Knowledge node not found");
    return this.hydrate(row);
  }

  create(input: NodeWrite, reason = "Created"): KnowledgeNode {
    const value = this.validateAndNormalize(input);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    this.context.transaction(() => {
      this.context.orm.insert(nodes).values({
        id,
        title: value.title,
        contentMarkdown: value.contentMarkdown,
        knowledgeTypeId: value.knowledgeTypeId,
        topicCategoryId: value.topicCategoryId,
        projectCategoryId: value.projectCategoryId,
        sourceType: value.sourceType,
        sourceDetails: value.sourceDetails,
        version: 1,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }).run();
      this.replaceTags(id, value.tags, now);
      this.addRevision(id, 1, value, reason, now);
      this.refreshSearchIndex(id, value);
    });
    return this.get(id);
  }

  update(id: string, input: NodeWrite, reason = "Edited"): KnowledgeNode {
    const current = this.get(id);
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw conflict("This node changed after it was opened", { currentVersion: current.version });
    }
    const value = this.validateAndNormalize(input);
    const now = new Date().toISOString();
    const nextVersion = current.version + 1;
    this.context.transaction(() => {
      this.context.orm.update(nodes).set({
        title: value.title,
        contentMarkdown: value.contentMarkdown,
        knowledgeTypeId: value.knowledgeTypeId,
        topicCategoryId: value.topicCategoryId,
        projectCategoryId: value.projectCategoryId,
        sourceType: value.sourceType,
        sourceDetails: value.sourceDetails,
        version: nextVersion,
        updatedAt: now,
      }).where(and(eq(nodes.id, id), eq(nodes.version, current.version))).run();
      this.replaceTags(id, value.tags, now);
      this.addRevision(id, nextVersion, value, reason, now);
      this.refreshSearchIndex(id, value);
    });
    return this.get(id);
  }

  move(id: string, workspace: Workspace, categoryId: string, expectedVersion?: number): KnowledgeNode {
    const current = this.get(id);
    const category = this.categories.get(categoryId);
    if (category.workspace !== workspace) throw invalid("The destination belongs to the other workspace");
    return this.update(id, {
      title: current.title,
      contentMarkdown: current.contentMarkdown,
      knowledgeTypeId: current.knowledgeTypeId,
      topicCategoryId: workspace === "topic" ? categoryId : current.topicCategoryId,
      projectCategoryId: workspace === "project" ? categoryId : current.projectCategoryId,
      tags: current.tags,
      sourceType: current.sourceType,
      sourceDetails: current.sourceDetails,
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
    }, `Moved in ${workspace} workspace`);
  }

  softDelete(id: string): void {
    const current = this.get(id);
    const now = new Date().toISOString();
    this.context.orm.update(nodes).set({ deletedAt: now, updatedAt: now, version: current.version + 1 }).where(eq(nodes.id, id)).run();
    this.context.sqlite.prepare("DELETE FROM nodes_fts WHERE node_id = ?").run(id);
  }

  restoreFromTrash(id: string): KnowledgeNode {
    const current = this.get(id, true);
    if (!current.deletedAt) return current;
    const topicCategoryId = this.categoryExists(current.topicCategoryId, "topic")
      ? current.topicCategoryId : this.categories.getFallback("topic").id;
    const projectCategoryId = this.categoryExists(current.projectCategoryId, "project")
      ? current.projectCategoryId : this.categories.getFallback("project").id;
    const now = new Date().toISOString();
    const value: Snapshot = {
      title: current.title,
      contentMarkdown: current.contentMarkdown,
      knowledgeTypeId: current.knowledgeTypeId,
      topicCategoryId,
      projectCategoryId,
      tags: current.tags,
      sourceType: current.sourceType,
      sourceDetails: current.sourceDetails,
    };
    this.context.transaction(() => {
      this.context.orm.update(nodes).set({
        deletedAt: null, topicCategoryId, projectCategoryId, version: current.version + 1, updatedAt: now,
      }).where(eq(nodes.id, id)).run();
      this.addRevision(id, current.version + 1, value, "Restored from Trash", now);
      this.refreshSearchIndex(id, value);
    });
    return this.get(id);
  }

  permanentlyDelete(id: string): string[] {
    const current = this.get(id, true);
    if (!current.deletedAt) throw invalid("Move the node to Trash before permanently deleting it");
    const storedNames = this.context.sqlite.prepare("SELECT stored_name FROM attachments WHERE node_id = ?")
      .all(id) as Array<{ stored_name: string }>;
    this.context.orm.delete(nodes).where(eq(nodes.id, id)).run();
    this.context.sqlite.prepare("DELETE FROM nodes_fts WHERE node_id = ?").run(id);
    return storedNames.map((item) => item.stored_name);
  }

  revisions(id: string): RevisionSummary[] {
    this.get(id, true);
    return this.context.orm.select({
      id: revisions.id,
      nodeId: revisions.nodeId,
      revisionNumber: revisions.revisionNumber,
      reason: revisions.reason,
      createdAt: revisions.createdAt,
    }).from(revisions).where(eq(revisions.nodeId, id)).orderBy(desc(revisions.revisionNumber)).all();
  }

  restoreRevision(nodeId: string, revisionId: string): KnowledgeNode {
    const revision = this.context.orm.select().from(revisions).where(and(eq(revisions.id, revisionId), eq(revisions.nodeId, nodeId))).get();
    if (!revision) throw notFound("Revision not found");
    const snapshot = JSON.parse(revision.snapshotJson) as Snapshot;
    if (!this.categoryExists(snapshot.topicCategoryId, "topic")) snapshot.topicCategoryId = this.categories.getFallback("topic").id;
    if (!this.categoryExists(snapshot.projectCategoryId, "project")) snapshot.projectCategoryId = this.categories.getFallback("project").id;
    return this.update(nodeId, { ...snapshot, expectedVersion: this.get(nodeId, true).version }, `Restored revision ${revision.revisionNumber}`);
  }

  search(query: string): SearchResult[] {
    const match = ftsQuery(query);
    if (!match) return [];
    const rows = this.context.sqlite.prepare(
      `SELECT node_id,
              snippet(nodes_fts, 2, '[[', ']]', ' ... ', 28) AS excerpt,
              CASE WHEN lower(title) = lower(?) THEN -100000 ELSE bm25(nodes_fts, 8.0, 1.0, 3.0) END AS score
       FROM nodes_fts WHERE nodes_fts MATCH ? ORDER BY score LIMIT 100`,
    ).all(query.trim(), match) as Array<{ node_id: string; excerpt: string; score: number }>;
    return rows.map((row) => ({ ...this.get(row.node_id), excerpt: row.excerpt }));
  }

  rebuildSearchIndex(): void {
    this.context.transaction(() => {
      this.context.sqlite.exec("DELETE FROM nodes_fts");
      for (const node of this.list()) this.refreshSearchIndex(node.id, node);
    });
  }

  private hydrate(row: NodeRow): KnowledgeNode {
    const type = this.context.orm.select().from(knowledgeTypes).where(eq(knowledgeTypes.id, row.knowledgeTypeId)).get();
    if (!type) throw new Error(`Knowledge type ${row.knowledgeTypeId} is missing`);
    const tagRows = this.context.orm.select({ name: tags.name }).from(nodeTags)
      .innerJoin(tags, eq(nodeTags.tagId, tags.id)).where(eq(nodeTags.nodeId, row.id)).orderBy(asc(tags.normalizedName)).all();
    return {
      id: row.id,
      title: row.title,
      contentMarkdown: row.contentMarkdown,
      knowledgeTypeId: row.knowledgeTypeId,
      knowledgeType: type.name,
      topicCategoryId: row.topicCategoryId,
      projectCategoryId: row.projectCategoryId,
      topicPath: this.categories.path(row.topicCategoryId),
      projectPath: this.categories.path(row.projectCategoryId),
      tags: tagRows.map((item) => item.name),
      sourceType: row.sourceType,
      sourceDetails: row.sourceDetails,
      version: row.version,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }

  private validateAndNormalize(input: NodeWrite): Snapshot {
    const knowledgeType = this.context.orm.select().from(knowledgeTypes).where(eq(knowledgeTypes.id, input.knowledgeTypeId)).get();
    if (!knowledgeType || !knowledgeType.enabled) throw invalid("Select an enabled Knowledge Type");
    const topic = this.categories.get(input.topicCategoryId);
    const project = this.categories.get(input.projectCategoryId);
    if (topic.workspace !== "topic" || project.workspace !== "project") throw invalid("Topic and Project categories are not interchangeable");
    return {
      title: input.title.trim(),
      contentMarkdown: input.contentMarkdown.trim(),
      knowledgeTypeId: input.knowledgeTypeId,
      topicCategoryId: input.topicCategoryId,
      projectCategoryId: input.projectCategoryId,
      tags: cleanTags(input.tags),
      sourceType: input.sourceType?.trim() || null,
      sourceDetails: input.sourceDetails?.trim() || null,
    };
  }

  private replaceTags(nodeId: string, values: string[], now: string): void {
    this.context.orm.delete(nodeTags).where(eq(nodeTags.nodeId, nodeId)).run();
    for (const name of cleanTags(values)) {
      const normalizedName = normalizeLabel(name);
      this.context.orm.insert(tags).values({ id: crypto.randomUUID(), name, normalizedName, createdAt: now }).onConflictDoNothing().run();
      const tag = this.context.orm.select().from(tags).where(eq(tags.normalizedName, normalizedName)).get();
      if (tag) this.context.orm.insert(nodeTags).values({ nodeId, tagId: tag.id }).onConflictDoNothing().run();
    }
  }

  private addRevision(nodeId: string, revisionNumber: number, snapshot: Snapshot, reason: string, createdAt: string): void {
    this.context.orm.insert(revisions).values({
      id: crypto.randomUUID(), nodeId, revisionNumber, snapshotJson: JSON.stringify(snapshot), reason, createdAt,
    }).run();
  }

  private refreshSearchIndex(nodeId: string, value: Pick<Snapshot, "title" | "contentMarkdown" | "tags">): void {
    this.context.sqlite.prepare("DELETE FROM nodes_fts WHERE node_id = ?").run(nodeId);
    this.context.sqlite.prepare("INSERT INTO nodes_fts(node_id, title, content, tags) VALUES (?, ?, ?, ?)")
      .run(nodeId, value.title, markdownToPlainText(value.contentMarkdown), value.tags.join(" "));
  }

  private categoryExists(id: string, workspace: Workspace): boolean {
    try {
      return this.categories.get(id).workspace === workspace;
    } catch {
      return false;
    }
  }
}
