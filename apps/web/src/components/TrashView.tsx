import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconTrash } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function TrashView() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["trash"], queryFn: api.trash });
  const restore = useMutation({
    mutationFn: api.restoreNode,
    onSuccess: async () => {
      await Promise.all([client.invalidateQueries({ queryKey: ["trash"] }), client.invalidateQueries({ queryKey: ["taxonomy"] })]);
      notifications.show({ color: "teal", message: "Knowledge Node restored" });
    },
  });
  const permanentlyDelete = useMutation({
    mutationFn: api.permanentlyDeleteNode,
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["trash"] }); },
  });
  const confirmDelete = (id: string, title: string) => modals.openConfirmModal({
    title: "Permanently delete this node?",
    children: <Text size="sm">“{title}” and its complete revision history will be removed. This cannot be undone.</Text>,
    labels: { confirm: "Delete permanently", cancel: "Cancel" },
    confirmProps: { color: "red" },
    onConfirm: () => permanentlyDelete.mutate(id),
  });
  return (
    <Stack className="page-view" p="xl">
      <div><Title order={2}>Trash</Title><Text c="dimmed">Deleted Knowledge Nodes remain recoverable until you remove them permanently.</Text></div>
      {query.data?.length === 0 && <Paper p="xl" withBorder><Text c="dimmed">Trash is empty.</Text></Paper>}
      {query.data?.map((node) => <Paper key={node.id} p="md" withBorder><Group justify="space-between"><div><Text fw={650}>{node.title}</Text><Text size="xs" c="dimmed">Deleted {node.deletedAt ? new Date(node.deletedAt).toLocaleString() : ""}</Text></div><Group><Button variant="light" size="xs" leftSection={<IconArrowBackUp size={15} />} onClick={() => restore.mutate(node.id)}>Restore</Button><Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={15} />} onClick={() => confirmDelete(node.id, node.title)}>Delete permanently</Button></Group></Group></Paper>)}
    </Stack>
  );
}
