export type Workspace = "topic" | "project";

export interface Category {
  id: string;
  workspace: Workspace;
  parent_id: string | null;
  name: string;
  protected: number;
  direct_node_count: number;
}

export interface PathPart { id: string; name: string }

export interface KnowledgeNode {
  id: string;
  title: string;
  content_markdown: string;
  knowledge_type_id: string;
  knowledge_type: string;
  topic_category_id: string;
  project_category_id: string;
  topic_path: PathPart[];
  project_path: PathPart[];
  tags: string[];
  source_type?: string;
  source_details?: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  excerpt?: string;
}

export interface KnowledgeType {
  id: string;
  name: string;
  description: string;
  enabled: number;
  template_markdown: string;
}

export interface Taxonomy { categories: Category[]; nodes: KnowledgeNode[] }

export interface Proposal {
  id: string;
  payload: {
    title: string;
    content_markdown: string;
    knowledge_type: string;
    tags: string[];
  };
  source: { system: string; conversation_title?: string };
  topic_path: PathPart[];
  project_path: PathPart[];
}

export interface NodeWrite {
  title: string;
  content_markdown: string;
  knowledge_type_id: string;
  topic_category_id: string;
  project_category_id: string;
  tags: string[];
  source_type?: string | null;
  source_details?: string | null;
}

