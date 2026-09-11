import dagre from "@dagrejs/dagre";
import type { Category, KnowledgeNode, LayoutState, Workspace } from "@knowt/contracts";
import { Position, type Edge, type Node, type XYPosition } from "@xyflow/react";

export interface TreeItemData extends Record<string, unknown> {
  entity: "category" | "knowledge";
  category?: Category;
  knowledge?: KnowledgeNode;
  expanded?: boolean;
  categoriesForcedVisible?: boolean;
  detail: "far" | "medium" | "close";
  dropTarget?: boolean;
}

export interface TreeProjection {
  nodes: Array<Node<TreeItemData>>;
  edges: Edge[];
}

const CATEGORY_WIDTH = 220;
const CATEGORY_HEIGHT = 72;
const KNOWLEDGE_WIDTH = 200;
const KNOWLEDGE_HEIGHT = 86;

export function projectTree(
  workspace: Workspace,
  rootId: string,
  categories: Category[],
  knowledge: KnowledgeNode[],
  expandedCategoryIds: Set<string>,
  savedPositions: Record<string, XYPosition>,
  detail: TreeItemData["detail"] = "medium",
  showAllCategories = false,
): TreeProjection {
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const visibleCategories: Category[] = [];
  const visit = (id: string): void => {
    const category = categoryById.get(id);
    if (!category) return;
    visibleCategories.push(category);
    if (!showAllCategories && !expandedCategoryIds.has(id)) return;
    categories.filter((candidate) => candidate.parentId === id)
      .sort((a, b) => a.name.localeCompare(b.name)).forEach((child) => visit(child.id));
  };
  visit(rootId);
  const visibleIds = new Set(visibleCategories.map((category) => category.id));
  const visibleKnowledge = knowledge.filter((item) => {
    const categoryId = workspace === "topic" ? item.topicCategoryId : item.projectCategoryId;
    return visibleIds.has(categoryId) && expandedCategoryIds.has(categoryId);
  });

  const flowNodes: Array<Node<TreeItemData>> = [
    ...visibleCategories.map((category) => ({
      id: `category:${category.id}`,
      type: "category",
      position: savedPositions[`category:${category.id}`] ?? { x: 0, y: 0 },
      data: { entity: "category" as const, category, expanded: expandedCategoryIds.has(category.id), categoriesForcedVisible: showAllCategories, detail },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    })),
    ...visibleKnowledge.map((item) => ({
      id: `knowledge:${item.id}`,
      type: "knowledge",
      position: savedPositions[`knowledge:${item.id}`] ?? { x: 0, y: 0 },
      data: { entity: "knowledge" as const, knowledge: item, detail },
      sourcePosition: Position.Bottom,
      targetPosition: Position.Top,
    })),
  ];
  const flowEdges: Edge[] = [];
  for (const category of visibleCategories) {
    if (category.parentId && visibleIds.has(category.parentId)) {
      flowEdges.push({ id: `category:${category.parentId}->category:${category.id}`, source: `category:${category.parentId}`, target: `category:${category.id}`, type: "smoothstep" });
    }
  }
  for (const item of visibleKnowledge) {
    const categoryId = workspace === "topic" ? item.topicCategoryId : item.projectCategoryId;
    flowEdges.push({ id: `category:${categoryId}->knowledge:${item.id}`, source: `category:${categoryId}`, target: `knowledge:${item.id}`, type: "smoothstep" });
  }
  return applyLayout(flowNodes, flowEdges, savedPositions);
}

function applyLayout(nodes: Array<Node<TreeItemData>>, edges: Edge[], saved: Record<string, XYPosition>): TreeProjection {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: "TB", ranksep: 94, nodesep: 42, edgesep: 18, marginx: 40, marginy: 40 });
  for (const node of nodes) {
    const category = node.data.entity === "category";
    graph.setNode(node.id, { width: category ? CATEGORY_WIDTH : KNOWLEDGE_WIDTH, height: category ? CATEGORY_HEIGHT : KNOWLEDGE_HEIGHT });
  }
  for (const edge of edges) graph.setEdge(edge.source, edge.target);
  dagre.layout(graph);
  return {
    nodes: nodes.map((node) => {
      const point = graph.node(node.id) as { x: number; y: number };
      const category = node.data.entity === "category";
      const width = category ? CATEGORY_WIDTH : KNOWLEDGE_WIDTH;
      const height = category ? CATEGORY_HEIGHT : KNOWLEDGE_HEIGHT;
      return { ...node, position: saved[node.id] ?? { x: point.x - width / 2, y: point.y - height / 2 } };
    }),
    edges,
  };
}

export function positionsOf(nodes: Array<Node<TreeItemData>>): LayoutState["positions"] {
  return Object.fromEntries(nodes.map((node) => [node.id, node.position]));
}
