import type {
  AppSettings,
  Attachment,
  Category,
  CategoryDeletionPreview,
  KnowledgeNode,
  KnowledgeType,
  LayoutState,
  NodeWrite,
  Proposal,
  RevisionSummary,
  SearchResult,
  Taxonomy,
  Workspace,
} from "@knowt/contracts";

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText })) as { message?: string; details?: unknown };
    throw new ApiError(response.status, body.message ?? "Request failed", body.details);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  taxonomy: (workspace: Workspace) => request<Taxonomy>(`/taxonomy/${workspace}`),
  knowledgeTypes: () => request<KnowledgeType[]>("/knowledge-types"),
  createCategory: (input: { workspace: Workspace; parentId: string | null; name: string }) =>
    request<Category>("/categories", { method: "POST", body: JSON.stringify(input) }),
  renameCategory: (id: string, name: string) => request<Category>(`/categories/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  moveCategory: (id: string, parentId: string | null) => request<Category>(`/categories/${id}/move`, { method: "POST", body: JSON.stringify({ parentId }) }),
  createParent: (input: { workspace: Workspace; categoryIds: string[]; nodeIds: string[]; name: string }) =>
    request<Category>("/categories/create-parent", { method: "POST", body: JSON.stringify(input) }),
  deletionPreview: (id: string) => request<CategoryDeletionPreview>(`/categories/${id}/deletion-preview`),
  deleteCategory: (id: string) => request<void>(`/categories/${id}`, { method: "DELETE" }),
  node: (id: string) => request<KnowledgeNode>(`/nodes/${id}`),
  createNode: (input: NodeWrite) => request<KnowledgeNode>("/nodes", { method: "POST", body: JSON.stringify(input) }),
  updateNode: (id: string, input: NodeWrite) => request<KnowledgeNode>(`/nodes/${id}`, { method: "PUT", body: JSON.stringify(input) }),
  moveNode: (id: string, workspace: Workspace, categoryId: string, expectedVersion: number) =>
    request<KnowledgeNode>(`/nodes/${id}/move`, { method: "POST", body: JSON.stringify({ workspace, categoryId, expectedVersion }) }),
  deleteNode: (id: string) => request<void>(`/nodes/${id}`, { method: "DELETE" }),
  trash: () => request<KnowledgeNode[]>("/trash"),
  restoreNode: (id: string) => request<KnowledgeNode>(`/nodes/${id}/restore`, { method: "POST" }),
  permanentlyDeleteNode: (id: string) => request<void>(`/nodes/${id}/permanent`, { method: "DELETE" }),
  revisions: (id: string) => request<RevisionSummary[]>(`/nodes/${id}/revisions`),
  restoreRevision: (nodeId: string, revisionId: string) => request<KnowledgeNode>(`/nodes/${nodeId}/revisions/${revisionId}/restore`, { method: "POST" }),
  search: (q: string) => request<SearchResult[]>(`/search?q=${encodeURIComponent(q)}`),
  layout: (workspace: Workspace, rootId: string) => request<LayoutState | null>(`/layout/${workspace}/${rootId}`),
  saveLayout: (workspace: Workspace, rootId: string, state: LayoutState) =>
    request<LayoutState>(`/layout/${workspace}/${rootId}`, { method: "PUT", body: JSON.stringify(state) }),
  attachments: (nodeId: string) => request<Attachment[]>(`/nodes/${nodeId}/attachments`),
  addAttachment: (nodeId: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Attachment>(`/nodes/${nodeId}/attachments`, { method: "POST", body });
  },
  deleteAttachment: (id: string) => request<void>(`/attachments/${id}`, { method: "DELETE" }),
  proposals: (status: Proposal["status"] = "pending") => request<Proposal[]>(`/proposals?status=${status}`),
  approveProposal: (id: string, node?: NodeWrite) => request<Proposal>(`/proposals/${id}/approve`, { method: "POST", body: JSON.stringify(node ? { node } : {}) }),
  approveSubmission: (id: string, nodes: Record<string, NodeWrite> = {}) => request<Proposal[]>(`/submissions/${id}/approve-all`, {
    method: "POST", body: JSON.stringify({ nodes }),
  }),
  rejectProposal: (id: string) => request<Proposal>(`/proposals/${id}/reject`, { method: "POST" }),
  settings: () => request<AppSettings>("/settings"),
  saveSettings: (settings: AppSettings) => request<AppSettings>("/settings", { method: "PUT", body: JSON.stringify(settings) }),
  importArchive: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<{ backupPath: string }>("/import", { method: "POST", body });
  },
};
