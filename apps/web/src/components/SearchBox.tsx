import { useDeferredValue, useState } from "react";
import type { SearchResult, Workspace } from "@knowt/contracts";
import { ActionIcon, Badge, Box, Group, Loader, Paper, ScrollArea, Text, TextInput } from "@mantine/core";
import { IconArrowRight, IconFolder, IconSearch, IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface Props {
  onReveal(node: SearchResult, workspace: Workspace): void;
}

export function SearchBox({ onReveal }: Props) {
  const [value, setValue] = useState("");
  const deferred = useDeferredValue(value.trim());
  const result = useQuery({
    queryKey: ["search", deferred], queryFn: () => api.search(deferred), enabled: deferred.length > 1,
  });
  const visible = value.trim().length > 1;
  return (
    <Box className="search-box">
      <TextInput
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
        placeholder="Search all knowledge..."
        leftSection={result.isFetching ? <Loader size={14} /> : <IconSearch size={16} />}
        rightSection={value ? <ActionIcon variant="subtle" size="sm" onClick={() => setValue("")}><IconX size={14} /></ActionIcon> : null}
        aria-label="Search all knowledge"
      />
      {visible && (
        <Paper className="search-results" shadow="xl" withBorder>
          <ScrollArea.Autosize mah={460}>
            {result.data?.length === 0 && <Text p="md" size="sm" c="dimmed">No matching knowledge</Text>}
            {result.data?.map((node) => <SearchRow key={node.id} node={node} onReveal={(workspace) => { onReveal(node, workspace); setValue(""); }} />)}
          </ScrollArea.Autosize>
        </Paper>
      )}
    </Box>
  );
}

function SearchRow({ node, onReveal }: { node: SearchResult; onReveal(workspace: Workspace): void }) {
  const excerpt = node.excerpt.replaceAll("[[", "").replaceAll("]]", "");
  return (
    <Box className="search-row">
      <Group justify="space-between" wrap="nowrap"><Text fw={650} size="sm" lineClamp={1}>{node.title}</Text><Badge size="xs" variant="light">{node.knowledgeType}</Badge></Group>
      <Text size="xs" c="dimmed" lineClamp={2} mt={3}>{excerpt}</Text>
      <Group gap="xs" mt={8}>
        <button className="search-path" onClick={() => onReveal("topic")}><IconFolder size={13} />{node.topicPath.map((item) => item.name).join(" / ")}<IconArrowRight size={12} /></button>
        <button className="search-path" onClick={() => onReveal("project")}><IconFolder size={13} />{node.projectPath.map((item) => item.name).join(" / ")}<IconArrowRight size={12} /></button>
      </Group>
    </Box>
  );
}
