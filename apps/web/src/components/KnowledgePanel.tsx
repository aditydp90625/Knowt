import { useEffect, useMemo, useState } from "react";
import type { Category, KnowledgeNode, KnowledgeType, NodeWrite } from "@knowt/contracts";
import {
  Accordion,
  ActionIcon,
  Anchor,
  Badge,
  Box,
  Button,
  Divider,
  FileButton,
  Group,
  LoadingOverlay,
  Paper,
  ScrollArea,
  Select,
  Stack,
  TagsInput,
  Text,
  TextInput,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowBackUp, IconDeviceFloppy, IconEdit, IconPaperclip, IconPhotoPlus, IconTrash, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { api } from "../api/client";
import { knowledgeTypeColor } from "../knowledge-types";
import { MarkdownEditor } from "./MarkdownEditor";

interface DraftSeed {
  topicCategoryId: string;
  projectCategoryId: string;
  knowledgeTypeId: string;
  templateMarkdown: string;
}

interface Props {
  node?: KnowledgeNode | undefined;
  draft?: DraftSeed | undefined;
  categories: Category[];
  knowledgeTypes: KnowledgeType[];
  onSaved(node: KnowledgeNode): void;
  onClose(): void;
  onDeleted?(nodeId: string): void;
}

type FormValue = Omit<NodeWrite, "expectedVersion">;

function categoryOptions(categories: Category[], workspace: "topic" | "project") {
  const filtered = categories.filter((item) => item.workspace === workspace);
  const byId = new Map(filtered.map((item) => [item.id, item]));
  const label = (item: Category): string => {
    const names = [item.name];
    let parent = item.parentId ? byId.get(item.parentId) : undefined;
    while (parent) { names.unshift(parent.name); parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
    return names.join(" / ");
  };
  return filtered.map((item) => ({ value: item.id, label: label(item) })).sort((a, b) => a.label.localeCompare(b.label));
}

export function KnowledgePanel({ node, draft, categories, knowledgeTypes, onSaved, onClose, onDeleted }: Props) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(!node);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const initial = useMemo<FormValue>(() => node ? {
    title: node.title,
    contentMarkdown: node.contentMarkdown,
    knowledgeTypeId: node.knowledgeTypeId,
    topicCategoryId: node.topicCategoryId,
    projectCategoryId: node.projectCategoryId,
    tags: node.tags,
    sourceType: node.sourceType,
    sourceDetails: node.sourceDetails,
  } : {
    title: "",
    contentMarkdown: draft?.templateMarkdown ?? "",
    knowledgeTypeId: draft?.knowledgeTypeId ?? "reference",
    topicCategoryId: draft?.topicCategoryId ?? "",
    projectCategoryId: draft?.projectCategoryId ?? "",
    tags: [],
    sourceType: "Manual entry",
    sourceDetails: null,
  }, [draft, node]);
  const [form, setForm] = useState(initial);

  useEffect(() => {
    setForm(initial);
    setEditing(!node);
    setEditorGeneration((value) => value + 1);
  }, [initial, node?.id]);

  const save = useMutation({
    mutationFn: () => node
      ? api.updateNode(node.id, { ...form, expectedVersion: node.version })
      : api.createNode(form),
    onSuccess: async (saved) => {
      notifications.show({ color: "teal", message: node ? "Revision saved" : "Knowledge Node created" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["taxonomy"] }),
        ...(node ? [queryClient.invalidateQueries({ queryKey: ["revisions", node.id] })] : []),
      ]);
      setEditing(false);
      onSaved(saved);
    },
    onError: (error: Error) => notifications.show({ color: "red", title: "Could not save", message: error.message }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteNode(node!.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["taxonomy"] });
      notifications.show({ message: "Moved to Trash", color: "orange" });
      if (node) onDeleted?.(node.id);
    },
  });
  const attachmentQuery = useQuery({
    queryKey: ["attachments", node?.id], queryFn: () => api.attachments(node!.id), enabled: Boolean(node),
  });
  const revisionQuery = useQuery({
    queryKey: ["revisions", node?.id], queryFn: () => api.revisions(node!.id), enabled: Boolean(node),
  });
  const addAttachment = useMutation({
    mutationFn: (file: File) => api.addAttachment(node!.id, file),
    onSuccess: async (attachment) => {
      await queryClient.invalidateQueries({ queryKey: ["attachments", node?.id] });
      if (attachment.mediaType.startsWith("image/")) {
        setForm((current) => ({ ...current, contentMarkdown: `${current.contentMarkdown}\n\n![${attachment.originalName}](${attachment.url})` }));
        setEditorGeneration((value) => value + 1);
      }
    },
  });
  const restoreRevision = useMutation({
    mutationFn: (revisionId: string) => api.restoreRevision(node!.id, revisionId),
    onSuccess: async (saved) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["taxonomy"] }),
        queryClient.invalidateQueries({ queryKey: ["revisions", node?.id] }),
      ]);
      notifications.show({ color: "teal", message: "Revision restored as a new revision" });
      onSaved(saved);
    },
  });

  const topicOptions = categoryOptions(categories, "topic");
  const projectOptions = categoryOptions(categories, "project");
  const typeOptions = knowledgeTypes.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name }));
  const valid = form.title.trim() && form.contentMarkdown.trim() && form.topicCategoryId && form.projectCategoryId && form.knowledgeTypeId;

  return (
    <Paper className="knowledge-panel" radius={0}>
      <LoadingOverlay visible={save.isPending} />
      <Group className="panel-toolbar" justify="space-between" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" className="panel-heading">
          <ActionIcon variant="subtle" onClick={onClose} aria-label="Close node"><IconX size={18} /></ActionIcon>
          <Text fw={700} lineClamp={1}>{node?.title || "New Knowledge Node"}</Text>
          {node && <Badge variant="light" color="gray">v{node.version}</Badge>}
        </Group>
        <Group gap="xs" wrap="nowrap">
          {node && !editing && <Button size="xs" variant="light" leftSection={<IconEdit size={15} />} onClick={() => setEditing(true)}>Edit</Button>}
          {editing && node && <Button size="xs" variant="subtle" onClick={() => { setForm(initial); setEditorGeneration((value) => value + 1); setEditing(false); }}>Cancel</Button>}
          {editing && <Button size="xs" leftSection={<IconDeviceFloppy size={15} />} disabled={!valid} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}
        </Group>
      </Group>

      <ScrollArea className="panel-scroll" type="auto">
        {editing ? (
          <Stack p="md" gap="md">
            <TextInput label="Title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
            <Group grow align="start">
              <Select label="Knowledge Type" required data={typeOptions} value={form.knowledgeTypeId} onChange={(value) => value && setForm({ ...form, knowledgeTypeId: value })} />
              <TagsInput label="Tags" placeholder="Type and press Enter" value={form.tags} onChange={(tags) => setForm({ ...form, tags })} clearable />
            </Group>
            <Group grow align="start">
              <Select searchable label="Topic" required data={topicOptions} value={form.topicCategoryId} onChange={(value) => value && setForm({ ...form, topicCategoryId: value })} />
              <Select searchable label="Project" required data={projectOptions} value={form.projectCategoryId} onChange={(value) => value && setForm({ ...form, projectCategoryId: value })} />
            </Group>
            <Box>
              <Text size="sm" fw={500} mb={6}>Content <Text component="span" c="red">*</Text></Text>
              <MarkdownEditor value={form.contentMarkdown} resetKey={`${node?.id ?? "new"}-${editorGeneration}`} onChange={(contentMarkdown) => setForm((current) => ({ ...current, contentMarkdown }))} />
            </Box>
            <Accordion variant="separated">
              <Accordion.Item value="source">
                <Accordion.Control>Source</Accordion.Control>
                <Accordion.Panel>
                  <Stack>
                    <Select label="Source type" clearable data={["ChatGPT conversation", "Personal experiment", "Documentation", "Datasheet", "Application note", "Academic paper", "Colleague discussion", "Manual entry", "Other"]} value={form.sourceType} onChange={(sourceType) => setForm({ ...form, sourceType })} />
                    <Textarea label="Source details" autosize minRows={2} value={form.sourceDetails ?? ""} onChange={(event) => setForm({ ...form, sourceDetails: event.currentTarget.value || null })} />
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
            {node ? (
              <Box>
                <Group justify="space-between" mb="xs"><Text fw={600}>Attachments</Text><FileButton onChange={(file) => file && addAttachment.mutate(file)}>{(props) => <Button {...props} size="xs" variant="light" leftSection={<IconPhotoPlus size={15} />}>Add file</Button>}</FileButton></Group>
                <AttachmentList attachments={attachmentQuery.data ?? []} onDelete={(id) => void api.deleteAttachment(id).then(() => queryClient.invalidateQueries({ queryKey: ["attachments", node.id] }))} />
              </Box>
            ) : <Text size="xs" c="dimmed">Save the node once before adding attachments.</Text>}
          </Stack>
        ) : node ? (
          <Stack p="lg" gap="lg">
            <Box>
              <Text fz={25} fw={760} lh={1.2}>{node.title}</Text>
              <Group gap={6} mt="sm">
                <Badge variant="filled" color={knowledgeTypeColor(node.knowledgeType)}>{node.knowledgeType}</Badge>
                {node.tags.map((tag) => <Badge variant="outline" color="gray" key={tag}>{tag}</Badge>)}
              </Group>
              <Group gap="xs" mt="md" c="dimmed"><Text size="xs">Topic: {node.topicPath.map((item) => item.name).join(" / ")}</Text><Text size="xs">Project: {node.projectPath.map((item) => item.name).join(" / ")}</Text></Group>
            </Box>
            <Divider />
            <article className="markdown-reading"><ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeSanitize, rehypeKatex]}>{node.contentMarkdown}</ReactMarkdown></article>
            {(node.sourceType || node.sourceDetails) && <Paper withBorder p="sm"><Text size="xs" tt="uppercase" c="dimmed" fw={700}>Source</Text><Text size="sm" fw={600}>{node.sourceType}</Text><Text size="sm">{node.sourceDetails}</Text></Paper>}
            <Box>
              <Text fw={650} mb="xs">Attachments</Text>
              <AttachmentList attachments={attachmentQuery.data ?? []} />
            </Box>
            <Accordion variant="contained">
              <Accordion.Item value="history"><Accordion.Control>Revision history</Accordion.Control><Accordion.Panel>
                <Stack gap="xs">{revisionQuery.data?.map((revision) => <Group key={revision.id} justify="space-between"><Box><Text size="sm" fw={600}>Revision {revision.revisionNumber}</Text><Text size="xs" c="dimmed">{revision.reason} - {new Date(revision.createdAt).toLocaleString()}</Text></Box><Tooltip label="Restore as a new revision"><ActionIcon variant="subtle" onClick={() => restoreRevision.mutate(revision.id)}><IconArrowBackUp size={16} /></ActionIcon></Tooltip></Group>)}</Stack>
              </Accordion.Panel></Accordion.Item>
            </Accordion>
            <Button variant="subtle" color="red" size="xs" leftSection={<IconTrash size={15} />} onClick={() => remove.mutate()}>Move to Trash</Button>
          </Stack>
        ) : null}
      </ScrollArea>
    </Paper>
  );
}

function AttachmentList({ attachments, onDelete }: { attachments: Awaited<ReturnType<typeof api.attachments>>; onDelete?: (id: string) => void }) {
  if (!attachments.length) return <Text size="sm" c="dimmed">No attachments</Text>;
  return <Stack gap={5}>{attachments.map((attachment) => <Group key={attachment.id} justify="space-between"><Group gap="xs"><IconPaperclip size={15} /><Anchor href={attachment.url} target="_blank" size="sm">{attachment.originalName}</Anchor><Text size="xs" c="dimmed">{formatBytes(attachment.sizeBytes)}</Text></Group>{onDelete && <ActionIcon color="red" variant="subtle" size="sm" onClick={() => onDelete(attachment.id)}><IconTrash size={14} /></ActionIcon>}</Group>)}</Stack>;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
