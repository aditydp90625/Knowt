import { useCallback, useEffect, useMemo, useState } from "react";
import type { Category, CategorySearchResult, KnowledgeNode, LayoutState, NodeSearchResult, Workspace } from "@knowt/contracts";
import {
  ActionIcon,
  AppShell,
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Menu,
  Modal,
  NavLink,
  Select,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
  useMantineColorScheme,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconArrowsSplit,
  IconFolderPlus,
  IconHierarchy,
  IconHistory,
  IconInbox,
  IconLayoutSidebarRightCollapse,
  IconLibraryPlus,
  IconFolderOpen,
  IconArrowsMove,
  IconPlus,
  IconSettings,
  IconSitemap,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api/client";
import { KnowledgePanel } from "./components/KnowledgePanel";
import { ReviewQueue } from "./components/ReviewQueue";
import { SearchBox } from "./components/SearchBox";
import { SettingsView } from "./components/SettingsView";
import { TrashView } from "./components/TrashView";
import { TreeCanvas } from "./tree/TreeCanvas";
import type { TreeNodeActions } from "./tree/TreeNodes";

type Section = "knowledge" | "review" | "trash" | "settings";
type Selection = { categoryIds: string[]; nodeIds: string[] };
type NameDialog = { mode: "create" | "rename" | "parent"; title: string; parentId?: string | null; categoryId?: string };
type MoveDialog = Selection;
interface UndoAction { label: string; run(): Promise<void> }

const emptyLayout = (rootId: string): LayoutState => ({
  viewport: { x: 60, y: 36, zoom: 0.9 }, expandedCategoryIds: [rootId], positions: {},
});

export function App() {
  const client = useQueryClient();
  const { setColorScheme } = useMantineColorScheme();
  const [section, setSection] = useState<Section>("knowledge");
  const [workspace, setWorkspace] = useState<Workspace>("topic");
  const topicQuery = useQuery({ queryKey: ["taxonomy", "topic"], queryFn: () => api.taxonomy("topic") });
  const projectQuery = useQuery({ queryKey: ["taxonomy", "project"], queryFn: () => api.taxonomy("project") });
  const typeQuery = useQuery({ queryKey: ["knowledge-types"], queryFn: api.knowledgeTypes });
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  useEffect(() => {
    if (settingsQuery.data) setColorScheme(settingsQuery.data.theme === "system" ? "auto" : settingsQuery.data.theme);
  }, [settingsQuery.data]);
  const categories = useMemo(() => [...(topicQuery.data?.categories ?? []), ...(projectQuery.data?.categories ?? [])], [topicQuery.data, projectQuery.data]);
  const knowledge = topicQuery.data?.nodes ?? projectQuery.data?.nodes ?? [];
  const workspaceCategories = useMemo(() => categories.filter((item) => item.workspace === workspace), [categories, workspace]);
  const roots = useMemo(
    () => workspaceCategories.filter((item) => item.parentId === null).sort((a, b) => a.name.localeCompare(b.name)),
    [workspaceCategories],
  );
  const [rootByWorkspace, setRootByWorkspace] = useState<Partial<Record<Workspace, string>>>({});
  const rootId = rootByWorkspace[workspace] ?? roots[0]?.id;
  useEffect(() => {
    if (!rootByWorkspace[workspace] && roots[0]) setRootByWorkspace((current) => ({ ...current, [workspace]: roots[0]!.id }));
  }, [rootByWorkspace, roots, workspace]);

  const layoutQuery = useQuery({
    queryKey: ["layout", workspace, rootId], queryFn: () => api.layout(workspace, rootId!), enabled: Boolean(rootId),
  });
  const [layout, setLayout] = useState<LayoutState>();
  useEffect(() => {
    if (rootId && !layoutQuery.isFetching) setLayout(layoutQuery.data ?? emptyLayout(rootId));
  }, [layoutQuery.dataUpdatedAt, rootId, workspace]);
  const saveLayout = useMutation({ mutationFn: (state: LayoutState) => api.saveLayout(workspace, rootId!, state) });

  const [selection, setSelection] = useState<Selection>({ categoryIds: [], nodeIds: [] });
  const [focusedTreeItemId, setFocusedTreeItemId] = useState<string>();
  const [openNodeIds, setOpenNodeIds] = useState<string[]>([]);
  const [activeNodeId, setActiveNodeId] = useState<string>();
  const [splitNodeId, setSplitNodeId] = useState<string>();
  const [draftCategoryId, setDraftCategoryId] = useState<string>();
  const [nameDialog, setNameDialog] = useState<NameDialog>();
  const [moveDialog, setMoveDialog] = useState<MoveDialog>();
  const [dialogName, setDialogName] = useState("");
  const [moveDestination, setMoveDestination] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoAction>();
  const updateSelection = useCallback((next: Selection) => {
    setSelection((current) => {
      const sameCategories = current.categoryIds.length === next.categoryIds.length && current.categoryIds.every((id, index) => id === next.categoryIds[index]);
      const sameNodes = current.nodeIds.length === next.nodeIds.length && current.nodeIds.every((id, index) => id === next.nodeIds[index]);
      return sameCategories && sameNodes ? current : next;
    });
  }, []);

  const invalidateKnowledge = useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["taxonomy"] }),
      client.invalidateQueries({ queryKey: ["trash"] }),
    ]);
  }, [client]);

  const openNode = useCallback((id: string) => {
    setDraftCategoryId(undefined);
    setOpenNodeIds((current) => current.includes(id) ? current : [...current, id]);
    setActiveNodeId(id);
  }, []);
  const openNodes = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setDraftCategoryId(undefined);
    setOpenNodeIds((current) => [...new Set([...current, ...ids])]);
    setActiveNodeId(ids.at(-1));
  }, []);
  const closeNode = useCallback((id: string) => {
    setOpenNodeIds((current) => {
      const next = current.filter((item) => item !== id);
      setActiveNodeId((active) => active === id ? next.at(-1) : active);
      return next;
    });
    if (splitNodeId === id) setSplitNodeId(undefined);
  }, [splitNodeId]);

  const saveCurrentLayout = useCallback((state: LayoutState) => {
    setLayout(state);
    saveLayout.mutate(state);
  }, [saveLayout]);

  const toggleCategory = useCallback((categoryId: string) => {
    if (!rootId) return;
    const current = layout ?? emptyLayout(rootId);
    const expanded = new Set(current.expandedCategoryIds);
    if (expanded.has(categoryId) && categoryId !== rootId) expanded.delete(categoryId); else expanded.add(categoryId);
    saveCurrentLayout({ ...current, expandedCategoryIds: [...expanded] });
  }, [layout, rootId, saveCurrentLayout]);

  const showError = useCallback((error: unknown) => notifications.show({ color: "red", title: "Change not applied", message: error instanceof Error ? error.message : String(error) }), []);

  const trashNodes = useCallback((ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter((id) => knowledge.some((node) => node.id === id));
    if (!uniqueIds.length) return;
    const selectedNames = uniqueIds.map((id) => knowledge.find((node) => node.id === id)!.title);
    modals.openConfirmModal({
      title: uniqueIds.length === 1 ? "Move this node to Trash?" : `Move ${uniqueIds.length} nodes to Trash?`,
      children: <Stack gap="xs"><Text size="sm">{uniqueIds.length === 1 ? selectedNames[0] : selectedNames.slice(0, 4).join(", ")}{selectedNames.length > 4 ? ` and ${selectedNames.length - 4} more` : ""}</Text><Text size="sm" c="dimmed">This is recoverable from Trash.</Text></Stack>,
      labels: { confirm: "Move to Trash", cancel: "Cancel" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        try {
          await Promise.all(uniqueIds.map(api.deleteNode));
          const removed = new Set(uniqueIds);
          setOpenNodeIds((current) => current.filter((id) => !removed.has(id)));
          setActiveNodeId((current) => current && removed.has(current) ? undefined : current);
          setSplitNodeId((current) => current && removed.has(current) ? undefined : current);
          setSelection({ categoryIds: [], nodeIds: [] });
          await invalidateKnowledge();
          notifications.show({ color: "orange", message: uniqueIds.length === 1 ? "Moved to Trash" : `${uniqueIds.length} nodes moved to Trash` });
        } catch (error) { showError(error); }
      },
    });
  }, [invalidateKnowledge, knowledge, showError]);

  const deleteSelection = useCallback(async (target: Selection) => {
    const nodeIds = [...new Set(target.nodeIds)].filter((id) => knowledge.some((node) => node.id === id));
    const selectedCategories = [...new Set(target.categoryIds)]
      .map((id) => categories.find((category) => category.id === id))
      .filter((category): category is Category => Boolean(category));
    if (!nodeIds.length && !selectedCategories.length) return;
    if (selectedCategories.some((category) => category.protected)) {
      showError(new Error("Protected fallback categories cannot be deleted"));
      return;
    }
    try {
      const previews = await Promise.all(selectedCategories.map((category) => api.deletionPreview(category.id)));
      const conflicts = previews.filter((preview) => preview.hasNameConflicts);
      if (conflicts.length) {
        showError(new Error(`Resolve naming conflicts beneath ${conflicts.map((preview) => preview.category.name).join(", ")} before deleting the selection`));
        return;
      }
      const categoryById = new Map(categories.map((category) => [category.id, category]));
      const depth = (category: Category): number => {
        let value = 0;
        let current = category.parentId ? categoryById.get(category.parentId) : undefined;
        while (current) { value += 1; current = current.parentId ? categoryById.get(current.parentId) : undefined; }
        return value;
      };
      const categoriesDeepestFirst = [...selectedCategories].sort((left, right) => depth(right) - depth(left));
      const total = nodeIds.length + selectedCategories.length;
      modals.openConfirmModal({
        title: `Delete ${total} selected ${total === 1 ? "item" : "items"}?`,
        children: <Stack gap="xs">
          {nodeIds.length > 0 && <Text size="sm">{nodeIds.length} knowledge {nodeIds.length === 1 ? "node will" : "nodes will"} move to recoverable Trash.</Text>}
          {selectedCategories.length > 0 && <Text size="sm">{selectedCategories.length} {selectedCategories.length === 1 ? "category will" : "categories will"} be deleted. Their remaining contents will move to the nearest surviving parent.</Text>}
        </Stack>,
        labels: { confirm: "Delete selected", cancel: "Cancel" },
        confirmProps: { color: "red" },
        onConfirm: async () => {
          try {
            await Promise.all(nodeIds.map(api.deleteNode));
            for (const category of categoriesDeepestFirst) await api.deleteCategory(category.id);
            const removed = new Set(nodeIds);
            setOpenNodeIds((current) => current.filter((id) => !removed.has(id)));
            setActiveNodeId((current) => current && removed.has(current) ? undefined : current);
            setSplitNodeId((current) => current && removed.has(current) ? undefined : current);
            setSelection({ categoryIds: [], nodeIds: [] });
            setLayout((current) => current ? ({ ...current, positions: {} }) : current);
            await invalidateKnowledge();
            notifications.show({ color: "orange", message: `${total} selected ${total === 1 ? "item" : "items"} deleted` });
          } catch (error) { showError(error); }
        },
      });
    } catch (error) { showError(error); }
  }, [categories, invalidateKnowledge, knowledge, showError]);

  useEffect(() => {
    const handleDeleteKey = (event: KeyboardEvent) => {
      if (section !== "knowledge" || event.key !== "Delete" || (!selection.nodeIds.length && !selection.categoryIds.length)) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      void deleteSelection(selection);
    };
    window.addEventListener("keydown", handleDeleteKey);
    return () => window.removeEventListener("keydown", handleDeleteKey);
  }, [deleteSelection, section, selection]);

  const moveItem = useCallback(async (kind: "category" | "knowledge", id: string, destinationCategoryId: string) => {
    try {
      if (kind === "category") {
        const category = categories.find((item) => item.id === id)!;
        const previous = category.parentId;
        await api.moveCategory(id, destinationCategoryId);
        setUndo({ label: `Moved ${category.name}`, run: async () => { await api.moveCategory(id, previous); await invalidateKnowledge(); } });
      } else {
        const node = knowledge.find((item) => item.id === id)!;
        const previous = workspace === "topic" ? node.topicCategoryId : node.projectCategoryId;
        const moved = await api.moveNode(id, workspace, destinationCategoryId, node.version);
        setUndo({ label: `Moved ${node.title}`, run: async () => { await api.moveNode(id, workspace, previous, moved.version); await invalidateKnowledge(); } });
      }
      setLayout((current) => current ? ({ ...current, positions: {} }) : current);
      await invalidateKnowledge();
      notifications.show({ color: "teal", message: "Hierarchy updated" });
    } catch (error) { showError(error); }
  }, [categories, invalidateKnowledge, knowledge, workspace]);

  const startNameDialog = (dialog: NameDialog, initial = "") => { setDialogName(initial); setNameDialog(dialog); };
  const submitNameDialog = async () => {
    if (!nameDialog || !dialogName.trim()) return;
    try {
      if (nameDialog.mode === "create") await api.createCategory({ workspace, parentId: nameDialog.parentId ?? null, name: dialogName });
      if (nameDialog.mode === "rename" && nameDialog.categoryId) await api.renameCategory(nameDialog.categoryId, dialogName);
      if (nameDialog.mode === "parent") await api.createParent({ workspace, categoryIds: selection.categoryIds, nodeIds: selection.nodeIds, name: dialogName });
      setNameDialog(undefined);
      setDialogName("");
      setLayout((current) => current ? ({ ...current, positions: {} }) : current);
      await invalidateKnowledge();
    } catch (error) { showError(error); }
  };

  const deleteItem = useCallback(async (kind: "category" | "knowledge", id: string) => {
    const selectedCount = selection.categoryIds.length + selection.nodeIds.length;
    const clickedIsSelected = kind === "category" ? selection.categoryIds.includes(id) : selection.nodeIds.includes(id);
    if (clickedIsSelected && selectedCount > 1) {
      await deleteSelection(selection);
      return;
    }
    if (kind === "knowledge") {
      trashNodes([id]);
      return;
    }
    try {
      const preview = await api.deletionPreview(id);
      modals.openConfirmModal({
        title: `Delete ${preview.category.name}?`,
        children: <Stack gap="xs"><Text size="sm">{preview.childCategoryCount} child categories and {preview.directNodeCount} directly assigned nodes will move to <b>{preview.destination.name}</b>.</Text>{preview.hasNameConflicts && <Text size="sm" c="red">A naming conflict must be resolved before deletion.</Text>}</Stack>,
        labels: { confirm: "Delete category", cancel: "Cancel" }, confirmProps: { color: "red", disabled: preview.hasNameConflicts },
        onConfirm: async () => { await api.deleteCategory(id); await invalidateKnowledge(); },
      });
    } catch (error) { showError(error); }
  }, [deleteSelection, invalidateKnowledge, selection, showError, trashNodes]);

  const treeActions = useMemo<TreeNodeActions>(() => ({
    toggle: toggleCategory,
    openNode: (id) => openNodes(selection.nodeIds.includes(id) && selection.nodeIds.length > 1 ? selection.nodeIds : [id]),
    createNode: (categoryId) => setDraftCategoryId(categoryId),
    createChild: (categoryId) => startNameDialog({ mode: "create", title: "Create child category", parentId: categoryId }),
    renameCategory: (categoryId) => {
      const category = categories.find((item) => item.id === categoryId);
      if (category) startNameDialog({ mode: "rename", title: "Rename category", categoryId }, category.name);
    },
    moveItem: (kind, id) => {
      const selectedCount = selection.categoryIds.length + selection.nodeIds.length;
      const clickedIsSelected = kind === "category" ? selection.categoryIds.includes(id) : selection.nodeIds.includes(id);
      setMoveDestination(null);
      setMoveDialog(clickedIsSelected && selectedCount > 1
        ? selection
        : { categoryIds: kind === "category" ? [id] : [], nodeIds: kind === "knowledge" ? [id] : [] });
    },
    deleteItem: (kind, id) => void deleteItem(kind, id),
  }), [categories, deleteItem, openNodes, selection, toggleCategory]);

  const revealNodeSearch = (node: NodeSearchResult, targetWorkspace: Workspace) => {
    setSection("knowledge");
    setWorkspace(targetWorkspace);
    const path = targetWorkspace === "topic" ? node.topicPath : node.projectPath;
    if (!path[0]) return;
    setRootByWorkspace((current) => ({ ...current, [targetWorkspace]: path[0]!.id }));
    const state = { ...emptyLayout(path[0].id), expandedCategoryIds: path.map((item) => item.id) };
    setLayout(state);
    void api.saveLayout(targetWorkspace, path[0].id, state);
    setFocusedTreeItemId(`knowledge:${node.id}`);
    window.setTimeout(() => setFocusedTreeItemId(undefined), 2_000);
  };

  const revealCategorySearch = (category: CategorySearchResult) => {
    setSection("knowledge");
    setWorkspace(category.workspace);
    if (!category.path[0]) return;
    setRootByWorkspace((current) => ({ ...current, [category.workspace]: category.path[0]!.id }));
    const state = { ...emptyLayout(category.path[0].id), expandedCategoryIds: category.path.map((item) => item.id) };
    setLayout(state);
    void api.saveLayout(category.workspace, category.path[0].id, state);
    setFocusedTreeItemId(`category:${category.id}`);
    window.setTimeout(() => setFocusedTreeItemId(undefined), 2_000);
  };

  const activeNode = knowledge.find((item) => item.id === activeNodeId);
  const splitNode = knowledge.find((item) => item.id === splitNodeId);
  const selectedCount = selection.categoryIds.length + selection.nodeIds.length;
  const selectionHasProtectedCategory = selection.categoryIds.some((id) => categories.find((item) => item.id === id)?.protected);
  const selectedCategory = selection.categoryIds.length === 1 ? categories.find((item) => item.id === selection.categoryIds[0]) : undefined;
  const fallbackTopic = categories.find((item) => item.workspace === "topic" && item.protected);
  const fallbackProject = categories.find((item) => item.workspace === "project" && item.protected);
  const draftSeed = draftCategoryId && fallbackTopic && fallbackProject ? {
    topicCategoryId: workspace === "topic" ? draftCategoryId : fallbackTopic.id,
    projectCategoryId: workspace === "project" ? draftCategoryId : fallbackProject.id,
    knowledgeTypeId: typeQuery.data?.find((item) => item.enabled)?.id ?? "reference",
    templateMarkdown: typeQuery.data?.find((item) => item.enabled)?.templateMarkdown ?? "",
  } : undefined;
  const detailOpen = Boolean(activeNode || draftSeed);

  const categoryMoveOptions = useMemo(() => {
    if (!moveDialog) return [];
    const movingCategoryIds = new Set(moveDialog.categoryIds);
    const isDescendant = (candidate: Category): boolean => {
      let parent = candidate.parentId ? categories.find((item) => item.id === candidate.parentId) : undefined;
      while (parent) {
        if (movingCategoryIds.has(parent.id)) return true;
        const nextParentId = parent.parentId;
        parent = nextParentId ? categories.find((item) => item.id === nextParentId) : undefined;
      }
      return false;
    };
    return categorySelectOptions(workspaceCategories.filter((item) => !movingCategoryIds.has(item.id) && !isDescendant(item)));
  }, [categories, moveDialog, workspaceCategories]);

  const confirmMove = async () => {
    if (!moveDialog || !moveDestination) return;
    try {
      const categorySnapshots = moveDialog.categoryIds.map((id) => categories.find((item) => item.id === id)).filter((item): item is Category => Boolean(item));
      const nodeSnapshots = moveDialog.nodeIds.map((id) => knowledge.find((item) => item.id === id)).filter((item): item is KnowledgeNode => Boolean(item));
      if (categorySnapshots.some((item) => item.protected)) throw new Error("Protected fallback categories cannot be moved");

      const movingCategoryIds = new Set(categorySnapshots.map((item) => item.id));
      const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
      const destinationNames = new Set(workspaceCategories
        .filter((item) => item.parentId === moveDestination && !movingCategoryIds.has(item.id))
        .map((item) => normalize(item.name)));
      for (const category of categorySnapshots) {
        const name = normalize(category.name);
        if (destinationNames.has(name)) throw new Error(`A category named ${category.name} already exists at that destination`);
        destinationNames.add(name);
      }

      for (const category of categorySnapshots) await api.moveCategory(category.id, moveDestination);
      const movedNodes: Array<{ id: string; previousCategoryId: string; movedVersion: number }> = [];
      for (const node of nodeSnapshots) {
        const previousCategoryId = workspace === "topic" ? node.topicCategoryId : node.projectCategoryId;
        const moved = await api.moveNode(node.id, workspace, moveDestination, node.version);
        movedNodes.push({ id: node.id, previousCategoryId, movedVersion: moved.version });
      }

      const itemCount = categorySnapshots.length + nodeSnapshots.length;
      setUndo({
        label: `Moved ${itemCount} ${itemCount === 1 ? "item" : "items"}`,
        run: async () => {
          for (const node of movedNodes) await api.moveNode(node.id, workspace, node.previousCategoryId, node.movedVersion);
          for (const category of [...categorySnapshots].reverse()) await api.moveCategory(category.id, category.parentId);
          await invalidateKnowledge();
        },
      });
      setMoveDialog(undefined);
      setSelection({ categoryIds: [], nodeIds: [] });
      setLayout((current) => current ? ({ ...current, positions: {} }) : current);
      await invalidateKnowledge();
      notifications.show({ color: "teal", message: itemCount === 1 ? "Item moved" : `${itemCount} items moved` });
    } catch (error) { showError(error); }
  };

  return (
    <AppShell header={{ height: 64 }} navbar={{ width: 212, breakpoint: "sm" }} padding={0}>
      <AppShell.Header className="app-header">
        <Group h="100%" px="md" wrap="nowrap">
          <Group gap="xs" className="brand"><div className="brand-mark"><IconSitemap size={20} /></div><Text fw={800} fz="lg">Knowt</Text></Group>
          <SearchBox onRevealNode={revealNodeSearch} onOpenNode={(node) => { setSection("knowledge"); openNode(node.id); }} onRevealCategory={revealCategorySearch} />
          <Button leftSection={<IconPlus size={16} />} onClick={() => {
            const preferred = selectedCategory?.id ?? rootId;
            if (preferred) setDraftCategoryId(preferred);
          }}>New knowledge</Button>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm" className="app-nav">
        <Stack gap={4}>
          <NavLink label="Knowledge map" leftSection={<IconHierarchy size={18} />} active={section === "knowledge"} onClick={() => setSection("knowledge")} />
          <NavLink label="Review Queue" leftSection={<IconInbox size={18} />} active={section === "review"} onClick={() => setSection("review")} />
          <NavLink label="Trash" leftSection={<IconTrash size={18} />} active={section === "trash"} onClick={() => setSection("trash")} />
        </Stack>
        <Box mt="auto"><Divider mb="sm" /><NavLink label="Settings" leftSection={<IconSettings size={18} />} active={section === "settings"} onClick={() => setSection("settings")} /></Box>
      </AppShell.Navbar>
      <AppShell.Main className="app-main">
        {section === "knowledge" && (
          <div className={`knowledge-workspace${detailOpen ? " with-detail" : ""}`}>
            <section className="canvas-column">
              <Group className="canvas-toolbar" wrap="nowrap">
                <SegmentedControl value={workspace} onChange={(value) => { setWorkspace(value as Workspace); setSelection({ categoryIds: [], nodeIds: [] }); }} data={[{ label: "Topical", value: "topic" }, { label: "Projects", value: "project" }]} />
                <Select className="root-select" value={rootId ?? null} onChange={(value) => value && setRootByWorkspace((current) => ({ ...current, [workspace]: value }))} data={roots.map((item) => ({ value: item.id, label: item.name }))} placeholder="Choose root" />
                <Tooltip label="Create root category"><ActionIcon variant="light" size="lg" onClick={() => startNameDialog({ mode: "create", title: `Create ${workspace} root`, parentId: null })}><IconFolderPlus size={18} /></ActionIcon></Tooltip>
                {selectedCount > 0 && <Group gap={6} wrap="nowrap" className="selection-actions">
                  <Badge variant="light" color="gray">{selectedCount} selected</Badge>
                  {selection.nodeIds.length > 0 && <Button variant="light" size="sm" leftSection={<IconFolderOpen size={16} />} onClick={() => openNodes(selection.nodeIds)}>Open{selection.nodeIds.length > 1 ? ` ${selection.nodeIds.length}` : ""}</Button>}
                  <Button variant="light" size="sm" leftSection={<IconArrowsMove size={16} />} disabled={selectionHasProtectedCategory} onClick={() => { setMoveDestination(null); setMoveDialog(selection); }}>Move</Button>
                  <Button variant="light" size="sm" leftSection={<IconLibraryPlus size={16} />} disabled={selectionHasProtectedCategory} onClick={() => startNameDialog({ mode: "parent", title: "Create parent around selection" })}>Create Parent</Button>
                  <Tooltip label={selectionHasProtectedCategory ? "Protected fallback categories cannot be deleted" : "Delete selected nodes and categories"}><Button variant="light" color="red" size="sm" leftSection={<IconTrash size={16} />} disabled={selectionHasProtectedCategory} onClick={() => void deleteSelection(selection)}>Delete</Button></Tooltip>
                </Group>}
              </Group>
              <div className="canvas-wrap" onKeyDown={(event) => { if (event.key === "Enter" && selection.nodeIds.length) openNodes(selection.nodeIds); }}>
                {rootId && layout && <TreeCanvas key={`${workspace}:${rootId}`} workspace={workspace} rootId={rootId} categories={workspaceCategories} knowledge={knowledge} layout={layout} focusedItemId={focusedTreeItemId} actions={treeActions} onOpenNode={openNode} onSaveLayout={saveCurrentLayout} onMoveItem={moveItem} onSelectionChange={updateSelection} />}
              </div>
            </section>
            {detailOpen && (
              <aside className={`detail-column${splitNode ? " split" : ""}`}>
                <Group className="node-tabs" gap={4} wrap="nowrap">
                  {openNodeIds.map((id) => { const node = knowledge.find((item) => item.id === id); return node ? <button key={id} className={`node-tab${id === activeNodeId ? " active" : ""}`} onClick={() => setActiveNodeId(id)}>{node.title}<IconX size={12} onClick={(event) => { event.stopPropagation(); closeNode(id); }} /></button> : null; })}
                  {draftSeed && <button className="node-tab active">New node</button>}
                  <Box ml="auto" />
                  {openNodeIds.length > 1 && <Tooltip label={splitNode ? "Close split" : "Split with another open node"}><ActionIcon variant="subtle" onClick={() => setSplitNodeId(splitNode ? undefined : openNodeIds.find((id) => id !== activeNodeId))}><IconArrowsSplit size={17} /></ActionIcon></Tooltip>}
                  <ActionIcon variant="subtle" onClick={() => { setDraftCategoryId(undefined); if (activeNodeId) closeNode(activeNodeId); }}><IconLayoutSidebarRightCollapse size={17} /></ActionIcon>
                </Group>
                <div className="panel-grid">
                  <KnowledgePanel node={activeNode} draft={draftSeed} categories={categories} knowledgeTypes={typeQuery.data ?? []} onSaved={(saved) => { setDraftCategoryId(undefined); openNode(saved.id); void invalidateKnowledge(); }} onClose={() => { setDraftCategoryId(undefined); if (activeNodeId) closeNode(activeNodeId); }} onDeleted={closeNode} />
                  {splitNode && <KnowledgePanel node={splitNode} categories={categories} knowledgeTypes={typeQuery.data ?? []} onSaved={() => void invalidateKnowledge()} onClose={() => setSplitNodeId(undefined)} onDeleted={closeNode} />}
                </div>
              </aside>
            )}
          </div>
        )}
        {section === "review" && <ReviewQueue categories={categories} knowledgeTypes={typeQuery.data ?? []} />}
        {section === "trash" && <TrashView />}
        {section === "settings" && <SettingsView />}
      </AppShell.Main>

      <Modal opened={Boolean(nameDialog)} onClose={() => setNameDialog(undefined)} title={nameDialog?.title} centered>
        <Stack><TextInput autoFocus label="Name" value={dialogName} onChange={(event) => setDialogName(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === "Enter") void submitNameDialog(); }} /><Group justify="flex-end"><Button variant="subtle" onClick={() => setNameDialog(undefined)}>Cancel</Button><Button disabled={!dialogName.trim()} onClick={() => void submitNameDialog()}>Save</Button></Group></Stack>
      </Modal>
      <Modal opened={Boolean(moveDialog)} onClose={() => setMoveDialog(undefined)} title="Move to category" centered>
        <Stack><Select searchable label="Destination" data={categoryMoveOptions} value={moveDestination} onChange={setMoveDestination} /><Group justify="flex-end"><Button variant="subtle" onClick={() => setMoveDialog(undefined)}>Cancel</Button><Button disabled={!moveDestination} onClick={() => void confirmMove()}>Move</Button></Group></Stack>
      </Modal>
      {undo && <div className="undo-toast"><Text size="sm">{undo.label}</Text><Button size="compact-sm" variant="subtle" onClick={() => { void undo.run().then(() => setUndo(undefined)).catch(showError); }}>Undo</Button><ActionIcon size="sm" variant="subtle" onClick={() => setUndo(undefined)}><IconX size={14} /></ActionIcon></div>}
    </AppShell>
  );
}

function categorySelectOptions(categories: Category[]) {
  const byId = new Map(categories.map((item) => [item.id, item]));
  return categories.map((item) => {
    const path = [item.name];
    let parent = item.parentId ? byId.get(item.parentId) : undefined;
    while (parent) { path.unshift(parent.name); parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
    return { value: item.id, label: path.join(" / ") };
  }).sort((a, b) => a.label.localeCompare(b.label));
}
