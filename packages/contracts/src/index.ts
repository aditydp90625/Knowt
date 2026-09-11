import { z } from "zod";

export const workspaceSchema = z.enum(["topic", "project"]);
export type Workspace = z.infer<typeof workspaceSchema>;

export const categorySchema = z.object({
  id: z.string().uuid(),
  workspace: workspaceSchema,
  parentId: z.string().uuid().nullable(),
  name: z.string(),
  protected: z.boolean(),
  directNodeCount: z.number().int().nonnegative(),
  descendantNodeCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Category = z.infer<typeof categorySchema>;

export const pathPartSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type PathPart = z.infer<typeof pathPartSchema>;

export const knowledgeTypeSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  sortOrder: z.number().int(),
  templateMarkdown: z.string(),
});
export type KnowledgeType = z.infer<typeof knowledgeTypeSchema>;

export const nodeWriteSchema = z.object({
  title: z.string().trim().min(1).max(240),
  contentMarkdown: z.string().trim().min(1),
  knowledgeTypeId: z.string().min(1),
  topicCategoryId: z.string().uuid(),
  projectCategoryId: z.string().uuid(),
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  sourceType: z.string().trim().max(120).nullable().default(null),
  sourceDetails: z.string().trim().max(2_000).nullable().default(null),
  expectedVersion: z.number().int().positive().optional(),
});
export type NodeWrite = z.infer<typeof nodeWriteSchema>;

export const knowledgeNodeSchema = nodeWriteSchema.omit({ expectedVersion: true }).extend({
  id: z.string().uuid(),
  knowledgeType: z.string(),
  topicPath: z.array(pathPartSchema),
  projectPath: z.array(pathPartSchema),
  version: z.number().int().positive(),
  createdAt: z.string(),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type KnowledgeNode = z.infer<typeof knowledgeNodeSchema>;

export const categoryCreateSchema = z.object({
  workspace: workspaceSchema,
  parentId: z.string().uuid().nullable().default(null),
  name: z.string().trim().min(1).max(120),
});

export const categoryRenameSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const categoryMoveSchema = z.object({
  parentId: z.string().uuid().nullable(),
});

export const nodeMoveSchema = z.object({
  workspace: workspaceSchema,
  categoryId: z.string().uuid(),
  expectedVersion: z.number().int().positive().optional(),
});

export const layoutStateSchema = z.object({
  viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number().positive() }),
  expandedCategoryIds: z.array(z.string().uuid()),
  positions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
});
export type LayoutState = z.infer<typeof layoutStateSchema>;

export const revisionSummarySchema = z.object({
  id: z.string().uuid(),
  nodeId: z.string().uuid(),
  revisionNumber: z.number().int().positive(),
  reason: z.string(),
  createdAt: z.string(),
});
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;

export interface Taxonomy {
  categories: Category[];
  nodes: KnowledgeNode[];
}

export interface NodeSearchResult extends KnowledgeNode {
  kind: "node";
  excerpt: string;
}

export interface CategorySearchResult {
  kind: "category";
  id: string;
  name: string;
  workspace: Workspace;
  path: PathPart[];
  directNodeCount: number;
  descendantNodeCount: number;
}

export type SearchResult = NodeSearchResult | CategorySearchResult;

export interface CategoryDeletionPreview {
  category: Category;
  destination: PathPart;
  childCategoryCount: number;
  directNodeCount: number;
  hasNameConflicts: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  details?: unknown;
}

export const sourceTypeSchema = z.enum([
  "ChatGPT conversation",
  "Personal experiment",
  "Documentation",
  "Datasheet",
  "Application note",
  "Academic paper",
  "Colleague discussion",
  "Manual entry",
  "Other",
]);

const rawPathHintSchema = z.object({
  path_hint: z.array(z.string().trim().min(1).max(120)).min(1),
  origin: z.enum(["llm", "user"]),
});

export const pathHintSchema = rawPathHintSchema.transform((value) => ({
  pathHint: value.path_hint,
  origin: value.origin,
}));

const rawProposalNodeInputSchema = z.object({
  client_node_id: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  knowledge_type: z.enum(["Reference", "Practice", "Debug", "Result"]),
  content_markdown: z.string().trim().min(1),
  topic: rawPathHintSchema,
  project: rawPathHintSchema,
  tags: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
});

export const proposalNodeInputSchema = rawProposalNodeInputSchema.transform((value) => ({
  clientNodeId: value.client_node_id,
  title: value.title,
  knowledgeType: value.knowledge_type,
  contentMarkdown: value.content_markdown,
  topic: { pathHint: value.topic.path_hint, origin: value.topic.origin },
  project: { pathHint: value.project.path_hint, origin: value.project.origin },
  tags: value.tags,
}));

export const inboxSubmissionInputSchema = z.object({
  schema_version: z.literal("1.0"),
  submission_id: z.string().trim().min(1).max(120),
  source: z.object({
    system: z.string().trim().min(1).max(120),
    created_at: z.iso.datetime(),
    conversation_title: z.string().trim().max(240).optional(),
  }),
  nodes: z.array(rawProposalNodeInputSchema).min(1).max(100),
});

export const inboxSubmissionSchema = inboxSubmissionInputSchema.transform((value) => ({
  schemaVersion: value.schema_version,
  submissionId: value.submission_id,
  source: {
    system: value.source.system,
    createdAt: value.source.created_at,
    ...(value.source.conversation_title === undefined ? {} : { conversationTitle: value.source.conversation_title }),
  },
  nodes: value.nodes.map((node) => ({
    clientNodeId: node.client_node_id,
    title: node.title,
    knowledgeType: node.knowledge_type,
    contentMarkdown: node.content_markdown,
    topic: { pathHint: node.topic.path_hint, origin: node.topic.origin },
    project: { pathHint: node.project.path_hint, origin: node.project.origin },
    tags: node.tags,
  })),
}));
export type InboxSubmissionInput = z.input<typeof inboxSubmissionInputSchema>;
export type InboxSubmission = z.infer<typeof inboxSubmissionSchema>;

export const proposalDecisionSchema = z.object({
  node: nodeWriteSchema.omit({ expectedVersion: true }).optional(),
});

export const proposalBatchDecisionSchema = z.object({
  nodes: z.record(z.string().uuid(), nodeWriteSchema.omit({ expectedVersion: true })).default({}),
});

export interface Proposal {
  id: string;
  submissionId: string;
  clientNodeId: string;
  status: "pending" | "approved" | "rejected";
  payload: z.infer<typeof proposalNodeInputSchema>;
  source: InboxSubmission["source"];
  topicCategoryId: string | null;
  projectCategoryId: string | null;
  topicPath: PathPart[];
  projectPath: PathPart[];
  canonicalNodeId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface Attachment {
  id: string;
  nodeId: string;
  originalName: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  url: string;
  createdAt: string;
  deletedAt: string | null;
}

export interface AppSettings {
  theme: "light" | "dark" | "system";
  inboxPath: string;
  rejectedRetentionDays: number;
}
