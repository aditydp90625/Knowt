import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { api } from "./api";
import { NodeEditor } from "./components/NodeEditor";
import { NodeInspector } from "./components/NodeInspector";
import { TreeCanvas } from "./components/TreeCanvas";
import type { KnowledgeNode, KnowledgeType, NodeWrite, Proposal, Taxonomy, Workspace } from "./types";
import "./styles.css";

type View = "knowledge" | "search" | "review" | "trash";

function HighlightedExcerpt({ value }: { value: string }) {
  const parts = value.split(/(<mark>|<\/mark>)/);
  let highlighted = false;
  return <p>{parts.map((part, index) => {
    if (part === "<mark>") { highlighted = true; return null; }
    if (part === "</mark>") { highlighted = false; return null; }
    return highlighted ? <mark key={index}>{part}</mark> : <span key={index}>{part}</span>;
  })}</p>;
}

function App() {
  const [workspace, setWorkspace] = useState<Workspace>("topic");
  const [view, setView] = useState<View>("knowledge");
  const [topics, setTopics] = useState<Taxonomy>({ categories: [], nodes: [] });
  const [projects, setProjects] = useState<Taxonomy>({ categories: [], nodes: [] });
  const [types, setTypes] = useState<KnowledgeType[]>([]);
  const [selected, setSelected] = useState<KnowledgeNode | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeNode[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [trash, setTrash] = useState<KnowledgeNode[]>([]);
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const [topicData, projectData, typeData] = await Promise.all([
      api.taxonomy("topic"), api.taxonomy("project"), api.knowledgeTypes(),
    ]);
    setTopics(topicData); setProjects(projectData); setTypes(typeData);
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (view === "review") void api.proposals().then(setProposals);
    if (view === "trash") void api.trash().then(setTrash);
  }, [view]);

  const save = async (value: NodeWrite) => {
    const saved = selected && editing ? await api.updateNode(selected.id, value) : await api.createNode(value);
    setSelected(saved); setEditing(false); setCreating(false); setNotice("Revision saved");
    await refresh();
    window.setTimeout(() => setNotice(""), 2500);
  };

  const deleteSelected = async () => {
    if (!selected) return;
    await api.trashNode(selected.id);
    setSelected(null); setEditing(false); await refresh(); setNotice("Moved to Trash");
  };

  const doSearch = async () => {
    if (query.trim()) setResults(await api.search(query.trim()));
  };

  const openSearchResult = (node: KnowledgeNode) => {
    setSelected(node); setView("knowledge"); setWorkspace("topic");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">K</span><div><strong>Knowt</strong><small>Engineering knowledge</small></div></div>
        <nav aria-label="Primary navigation">
          <button className={view === "knowledge" ? "active" : ""} onClick={() => setView("knowledge")}>Knowledge</button>
          <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>Search</button>
          <button className={view === "review" ? "active" : ""} onClick={() => setView("review")}>Review</button>
          <button className={view === "trash" ? "active" : ""} onClick={() => setView("trash")}>Trash</button>
        </nav>
        <button className="new-button" onClick={() => { setSelected(null); setCreating(true); setEditing(false); }}>+ New knowledge</button>
      </header>

      {view === "knowledge" && (
        <div className="knowledge-view">
          <div className="workspace-switcher">
            <button className={workspace === "topic" ? "active" : ""} onClick={() => setWorkspace("topic")}>Topical</button>
            <button className={workspace === "project" ? "active" : ""} onClick={() => setWorkspace("project")}>Project</button>
          </div>
          <TreeCanvas workspace={workspace} taxonomy={workspace === "topic" ? topics : projects} selected={selected} onSelect={(node) => { setSelected(node); setEditing(false); }} />
        </div>
      )}

      {view === "search" && (
        <section className="page-view">
          <div className="page-heading"><span className="eyebrow">Global retrieval</span><h1>Search the whole knowledge base</h1><p>Exact title matches lead, followed by title, content, and tag matches.</p></div>
          <form className="search-box" onSubmit={(e) => { e.preventDefault(); void doSearch(); }}><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search titles, content and tags…" /><button className="primary-button">Search</button></form>
          <div className="result-list">{results.map((node) => <button className="result-card" key={node.id} onClick={() => openSearchResult(node)}><span className="type-pill">{node.knowledge_type}</span><h3>{node.title}</h3><HighlightedExcerpt value={node.excerpt ?? ""} /><small>{node.topic_path.map((part) => part.name).join(" / ")}</small></button>)}</div>
        </section>
      )}

      {view === "review" && (
        <section className="page-view">
          <div className="page-heading"><span className="eyebrow">Suggest → Review → Commit</span><h1>Review queue</h1><p>External submissions remain staged until you explicitly approve them.</p></div>
          <div className="review-list">{proposals.length === 0 && <div className="empty-state"><strong>Queue clear</strong><p>No proposals are waiting for review.</p></div>}{proposals.map((proposal) => <article className="review-card" key={proposal.id}><div><span className="type-pill">{proposal.payload.knowledge_type}</span><h2>{proposal.payload.title}</h2><p>{proposal.payload.content_markdown}</p><small>{proposal.topic_path.map((part) => part.name).join(" / ")} · {proposal.project_path.map((part) => part.name).join(" / ")}</small></div><div className="review-actions"><button onClick={async () => { await api.reject(proposal.id); setProposals(await api.proposals()); }}>Reject</button><button className="primary-button" onClick={async () => { await api.approve(proposal.id); setProposals(await api.proposals()); await refresh(); }}>Approve</button></div></article>)}</div>
        </section>
      )}

      {view === "trash" && (
        <section className="page-view">
          <div className="page-heading"><span className="eyebrow">Recovery</span><h1>Trash</h1><p>Deleted knowledge stays recoverable until permanently removed.</p></div>
          <div className="result-list">{trash.length === 0 && <div className="empty-state"><strong>Trash is empty</strong></div>}{trash.map((node) => <article className="result-card" key={node.id}><span className="type-pill">{node.knowledge_type}</span><h3>{node.title}</h3><p>Deleted {node.deleted_at && new Date(node.deleted_at).toLocaleString()}</p><button className="primary-button" onClick={async () => { await api.restoreNode(node.id); setTrash(await api.trash()); await refresh(); }}>Restore</button></article>)}</div>
        </section>
      )}

      {selected && !editing && !creating && <NodeInspector node={selected} onEdit={() => setEditing(true)} onClose={() => setSelected(null)} />}
      {(creating || editing) && <NodeEditor node={editing ? selected : null} types={types} topics={topics.categories} projects={projects.categories} onSave={save} onClose={() => { setCreating(false); setEditing(false); }} onDelete={editing ? deleteSelected : undefined} />}
      {notice && <div className="toast">{notice}</div>}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
