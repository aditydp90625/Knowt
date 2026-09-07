import type { KnowledgeNode, KnowledgeType, NodeWrite, Proposal, Taxonomy, Workspace } from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(body.detail || "Request failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  taxonomy: (workspace: Workspace) => request<Taxonomy>(`/taxonomy/${workspace}`),
  knowledgeTypes: () => request<KnowledgeType[]>("/knowledge-types"),
  createNode: (node: NodeWrite) => request<KnowledgeNode>("/nodes", { method: "POST", body: JSON.stringify(node) }),
  updateNode: (id: string, node: NodeWrite) => request<KnowledgeNode>(`/nodes/${id}`, { method: "PUT", body: JSON.stringify(node) }),
  trashNode: (id: string) => request<void>(`/nodes/${id}`, { method: "DELETE" }),
  trash: () => request<KnowledgeNode[]>("/trash"),
  restoreNode: (id: string) => request<KnowledgeNode>(`/nodes/${id}/restore`, { method: "POST" }),
  search: (query: string) => request<KnowledgeNode[]>(`/search?q=${encodeURIComponent(query)}`),
  proposals: () => request<Proposal[]>("/proposals"),
  approve: (id: string) => request<KnowledgeNode>(`/proposals/${id}/approve`, { method: "POST", body: "{}" }),
  reject: (id: string) => request<void>(`/proposals/${id}/reject`, { method: "POST" }),
  layout: (workspace: Workspace, rootId: string) => request<{ state: Record<string, unknown> }>(`/layout/${workspace}/${rootId}`),
  saveLayout: (workspace: Workspace, rootId: string, state: Record<string, unknown>) =>
    request<void>(`/layout/${workspace}/${rootId}`, { method: "PUT", body: JSON.stringify({ state }) }),
};

