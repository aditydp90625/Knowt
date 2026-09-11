import { useEffect, useMemo, useState } from "react";
import type { Category, KnowledgeType, NodeWrite, Proposal } from "@knowt/contracts";
import { Alert, Badge, Box, Button, Group, Paper, ScrollArea, Select, Stack, TagsInput, Text, TextInput, Title } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlertTriangle, IconCheck, IconChecks, IconFolderPlus, IconInbox, IconX } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { knowledgeTypeClass, knowledgeTypeColor } from "../knowledge-types";
import { MarkdownEditor } from "./MarkdownEditor";

interface Props {
  categories: Category[];
  knowledgeTypes: KnowledgeType[];
}

function options(categories: Category[], workspace: "topic" | "project") {
  const items = categories.filter((item) => item.workspace === workspace);
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.map((item) => {
    const names = [item.name];
    let parent = item.parentId ? byId.get(item.parentId) : undefined;
    while (parent) { names.unshift(parent.name); parent = parent.parentId ? byId.get(parent.parentId) : undefined; }
    return { value: item.id, label: names.join(" / ") };
  }).sort((a, b) => a.label.localeCompare(b.label));
}

const normalizePathPart = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");

function pathsMatch(actual: Array<{ name: string }>, requested: string[]): boolean {
  return actual.length === requested.length && actual.every((part, index) => normalizePathPart(part.name) === normalizePathPart(requested[index]!));
}

function categoryPath(categories: Category[], id: string): Array<{ name: string }> {
  const byId = new Map(categories.map((item) => [item.id, item]));
  const result: Array<{ name: string }> = [];
  let current = byId.get(id);
  while (current) {
    result.unshift({ name: current.name });
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}

async function createMissingProjectPath(categories: Category[], path: string[]): Promise<Category> {
  const known = categories.filter((item) => item.workspace === "project");
  let parentId: string | null = null;
  let current: Category | undefined;
  for (const segment of path) {
    current = known.find((item) => item.parentId === parentId && normalizePathPart(item.name) === normalizePathPart(segment));
    if (!current) {
      current = await api.createCategory({ workspace: "project", parentId, name: segment });
      known.push(current);
    }
    parentId = current.id;
  }
  if (!current) throw new Error("The requested project path is empty");
  return current;
}

export function ReviewQueue({ categories, knowledgeTypes }: Props) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["proposals", "pending"], queryFn: () => api.proposals("pending") });
  const [selectedId, setSelectedId] = useState<string>();
  const selected = query.data?.find((item) => item.id === selectedId) ?? query.data?.[0];
  useEffect(() => { if (!selectedId && query.data?.[0]) setSelectedId(query.data[0].id); }, [query.data, selectedId]);
  const refresh = async () => {
    await Promise.all([client.invalidateQueries({ queryKey: ["proposals"] }), client.invalidateQueries({ queryKey: ["taxonomy"] })]);
  };
  const approveAll = useMutation({
    mutationFn: ({ submissionId, proposalId, node }: { submissionId: string; proposalId: string; node: NodeWrite }) =>
      api.approveSubmission(submissionId, { [proposalId]: node }),
    onSuccess: async () => { await refresh(); notifications.show({ color: "teal", message: "All clean proposals approved" }); },
  });
  const submissionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of query.data ?? []) counts.set(item.submissionId, (counts.get(item.submissionId) ?? 0) + 1);
    return counts;
  }, [query.data]);
  return (
    <div className="review-layout">
      <aside className="review-list">
        <Group p="md" justify="space-between"><div><Title order={3}>Review Queue</Title><Text size="sm" c="dimmed">Staged, never canonical until approved</Text></div><Badge size="lg" variant="light">{query.data?.length ?? 0}</Badge></Group>
        <ScrollArea className="review-list-scroll">
          {query.data?.length === 0 && <Stack align="center" p="xl"><IconInbox size={36} color="var(--mantine-color-dimmed)" /><Text c="dimmed" ta="center">No proposals are waiting for review.</Text></Stack>}
          {query.data?.map((proposal) => <button key={proposal.id} className={`proposal-list-item ${knowledgeTypeClass(proposal.payload.knowledgeType)}${proposal.id === selected?.id ? " active" : ""}`} onClick={() => setSelectedId(proposal.id)}><Text fw={650} size="sm" ta="left" lineClamp={2}>{proposal.payload.title}</Text><Group gap={5} mt={5}><Badge size="xs" variant="filled" color={knowledgeTypeColor(proposal.payload.knowledgeType)}>{proposal.payload.knowledgeType}</Badge><Text size="xs" c="dimmed">{proposal.source.system}</Text></Group></button>)}
        </ScrollArea>
      </aside>
      <main className="review-detail">
        {selected ? <ProposalEditor key={selected.id} proposal={selected} categories={categories} knowledgeTypes={knowledgeTypes} onFinished={refresh} onApproveAll={(node) => approveAll.mutate({ submissionId: selected.submissionId, proposalId: selected.id, node })} approveAllPending={approveAll.isPending} siblingCount={submissionCounts.get(selected.submissionId) ?? 1} /> : <Stack h="100%" justify="center" align="center"><Text c="dimmed">Select a proposal to review.</Text></Stack>}
      </main>
    </div>
  );
}

