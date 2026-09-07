import { useEffect, useRef, useState } from "react";
import type { Category, KnowledgeNode, KnowledgeType, NodeWrite } from "../types";

interface Props {
  node: KnowledgeNode | null;
  types: KnowledgeType[];
  topics: Category[];
  projects: Category[];
  onSave: (value: NodeWrite) => Promise<void>;
  onClose: () => void;
  onDelete?: () => Promise<void>;
}

function pathLabel(category: Category, categories: Category[]): string {
  const map = new Map(categories.map((item) => [item.id, item]));
  const path = [category.name];
  let parent = category.parent_id ? map.get(category.parent_id) : undefined;
  while (parent) {
    path.unshift(parent.name);
    parent = parent.parent_id ? map.get(parent.parent_id) : undefined;
  }
  return path.join(" / ");
}

export function NodeEditor({ node, types, topics, projects, onSave, onClose, onDelete }: Props) {
  const [form, setForm] = useState<NodeWrite>({
    title: "", content_markdown: "", knowledge_type_id: types[0]?.id ?? "",
    topic_category_id: topics[0]?.id ?? "", project_category_id: projects[0]?.id ?? "", tags: [],
  });
  const [tagText, setTagText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setForm(node ? {
      title: node.title, content_markdown: node.content_markdown,
      knowledge_type_id: node.knowledge_type_id, topic_category_id: node.topic_category_id,
      project_category_id: node.project_category_id, tags: node.tags,
      source_type: node.source_type, source_details: node.source_details,
    } : {
      title: "", content_markdown: "", knowledge_type_id: types[0]?.id ?? "",
      topic_category_id: topics[0]?.id ?? "", project_category_id: projects[0]?.id ?? "", tags: [],
    });
    setTagText(node?.tags.join(", ") ?? "");
  }, [node, types, topics, projects]);

  const wrap = (before: string, after = before) => {
    const element = contentRef.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = form.content_markdown.slice(start, end) || "text";
    const value = `${form.content_markdown.slice(0, start)}${before}${selected}${after}${form.content_markdown.slice(end)}`;
    setForm({ ...form, content_markdown: value });
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  };

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onSave({ ...form, tags: tagText.split(",").map((tag) => tag.trim()).filter(Boolean) });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this node");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="editor-panel" aria-label="Knowledge node editor">
      <div className="editor-header">
        <div><span className="eyebrow">{node ? "Edit node" : "New knowledge"}</span><h2>{node ? node.title : "Capture an idea"}</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="editor-scroll">
        <label>Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Concise, directly descriptive title" /></label>
        <div className="metadata-grid">
          <label>Knowledge type<select value={form.knowledge_type_id} onChange={(e) => setForm({ ...form, knowledge_type_id: e.target.value })}>{types.map((type) => <option value={type.id} key={type.id}>{type.name}</option>)}</select></label>
          <label>Tags<input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="AXI, DMA" /></label>
        </div>
        <label>Topic<select value={form.topic_category_id} onChange={(e) => setForm({ ...form, topic_category_id: e.target.value })}>{topics.map((category) => <option value={category.id} key={category.id}>{pathLabel(category, topics)}</option>)}</select></label>
        <label>Project<select value={form.project_category_id} onChange={(e) => setForm({ ...form, project_category_id: e.target.value })}>{projects.map((category) => <option value={category.id} key={category.id}>{pathLabel(category, projects)}</option>)}</select></label>
        <label>Content</label>
        <div className="editor-toolbar" aria-label="Formatting toolbar">
          <button type="button" onClick={() => wrap("**")}>Bold</button>
          <button type="button" onClick={() => wrap("`")}>Code</button>
          <button type="button" onClick={() => wrap("## ", "")}>Heading</button>
          <button type="button" onClick={() => wrap("- ", "")}>List</button>
          <button type="button" onClick={() => wrap("[", "](https://)")}>Link</button>
        </div>
        <textarea ref={contentRef} className="content-editor" value={form.content_markdown} onChange={(e) => setForm({ ...form, content_markdown: e.target.value })} placeholder="Record the reusable knowledge, context, constraints, and examples…" />
        <details>
          <summary>Source / provenance</summary>
          <label>Source type<input value={form.source_type ?? ""} onChange={(e) => setForm({ ...form, source_type: e.target.value })} placeholder="Documentation, experiment, manual entry…" /></label>
          <label>Details<textarea className="source-editor" value={form.source_details ?? ""} onChange={(e) => setForm({ ...form, source_details: e.target.value })} /></label>
        </details>
        {error && <p className="error-message">{error}</p>}
      </div>
      <div className="editor-actions">
        {node && onDelete && <button className="danger-button" onClick={() => void onDelete()}>Move to Trash</button>}
        <span />
        <button onClick={onClose}>Cancel</button>
        <button className="primary-button" disabled={busy || !form.title.trim() || !form.content_markdown.trim()} onClick={() => void submit()}>{busy ? "Saving…" : "Save revision"}</button>
      </div>
    </aside>
  );
}

