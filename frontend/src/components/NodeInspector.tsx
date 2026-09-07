import type { KnowledgeNode } from "../types";

interface Props { node: KnowledgeNode; onEdit: () => void; onClose: () => void }

export function NodeInspector({ node, onEdit, onClose }: Props) {
  return (
    <aside className="inspector-panel">
      <div className="editor-header">
        <div><span className="type-pill">{node.knowledge_type}</span><h2>{node.title}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="inspector-content">
        <div className="path-row"><span>Topic</span>{node.topic_path.map((part) => part.name).join(" / ")}</div>
        <div className="path-row"><span>Project</span>{node.project_path.map((part) => part.name).join(" / ")}</div>
        {node.tags.length > 0 && <div className="tag-row">{node.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
        <article className="markdown-reading"><pre>{node.content_markdown}</pre></article>
        {node.source_type && <details><summary>Source / provenance</summary><p>{node.source_type}</p><p>{node.source_details}</p></details>}
      </div>
      <div className="editor-actions"><span /><button className="primary-button" onClick={onEdit}>Edit</button></div>
    </aside>
  );
}

