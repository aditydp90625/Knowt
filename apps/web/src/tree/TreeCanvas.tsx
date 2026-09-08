import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category, KnowledgeNode, LayoutState, Workspace } from "@knowt/contracts";
import { useComputedColorScheme } from "@mantine/core";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  type Node,
  type NodeMouseHandler,
  type OnMoveEnd,
  type OnNodeDrag,
  type OnSelectionChangeFunc,
  type ReactFlowInstance,
} from "@xyflow/react";
import { CategoryTreeNode, KnowledgeTreeNode, setTreeNodeActions, type TreeNodeActions } from "./TreeNodes";
import { positionsOf, projectTree, type TreeItemData } from "./layout";

const nodeTypes = { category: CategoryTreeNode, knowledge: KnowledgeTreeNode };

interface Props {
  workspace: Workspace;
  rootId: string;
  categories: Category[];
  knowledge: KnowledgeNode[];
  layout: LayoutState | null | undefined;
  focusedNodeId?: string | undefined;
  actions: TreeNodeActions;
  onOpenNode(id: string): void;
  onSaveLayout(state: LayoutState): void;
  onMoveItem(kind: "category" | "knowledge", id: string, destinationCategoryId: string): void;
  onSelectionChange(selection: { categoryIds: string[]; nodeIds: string[] }): void;
}

function Canvas(props: Props) {
  const colorScheme = useComputedColorScheme("light");
  const { actions, focusedNodeId, onMoveItem, onOpenNode, onSaveLayout, onSelectionChange: reportSelection } = props;
  const expanded = useMemo(() => new Set(props.layout?.expandedCategoryIds ?? [props.rootId]), [props.layout, props.rootId]);
  const expandedRef = useRef(expanded);
  const [detail, setDetail] = useState<TreeItemData["detail"]>("medium");
  const projected = useMemo(() => projectTree(
    props.workspace, props.rootId, props.categories, props.knowledge, expanded,
    props.layout?.positions ?? {}, detail,
  ), [props.workspace, props.rootId, props.categories, props.knowledge, props.layout?.positions, expanded, detail]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<TreeItemData>>(projected.nodes);
  const [dropTargetId, setDropTargetId] = useState<string>();
  const instance = useRef<ReactFlowInstance<Node<TreeItemData>> | null>(null);
  const viewport = useRef(props.layout?.viewport ?? { x: 0, y: 0, zoom: 1 });

  useEffect(() => setNodes(projected.nodes), [projected.nodes, setNodes]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => setTreeNodeActions(actions), [actions]);

  const persist = useCallback((nextExpanded = expandedRef.current) => {
    onSaveLayout({
      viewport: viewport.current,
      expandedCategoryIds: [...nextExpanded],
      positions: positionsOf(instance.current?.getNodes() ?? nodes),
    });
  }, [nodes, onSaveLayout]);

  const onMoveEnd: OnMoveEnd = useCallback((_event, nextViewport) => {
    viewport.current = nextViewport;
    const nextDetail = nextViewport.zoom < 0.45 ? "far" : nextViewport.zoom < 0.9 ? "medium" : "close";
    if (nextDetail !== detail) setDetail(nextDetail);
    persist();
  }, [detail, persist]);

  const onNodeDrag: OnNodeDrag<Node<TreeItemData>> = useCallback((_event, dragged) => {
    const intersections = instance.current?.getIntersectingNodes(dragged, true) ?? [];
    const target = intersections.find((candidate) => candidate.data.entity === "category" && candidate.id !== dragged.id);
    const targetId = target?.data.category?.id;
    setDropTargetId(targetId);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, dropTarget: node.data.category?.id === targetId } })));
  }, [setNodes]);

  const onNodeDragStop: OnNodeDrag<Node<TreeItemData>> = useCallback((_event, dragged) => {
    if (dropTargetId) {
      const kind = dragged.data.entity === "category" ? "category" : "knowledge";
      const id = kind === "category" ? dragged.data.category!.id : dragged.data.knowledge!.id;
      onMoveItem(kind, id, dropTargetId);
    } else {
      persist();
    }
    setDropTargetId(undefined);
    setNodes((current) => current.map((node) => ({ ...node, data: { ...node.data, dropTarget: false } })));
  }, [dropTargetId, onMoveItem, persist, setNodes]);

  const onNodeDoubleClick: NodeMouseHandler<Node<TreeItemData>> = useCallback((_event, node) => {
    if (node.data.entity === "knowledge") onOpenNode(node.data.knowledge!.id);
  }, [onOpenNode]);

  const onSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: selected }) => {
    reportSelection({
      categoryIds: selected.filter((node) => node.data.entity === "category").map((node) => (node.data as TreeItemData).category!.id),
      nodeIds: selected.filter((node) => node.data.entity === "knowledge").map((node) => (node.data as TreeItemData).knowledge!.id),
    });
  }, [reportSelection]);

  useEffect(() => {
    if (!focusedNodeId || !instance.current) return;
    const id = `knowledge:${focusedNodeId}`;
    const node = instance.current.getNode(id);
    if (node) void instance.current.setCenter(node.position.x + 100, node.position.y + 42, { zoom: 1.15, duration: 650 });
  }, [focusedNodeId, nodes]);

  return (
    <ReactFlow<Node<TreeItemData>>
      nodes={nodes}
      edges={projected.edges}
      nodeTypes={nodeTypes}
      onInit={(value) => { instance.current = value; }}
      onNodesChange={onNodesChange}
      onMoveEnd={onMoveEnd}
      onNodeDrag={onNodeDrag}
      onNodeDragStop={onNodeDragStop}
      onNodeDoubleClick={onNodeDoubleClick}
      onSelectionChange={onSelectionChange}
      defaultViewport={props.layout?.viewport ?? { x: 60, y: 36, zoom: 0.9 }}
      minZoom={0.18}
      maxZoom={2}
      selectionOnDrag
      multiSelectionKeyCode="Shift"
      panOnDrag={[1, 2]}
      zoomOnDoubleClick={false}
      nodesConnectable={false}
      deleteKeyCode={null}
      fitView={!props.layout}
      fitViewOptions={{ padding: 0.22 }}
      colorMode={colorScheme}
    >
      <Background variant={BackgroundVariant.Dots} gap={28} size={1.2} color={colorScheme === "dark" ? "#59615b" : "#c8c2b6"} />
      <MiniMap pannable zoomable nodeColor={(node) => node.type === "category" ? "#314c47" : "#a86442"} maskColor={colorScheme === "dark" ? "rgba(32,37,34,.78)" : "rgba(243,240,232,.76)"} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}

export function TreeCanvas(props: Props) {
  return <ReactFlowProvider><Canvas {...props} /></ReactFlowProvider>;
}
