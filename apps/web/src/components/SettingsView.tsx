import { useEffect, useState } from "react";
import type { AppSettings } from "@knowt/contracts";
import { Button, FileButton, Group, NumberInput, Paper, SegmentedControl, Stack, Text, TextInput, Title, useMantineColorScheme } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconArchive, IconDeviceFloppy, IconDownload, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function SettingsView() {
  const client = useQueryClient();
  const { setColorScheme } = useMantineColorScheme();
  const query = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [form, setForm] = useState<AppSettings>({ theme: "system", inboxPath: "data/inbox", rejectedRetentionDays: 30 });
  const applyTheme = (theme: AppSettings["theme"]) => setColorScheme(theme === "system" ? "auto" : theme);
  useEffect(() => {
    if (query.data) {
      setForm(query.data);
      applyTheme(query.data.theme);
    }
  }, [query.data]);
  const save = useMutation({
    mutationFn: api.saveSettings,
    onSuccess: (value) => {
      client.setQueryData(["settings"], value);
      applyTheme(value.theme);
      notifications.show({ color: "teal", message: "Settings saved" });
    },
  });
  const importArchive = useMutation({
    mutationFn: api.importArchive,
    onSuccess: async () => {
      await client.invalidateQueries();
      notifications.show({ color: "teal", title: "Import complete", message: "The previous database and attachments were retained as a backup." });
    },
    onError: (error: Error) => notifications.show({ color: "red", title: "Import rejected", message: error.message }),
  });
  const confirmImport = (file: File | null) => {
    if (!file) return;
    modals.openConfirmModal({
      title: "Replace the current Knowledge Base?",
      children: <Text size="sm">The archive will be fully validated first. A backup of the current database and attachments will be retained.</Text>,
      labels: { confirm: "Validate and replace", cancel: "Cancel" },
      confirmProps: { color: "orange" },
      onConfirm: () => importArchive.mutate(file),
    });
  };
  return (
    <Stack className="page-view" p="xl" gap="lg">
      <div><Title order={2}>Settings</Title><Text c="dimmed">Local storage, ingestion and portability.</Text></div>
      <Paper withBorder p="lg">
        <Stack>
          <Title order={4}>Appearance</Title>
          <SegmentedControl value={form.theme} onChange={(theme) => { const value = theme as AppSettings["theme"]; setForm({ ...form, theme: value }); applyTheme(value); }} data={[{ label: "System", value: "system" }, { label: "Light", value: "light" }, { label: "Dark", value: "dark" }]} />
        </Stack>
      </Paper>
      <Paper withBorder p="lg">
        <Stack>
          <Title order={4}>Structured Inbox</Title>
          <Text size="sm" c="dimmed">JSON submissions placed here are validated after they finish writing, then moved to processed or quarantine.</Text>
          <TextInput label="Inbox folder" value={form.inboxPath} onChange={(event) => setForm({ ...form, inboxPath: event.currentTarget.value })} />
          <NumberInput label="Rejected proposal retention" suffix=" days" min={1} max={365} value={form.rejectedRetentionDays} onChange={(value) => setForm({ ...form, rejectedRetentionDays: Number(value) || 30 })} />
          <Text size="xs">Submission schema: <a href="/api/inbox/schema" target="_blank">/api/inbox/schema</a></Text>
        </Stack>
      </Paper>
      <Paper withBorder p="lg">
        <Stack>
          <Group gap="xs"><IconArchive size={19} /><Title order={4}>Export and import</Title></Group>
          <Text size="sm" c="dimmed">Exports include the SQLite database, settings, attachments and a versioned manifest.</Text>
          <Group><Button component="a" href="/api/export" leftSection={<IconDownload size={16} />}>Export archive</Button><FileButton accept=".zip,application/zip" onChange={confirmImport}>{(props) => <Button {...props} variant="light" loading={importArchive.isPending} leftSection={<IconUpload size={16} />}>Import archive</Button>}</FileButton></Group>
        </Stack>
      </Paper>
      <Button style={{ alignSelf: "flex-start" }} leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} onClick={() => save.mutate(form)}>Save settings</Button>
    </Stack>
  );
}
