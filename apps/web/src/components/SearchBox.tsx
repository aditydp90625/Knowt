import { useDeferredValue, useState, type RefObject } from "react";
import type { CategorySearchResult, NodeSearchResult, Workspace } from "@knowt/contracts";
import { ActionIcon, Badge, Box, Group, Loader, Paper, ScrollArea, Text, TextInput } from "@mantine/core";
import { IconArrowRight, IconFileText, IconFolder, IconSearch, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { knowledgeTypeColor } from "../knowledge-types";

interface Props {
  onRevealNode(node: NodeSearchResult, workspace: Workspace): void;
  onOpenNode(node: NodeSearchResult): void;
  onRevealCategory(category: CategorySearchResult): void;
  inputRef?: RefObject<HTMLInputElement | null>;
}

export function SearchBox({ onRevealNode, onOpenNode, onRevealCategory, inputRef }: Props) {
  const [value, setValue] = useState("");
  const deferred = useDeferredValue(value.trim());
  const result = useQuery({
    queryKey: ["search", deferred], queryFn: () => api.search(deferred), enabled: deferred.length > 1,
  });
  const visible = value.trim().length > 1;
  const close = () => setValue("");
  return (
    <Box className="search-box">
      <TextInput
        ref={inputRef}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder="Search nodes and categories..."
        leftSection={result.isFetching ? <Loader size={14} /> : <IconSearch size={16} />}
        rightSection={value ? <ActionIcon variant="subtle" size="sm" onClick={close}><IconX size={14} /></ActionIcon> : null}
        aria-label="Search nodes and categories"
      />
      {visible && (
        <Paper className="search-results" shadow="xl" withBorder>
          <ScrollArea.Autosize mah={460}>
            {result.data?.length === 0 && <Text p="md" size="sm" c="dimmed">No matching nodes or categories</Text>}
            {result.data?.map((item) => item.kind === "category"
              ? <CategoryRow key={`category:${item.id}`} category={item} onReveal={() => { onRevealCategory(item); close(); }} />
              : <NodeRow key={`node:${item.id}`} node={item} onOpen={() => { onOpenNode(item); close(); }} onReveal={(workspace) => { onRevealNode(item, workspace); close(); }} />)}
          </ScrollArea.Autosize>
        </Paper>
      )}
    </Box>
  );
}

function CategoryRow({ category, onReveal }: { category: CategorySearchResult; onReveal(): void }) {
  return (
    <Box className="search-row">
      <Group justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap"><IconFolder size={16} /><Text fw={650} size="sm" lineClamp={1}>{category.name}</Text></Group>
        <Badge size="xs" variant="light" color="gray">{category.workspace === "topic" ? "Topic" : "Project"}</Badge>
      </Group>
      <Text size="xs" c="dimmed" mt={3}>{category.descendantNodeCount} knowledge {category.descendantNodeCount === 1 ? "node" : "nodes"}</Text>
      <button className="search-path" onClick={onReveal}><IconFolder size={13} />{category.path.map((item) => item.name).join(" / ")}<IconArrowRight size={12} /></button>
    </Box>
  );
}

function NodeRow({ node, onOpen, onReveal }: { node: NodeSearchResult; onOpen(): void; onReveal(workspace: Workspace): void }) {
  const excerpt = node.excerpt.replaceAll("[[", "").replaceAll("]]", "");
  return (
    <Box className="search-row">
      <Group justify="space-between" wrap="nowrap"><Group gap="xs" wrap="nowrap"><IconFileText size={16} /><Text fw={650} size="sm" lineClamp={1}>{node.title}</Text></Group><Badge size="xs" variant="filled" color={knowledgeTypeColor(node.knowledgeType)}>{node.knowledgeType}</Badge></Group>
      <Text size="xs" c="dimmed" lineClamp={2} mt={3}>{excerpt}</Text>
      <Group gap="xs" mt={8} wrap="nowrap">
        <button className="search-path search-open" onClick={onOpen}><IconFileText size={13} />Open node<IconArrowRight size={12} /></button>
        <button className="search-path" onClick={() => onReveal("topic")}><IconFolder size={13} />{node.topicPath.map((item) => item.name).join(" / ")}<IconArrowRight size={12} /></button>
        <button className="search-path" onClick={() => onReveal("project")}><IconFolder size={13} />{node.projectPath.map((item) => item.name).join(" / ")}<IconArrowRight size={12} /></button>
      </Group>
    </Box>
  );
}
