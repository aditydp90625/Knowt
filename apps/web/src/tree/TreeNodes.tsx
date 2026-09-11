import { ActionIcon, Badge, Group, Stack, Text, Tooltip } from "@mantine/core";
import { IconChevronDown, IconChevronRight, IconDots, IconFileText, IconFolder } from "@tabler/icons-react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import { knowledgeTypeClass, knowledgeTypeColor } from "../knowledge-types";
import type { TreeItemData } from "./layout";

export interface TreeNodeActions {
  toggle(categoryId: string): void;
  openNode(nodeId: string): void;
  createNode(categoryId: string): void;
  createChild(categoryId: string): void;
  renameCategory(categoryId: string): void;
  moveItem(kind: "category" | "knowledge", id: string): void;
  deleteItem(kind: "category" | "knowledge", id: string): void;
}

let actions: TreeNodeActions | undefined;
export function setTreeNodeActions(value: TreeNodeActions): void { actions = value; }

const MenuItem = ({ children, danger, onSelect }: { children: React.ReactNode; danger?: boolean; onSelect(): void }) => (
  <ContextMenu.Item className={`context-item${danger ? " danger" : ""}`} onSelect={onSelect}>{children}</ContextMenu.Item>
);

export function CategoryTreeNode({ data, selected }: NodeProps) {
  const value = data as TreeItemData;
  const category = value.category!;
  const hasContents = value.categoriesForcedVisible ? category.directNodeCount > 0 : category.descendantNodeCount > 0;
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div className={`tree-card category-card${selected ? " selected" : ""}${value.dropTarget ? " drop-target" : ""}`}>
          <Handle type="target" position={Position.Top} />
          <Group gap="xs" wrap="nowrap">
            <ActionIcon
              className="nodrag"
              variant="subtle"
              size="sm"
              aria-label={value.categoriesForcedVisible
                ? value.expanded ? "Hide category nodes" : "Show category nodes"
                : value.expanded ? "Collapse category" : "Expand category"}
              disabled={!hasContents}
              onClick={(event) => { event.stopPropagation(); actions?.toggle(category.id); }}
            >
              {value.expanded ? <IconChevronDown size={15} /> : <IconChevronRight size={15} />}
            </ActionIcon>
            <IconFolder size={18} stroke={1.7} />
            <Text fw={650} lineClamp={1} className="tree-title">{category.name}</Text>
            <Badge size="sm" variant="light" color="gray">{category.descendantNodeCount}</Badge>
          </Group>
          {value.detail === "close" && <Text size="xs" c="dimmed" mt={5}>{category.directNodeCount} directly assigned</Text>}
          <Handle type="source" position={Position.Bottom} />
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu">
          <MenuItem onSelect={() => actions?.createNode(category.id)}>Create Knowledge Node here</MenuItem>
          <MenuItem onSelect={() => actions?.createChild(category.id)}>Create child category</MenuItem>
          <ContextMenu.Separator className="context-separator" />
          <MenuItem onSelect={() => actions?.renameCategory(category.id)}>Rename</MenuItem>
          {!category.protected && <MenuItem onSelect={() => actions?.moveItem("category", category.id)}>Move...</MenuItem>}
          {!category.protected && <MenuItem danger onSelect={() => actions?.deleteItem("category", category.id)}>Delete...</MenuItem>}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export function KnowledgeTreeNode({ data, selected }: NodeProps) {
  const value = data as TreeItemData;
  const knowledge = value.knowledge!;
  const card = (
    <div className={`tree-card knowledge-card ${knowledgeTypeClass(knowledge.knowledgeType)}${selected ? " selected" : ""}`} onDoubleClick={() => actions?.openNode(knowledge.id)}>
      <Handle type="target" position={Position.Top} />
      <Group gap="xs" wrap="nowrap">
        <IconFileText size={16} stroke={1.8} />
        {value.detail !== "far" && <Text fw={600} lineClamp={2} className="tree-title">{knowledge.title}</Text>}
        {value.detail === "far" && <span className="knowledge-dot" />}
      </Group>
      {value.detail === "close" && (
        <Group gap={5} mt={7}>
          <Badge size="xs" variant="filled" color={knowledgeTypeColor(knowledge.knowledgeType)}>{knowledge.knowledgeType}</Badge>
          {knowledge.tags.slice(0, 2).map((tag) => <Badge size="xs" variant="outline" color="gray" key={tag}>{tag}</Badge>)}
        </Group>
      )}
    </div>
  );
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>
        <div>
          <Tooltip label={<Stack gap={2}><Text fw={650}>{knowledge.title}</Text><Text size="xs">{knowledge.knowledgeType}</Text><Text size="xs" lineClamp={3}>{knowledge.contentMarkdown.slice(0, 220)}</Text></Stack>} openDelay={450} multiline w={320} withArrow>
            {card}
          </Tooltip>
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="context-menu">
          <MenuItem onSelect={() => actions?.openNode(knowledge.id)}>Open</MenuItem>
          <MenuItem onSelect={() => actions?.moveItem("knowledge", knowledge.id)}>Move...</MenuItem>
          <ContextMenu.Separator className="context-separator" />
          <MenuItem danger onSelect={() => actions?.deleteItem("knowledge", knowledge.id)}>Move to Trash</MenuItem>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