function ProposalEditor({ proposal, categories, knowledgeTypes, onFinished, onApproveAll, approveAllPending, siblingCount }: Props & { proposal: Proposal; onFinished(): Promise<void>; onApproveAll(node: NodeWrite): void; approveAllPending: boolean; siblingCount: number }) {
  const client = useQueryClient();
  const type = knowledgeTypes.find((item) => item.name === proposal.payload.knowledgeType);
  const [form, setForm] = useState<NodeWrite>({
    title: proposal.payload.title,
    contentMarkdown: proposal.payload.contentMarkdown,
    knowledgeTypeId: type?.id ?? "reference",
    topicCategoryId: proposal.topicCategoryId ?? categories.find((item) => item.workspace === "topic" && item.protected)?.id ?? "",
    projectCategoryId: proposal.projectCategoryId ?? categories.find((item) => item.workspace === "project" && item.protected)?.id ?? "",
    tags: proposal.payload.tags,
    sourceType: "ChatGPT conversation",
    sourceDetails: proposal.source.conversationTitle ?? `${proposal.source.system} submission`,
  });
  const approve = useMutation({
    mutationFn: () => api.approveProposal(proposal.id, form),
    onSuccess: async () => { await onFinished(); notifications.show({ color: "teal", message: "Proposal committed to the Knowledge Base" }); },
  });
  const requestedProjectPath = proposal.payload.project.pathHint;
  const projectPathMissing = !pathsMatch(categoryPath(categories, form.projectCategoryId), requestedProjectPath);
  const createProject = useMutation({
    mutationFn: () => createMissingProjectPath(categories, requestedProjectPath),
    onSuccess: async (category) => {
      setForm((current) => ({ ...current, projectCategoryId: category.id }));
      await client.invalidateQueries({ queryKey: ["taxonomy"] });
      notifications.show({ color: "teal", message: `Created project path ${requestedProjectPath.join(" / ")}` });
    },
    onError: (error: Error) => notifications.show({ color: "red", title: "Project not created", message: error.message }),
  });
  const reject = useMutation({ mutationFn: () => api.rejectProposal(proposal.id), onSuccess: onFinished });
  return (
    <Stack p="lg" gap="md" className="proposal-editor">
      <Group justify="space-between"><Box><Text size="xs" tt="uppercase" c="dimmed" fw={700}>From {proposal.source.system}</Text><Text size="sm">{proposal.source.conversationTitle}</Text></Box><Group>{siblingCount > 1 && <Button variant="light" leftSection={<IconChecks size={16} />} loading={approveAllPending} onClick={() => onApproveAll(form)}>Approve all {siblingCount}</Button>}<Button color="red" variant="subtle" leftSection={<IconX size={16} />} onClick={() => reject.mutate()}>Reject</Button><Button leftSection={<IconCheck size={16} />} loading={approve.isPending} onClick={() => approve.mutate()}>Approve</Button></Group></Group>
      {projectPathMissing && <Alert color="orange" icon={<IconAlertTriangle size={18} />} title="Requested project path does not exist">
        <Stack gap="sm">
          <Text size="sm">The submission requested <b>{requestedProjectPath.join(" / ")}</b>. Choose an existing project below or create the missing path.</Text>
          <Button style={{ alignSelf: "flex-start" }} size="xs" variant="light" color="orange" leftSection={<IconFolderPlus size={15} />} loading={createProject.isPending} onClick={() => createProject.mutate()}>Create project path</Button>
        </Stack>
      </Alert>}
      <Paper withBorder p="md"><Stack>
        <TextInput label="Title" required value={form.title} onChange={(event) => setForm({ ...form, title: event.currentTarget.value })} />
        <Group grow align="start">
          <Select label="Knowledge Type" data={knowledgeTypes.filter((item) => item.enabled).map((item) => ({ value: item.id, label: item.name }))} value={form.knowledgeTypeId} onChange={(value) => value && setForm({ ...form, knowledgeTypeId: value })} />
          <TagsInput label="Tags" value={form.tags} onChange={(tags) => setForm({ ...form, tags })} />
        </Group>
        <Group grow align="start">
          <Select searchable label="Topic" data={options(categories, "topic")} value={form.topicCategoryId} onChange={(value) => value && setForm({ ...form, topicCategoryId: value })} />
          <Select searchable label="Project" data={options(categories, "project")} value={form.projectCategoryId} onChange={(value) => value && setForm({ ...form, projectCategoryId: value })} />
        </Group>
        <Box><Text size="sm" fw={500} mb={6}>Content</Text><MarkdownEditor value={form.contentMarkdown} resetKey={proposal.id} onChange={(contentMarkdown) => setForm((current) => ({ ...current, contentMarkdown }))} /></Box>
      </Stack></Paper>
    </Stack>
  );
}
