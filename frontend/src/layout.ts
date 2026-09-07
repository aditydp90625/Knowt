import type { Category, KnowledgeNode, Workspace } from "./types";

export interface VisualItem {
  key: string;
  kind: "category" | "node";
  id: string;
  parentKey?: string;
  x: number;
  y: number;
  depth: number;
  label: string;
  category?: Category;
  node?: KnowledgeNode;
  childCount: number;
}

export function layoutTree(
  rootId: string,
  categories: Category[],
  nodes: KnowledgeNode[],
  workspace: Workspace,
  expanded: Set<string>,
): VisualItem[] {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const children = new Map<string, Category[]>();
  for (const category of categories) {
    if (!category.parent_id) continue;
    const siblings = children.get(category.parent_id) ?? [];
    siblings.push(category);
    children.set(category.parent_id, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.name.localeCompare(b.name));

  const nodesByCategory = new Map<string, KnowledgeNode[]>();
  for (const node of nodes) {
    const categoryId = workspace === "topic" ? node.topic_category_id : node.project_category_id;
    const siblings = nodesByCategory.get(categoryId) ?? [];
    siblings.push(node);
    nodesByCategory.set(categoryId, siblings);
  }
  for (const siblings of nodesByCategory.values()) siblings.sort((a, b) => a.title.localeCompare(b.title));

  let leaf = 0;
  const result: VisualItem[] = [];
  const walk = (categoryId: string, depth: number, parentKey?: string): number => {
    const category = categoryMap.get(categoryId);
    if (!category) return leaf++;
    const categoryKey = `category:${category.id}`;
    const item: VisualItem = {
      key: categoryKey, kind: "category", id: category.id, parentKey,
      x: 0, y: depth * 150, depth, label: category.name, category,
      childCount: (children.get(category.id)?.length ?? 0) + (nodesByCategory.get(category.id)?.length ?? 0),
    };
    result.push(item);
    if (!expanded.has(categoryId)) {
      item.x = leaf++ * 190;
      return item.x;
    }
    const childPositions: number[] = [];
    for (const child of children.get(categoryId) ?? []) childPositions.push(walk(child.id, depth + 1, categoryKey));
    for (const node of nodesByCategory.get(categoryId) ?? []) {
      const x = leaf++ * 190;
      childPositions.push(x);
      result.push({
        key: `node:${node.id}`, kind: "node", id: node.id, parentKey: categoryKey,
        x, y: (depth + 1) * 150, depth: depth + 1, label: node.title, node, childCount: 0,
      });
    }
    item.x = childPositions.length ? (Math.min(...childPositions) + Math.max(...childPositions)) / 2 : leaf++ * 190;
    return item.x;
  };
  walk(rootId, 0);
  const root = result.find((item) => item.id === rootId);
  const offset = root ? 600 - root.x : 0;
  for (const item of result) item.x += offset;
  return result;
}

