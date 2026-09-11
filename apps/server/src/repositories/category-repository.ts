import type { Category, CategoryDeletionPreview, CategorySearchResult, PathPart, Workspace } from "@knowt/contracts";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { DatabaseContext } from "../db/database.js";
import { categories, nodes } from "../db/schema.js";
import { conflict, invalid, notFound } from "../domain/errors.js";
import { normalizeLabel } from "../domain/text.js";

type CategoryRow = typeof categories.$inferSelect;

export class CategoryRepository {
  constructor(private readonly context: DatabaseContext) {}

  list(workspace: Workspace): Category[] {
    const rows = this.context.orm.select().from(categories).where(eq(categories.workspace, workspace)).all();
    const directCounts = this.context.sqlite.prepare(
      `SELECT CASE WHEN ? = 'topic' THEN topic_category_id ELSE project_category_id END AS category_id,
              COUNT(*) AS count
       FROM nodes WHERE deleted_at IS NULL GROUP BY category_id`,
    ).all(workspace) as Array<{ category_id: string; count: number }>;
    const direct = new Map(directCounts.map((row) => [row.category_id, row.count]));
    const byParent = new Map<string | null, CategoryRow[]>();
    for (const row of rows) {
      const siblings = byParent.get(row.parentId) ?? [];
      siblings.push(row);
      byParent.set(row.parentId, siblings);
    }
    const descendantCount = (id: string): number =>
      (direct.get(id) ?? 0) + (byParent.get(id) ?? []).reduce((sum, child) => sum + descendantCount(child.id), 0);
    return rows.map((row) => ({
      id: row.id,
      workspace: row.workspace,
      parentId: row.parentId,
      name: row.name,
      protected: row.protected,
      directNodeCount: direct.get(row.id) ?? 0,
      descendantNodeCount: descendantCount(row.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  search(query: string): CategorySearchResult[] {
    const normalizedQuery = normalizeLabel(query);
    if (!normalizedQuery) return [];
    return (["topic", "project"] as const).flatMap((workspace) => this.list(workspace)
      .filter((category) => normalizeLabel(category.name).includes(normalizedQuery))
      .map((category) => ({
        kind: "category" as const,
        id: category.id,
        name: category.name,
        workspace,
        path: this.path(category.id),
        directNodeCount: category.directNodeCount,
        descendantNodeCount: category.descendantNodeCount,
      })))
      .sort((left, right) => {
        const leftExact = normalizeLabel(left.name) === normalizedQuery ? 0 : 1;
        const rightExact = normalizeLabel(right.name) === normalizedQuery ? 0 : 1;
        return leftExact - rightExact || left.name.localeCompare(right.name);
      })
      .slice(0, 100);
  }

  get(id: string): CategoryRow {
    const row = this.context.orm.select().from(categories).where(eq(categories.id, id)).get();
    if (!row) throw notFound("Category not found");
    return row;
  }

  path(id: string): PathPart[] {
    const all = this.context.orm.select().from(categories).all();
    const byId = new Map(all.map((item) => [item.id, item]));
    const path: PathPart[] = [];
    let current = byId.get(id);
    while (current) {
      path.unshift({ id: current.id, name: current.name });
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    return path;
  }

  findPath(workspace: Workspace, pathHint: string[]): CategoryRow | undefined {
    let parentId: string | null = null;
    let match: CategoryRow | undefined;
    for (const segment of pathHint) {
      const normalized = normalizeLabel(segment);
      match = this.context.orm.select().from(categories).where(and(
        eq(categories.workspace, workspace),
        parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
        eq(categories.normalizedName, normalized),
      )).get();
      if (!match) return undefined;
      parentId = match.id;
    }
    return match;
  }

  create(workspace: Workspace, parentId: string | null, name: string): CategoryRow {
    if (parentId) this.assertParentWorkspace(parentId, workspace);
    this.assertNameAvailable(workspace, parentId, name);
    const now = new Date().toISOString();
    const value = {
      id: crypto.randomUUID(), workspace, parentId, name: name.trim().replace(/\s+/g, " "),
      normalizedName: normalizeLabel(name), protected: false, createdAt: now, updatedAt: now,
    };
    this.context.orm.insert(categories).values(value).run();
    return this.get(value.id);
  }

  rename(id: string, name: string): CategoryRow {
    const category = this.get(id);
    this.assertNameAvailable(category.workspace, category.parentId, name, id);
    this.context.orm.update(categories).set({
      name: name.trim().replace(/\s+/g, " "), normalizedName: normalizeLabel(name), updatedAt: new Date().toISOString(),
    }).where(eq(categories.id, id)).run();
    return this.get(id);
  }

  move(id: string, parentId: string | null): CategoryRow {
    const category = this.get(id);
    if (category.protected) throw invalid("Protected fallback categories cannot be moved");
    if (parentId === id) throw invalid("A category cannot be its own parent");
    if (parentId) {
      this.assertParentWorkspace(parentId, category.workspace);
      const descendant = this.context.sqlite.prepare(
        `WITH RECURSIVE descendants(id) AS (
          SELECT id FROM categories WHERE parent_id = ?
          UNION ALL SELECT c.id FROM categories c JOIN descendants d ON c.parent_id = d.id
        ) SELECT 1 AS found FROM descendants WHERE id = ? LIMIT 1`,
      ).get(id, parentId);
      if (descendant) throw invalid("A category cannot be moved beneath one of its descendants");
    }
    this.assertNameAvailable(category.workspace, parentId, category.name, id);
    this.context.orm.update(categories).set({ parentId, updatedAt: new Date().toISOString() }).where(eq(categories.id, id)).run();
    return this.get(id);
  }

  previewDeletion(id: string): CategoryDeletionPreview {
    const row = this.get(id);
    if (row.protected) throw invalid("Protected fallback categories cannot be deleted");
    const destination = row.parentId ? this.get(row.parentId) : this.getFallback(row.workspace);
    const childRows = this.context.orm.select().from(categories).where(eq(categories.parentId, id)).all();
    const siblingNames = new Set(this.context.orm.select({ name: categories.normalizedName }).from(categories)
      .where(eq(categories.parentId, destination.id)).all().map((item) => item.name));
    const directNodeCount = this.context.orm.select({ count: sql<number>`count(*)` }).from(nodes)
      .where(and(
        isNull(nodes.deletedAt),
        row.workspace === "topic" ? eq(nodes.topicCategoryId, id) : eq(nodes.projectCategoryId, id),
      )).get()?.count ?? 0;
    return {
      category: this.list(row.workspace).find((item) => item.id === id)!,
      destination: { id: destination.id, name: destination.name },
      childCategoryCount: childRows.length,
      directNodeCount,
      hasNameConflicts: childRows.some((child) => siblingNames.has(child.normalizedName)),
    };
  }

  delete(id: string): void {
    const preview = this.previewDeletion(id);
    if (preview.hasNameConflicts) throw conflict("A child category has the same name as a category at the destination");
    const row = this.get(id);
    this.context.transaction(() => {
      this.context.orm.update(categories).set({ parentId: preview.destination.id, updatedAt: new Date().toISOString() })
        .where(eq(categories.parentId, id)).run();
      if (row.workspace === "topic") {
        this.context.orm.update(nodes).set({ topicCategoryId: preview.destination.id, updatedAt: new Date().toISOString() })
          .where(eq(nodes.topicCategoryId, id)).run();
      } else {
        this.context.orm.update(nodes).set({ projectCategoryId: preview.destination.id, updatedAt: new Date().toISOString() })
          .where(eq(nodes.projectCategoryId, id)).run();
      }
      this.context.orm.delete(categories).where(eq(categories.id, id)).run();
    });
  }

  createParent(workspace: Workspace, categoryIds: string[], nodeIds: string[], name: string): CategoryRow {
    if (categoryIds.length + nodeIds.length < 1) throw invalid("Select at least one category or node");
    const selectedCategories = categoryIds.map((categoryId) => this.get(categoryId));
    if (selectedCategories.some((item) => item.workspace !== workspace || item.protected)) {
      throw invalid("All selected categories must be movable items in the active workspace");
    }
    const selectedNodes = nodeIds.map((nodeId) => {
      const row = this.context.orm.select().from(nodes).where(and(eq(nodes.id, nodeId), isNull(nodes.deletedAt))).get();
      if (!row) throw notFound("A selected Knowledge Node no longer exists");
      return row;
    });
    const parents = new Set<string | null>(selectedCategories.map((item) => item.parentId));
    for (const row of selectedNodes) parents.add(workspace === "topic" ? row.topicCategoryId : row.projectCategoryId);
    if (parents.size !== 1) throw invalid("Create Parent requires items that currently share one parent");
    const commonParentId = [...parents][0] ?? null;

    return this.context.transaction(() => {
      const parent = this.create(workspace, commonParentId, name);
      for (const category of selectedCategories) this.move(category.id, parent.id);
      for (const row of selectedNodes) {
        const column = workspace === "topic" ? "topic_category_id" : "project_category_id";
        this.context.sqlite.prepare(`UPDATE nodes SET ${column} = ?, updated_at = ?, version = version + 1 WHERE id = ?`)
          .run(parent.id, new Date().toISOString(), row.id);
      }
      return parent;
    });
  }

  getFallback(workspace: Workspace): CategoryRow {
    const normalizedName = workspace === "topic" ? "miscellaneous" : "general";
    const row = this.context.orm.select().from(categories).where(and(
      eq(categories.workspace, workspace), eq(categories.normalizedName, normalizedName), eq(categories.protected, true),
    )).get();
    if (!row) throw new Error(`Missing protected ${workspace} fallback`);
    return row;
  }

  private assertParentWorkspace(parentId: string, workspace: Workspace): void {
    const parent = this.get(parentId);
    if (parent.workspace !== workspace) throw invalid("A category parent must belong to the same workspace");
  }

  private assertNameAvailable(workspace: Workspace, parentId: string | null, name: string, excludeId?: string): void {
    const conditions = [
      eq(categories.workspace, workspace),
      parentId === null ? isNull(categories.parentId) : eq(categories.parentId, parentId),
      eq(categories.normalizedName, normalizeLabel(name)),
    ];
    if (excludeId) conditions.push(ne(categories.id, excludeId));
    if (this.context.orm.select({ id: categories.id }).from(categories).where(and(...conditions)).get()) {
      throw conflict("A category with this name already exists at the destination");
    }
  }
}
