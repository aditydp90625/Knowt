import { useEffect, useState } from "react";
import { defaultHotkeys, type AppSettings, type HotkeyAction } from "@knowt/contracts";
import { Button, FileButton, Group, Kbd, NumberInput, Paper, SegmentedControl, Stack, Text, TextInput, Title, useMantineColorScheme } from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import { IconArchive, IconDeviceFloppy, IconDownload, IconKeyboard, IconRefresh, IconUpload } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatForDisplay, useHotkeyRecorder, type Hotkey } from "@tanstack/react-hotkeys";
import { api } from "../api/client";

const hotkeyRows: Array<{ action: HotkeyAction; label: string; description: string }> = [
  { action: "search", label: "Search", description: "Focus the global search box" },
  { action: "newKnowledge", label: "New knowledge", description: "Create a node under the selected category or root" },
  { action: "openSelected", label: "Open selected", description: "Open all selected knowledge nodes" },
  { action: "deleteSelected", label: "Delete selected", description: "Delete the selected nodes and categories after confirmation" },
  { action: "expandAll", label: "Expand", description: "Expand categories, then reveal knowledge nodes" },
  { action: "collapseAll", label: "Collapse", description: "Hide knowledge nodes, then collapse to the root" },
  { action: "topicalWorkspace", label: "Topical workspace", description: "Open the topical knowledge map" },
  { action: "projectWorkspace", label: "Project workspace", description: "Open the project knowledge map" },
  { action: "reviewQueue", label: "Review Queue", description: "Open staged knowledge proposals" },
  { action: "settings", label: "Settings", description: "Open application settings" },
];

export function SettingsView() {
  const client = useQueryClient();
  const { setColorScheme } = useMantineColorScheme();
  const query = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const [form, setForm] = useState<AppSettings>({ theme: "system", inboxPath: "data/inbox", rejectedRetentionDays: 30, hotkeys: { ...defaultHotkeys } });
  const duplicateHotkeys = Object.values(form.hotkeys).filter((hotkey, index, all) => all.indexOf(hotkey) !== index);
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
          <Group justify="space-between">
            <Group gap="xs"><IconKeyboard size={19} /><Title order={4}>Keyboard shortcuts</Title></Group>
            <Button size="xs" variant="subtle" leftSection={<IconRefresh size={15} />} onClick={() => setForm((current) => ({ ...current, hotkeys: { ...defaultHotkeys } }))}>Reset defaults</Button>
          </Group>
          <Text size="sm" c="dimmed">Select a shortcut, then press the replacement key combination. Escape cancels recording.</Text>
          {hotkeyRows.map((row) => <HotkeyRow key={row.action} label={row.label} description={row.description} value={form.hotkeys[row.action]} onChange={(value) => setForm((current) => ({ ...current, hotkeys: { ...current.hotkeys, [row.action]: value } }))} />)}
          {duplicateHotkeys.length > 0 && <Text size="sm" c="red">Each action needs a unique shortcut. Resolve duplicate {formatForDisplay(duplicateHotkeys[0] as Hotkey)} assignments before saving.</Text>}
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
      <Button style={{ alignSelf: "flex-start" }} leftSection={<IconDeviceFloppy size={16} />} loading={save.isPending} disabled={duplicateHotkeys.length > 0} onClick={() => save.mutate(form)}>Save settings</Button>
    </Stack>
  );
}

function HotkeyRow({ label, description, value, onChange }: { label: string; description: string; value: string; onChange(value: string): void }) {
  const recorder = useHotkeyRecorder({ onRecord: (hotkey) => hotkey && onChange(hotkey), ignoreInputs: false });
  return <Group justify="space-between" wrap="nowrap">
    <div><Text size="sm" fw={600}>{label}</Text><Text size="xs" c="dimmed">{description}</Text></div>
    <Button variant={recorder.isRecording ? "filled" : "default"} {...(recorder.isRecording ? { color: "orange" } : {})} onClick={recorder.startRecording} miw={150}>
      {recorder.isRecording ? "Press shortcut…" : <Kbd>{formatForDisplay(value as Hotkey)}</Kbd>}
    </Button>
  </Group>;
}
