import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { layoutTree } from "../layout";
import type { KnowledgeNode, Taxonomy, Workspace } from "../types";

interface Props {
  workspace: Workspace;
  taxonomy: Taxonomy;
  selected: KnowledgeNode | null;
  onSelect: (node: KnowledgeNode) => void;
}

interface Viewport { x: number; y: number; zoom: number }

export function TreeCanvas({ workspace, taxonomy, selected, onSelect }: Props) {
  const roots = taxonomy.categories.filter((category) => category.parent_id === null);
  const [rootId, setRootId] = useState(roots[0]?.id ?? "");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 65, zoom: 1 });
  const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    if (!roots.some((root) => root.id === rootId)) {
      const preferred = workspace === "topic" ? "Tools" : "General";
      setRootId(roots.find((root) => root.name === preferred)?.id ?? roots[0]?.id ?? "");
    }
  }, [roots, rootId]);

  useEffect(() => {
    if (!rootId) return;
    api.layout(workspace, rootId).then(({ state }) => {
      const savedExpanded = Array.isArray(state.expanded) ? state.expanded as string[] : [rootId];
      setExpanded(new Set(savedExpanded.length ? savedExpanded : [rootId]));
      const candidate = state.viewport as Partial<Viewport> | undefined;
      setViewport({ x: candidate?.x ?? 0, y: candidate?.y ?? 65, zoom: candidate?.zoom ?? 1 });
    }).catch(() => {
      setExpanded(new Set([rootId]));
      setViewport({ x: 0, y: 65, zoom: 1 });
    });
  }, [workspace, rootId]);

  const items = useMemo(
    () => layoutTree(rootId, taxonomy.categories, taxonomy.nodes, workspace, expanded),
    [rootId, taxonomy, workspace, expanded],
  );
  const itemMap = useMemo(() => new Map(items.map((item) => [item.key, item])), [items]);

  const persist = (nextExpanded = expanded, nextViewport = viewport) => {
    if (rootId) void api.saveLayout(workspace, rootId, { expanded: [...nextExpanded], viewport: nextViewport });
  };

  const toggle = (id: string) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
    persist(next, viewport);
  };

  return (
    <section className="workspace-panel">
      <div className="workspace-toolbar">
        <label>
          <span>{workspace === "topic" ? "Topic root" : "Project root"}</span>
          <select value={rootId} onChange={(event) => setRootId(event.target.value)}>
            {roots.map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}
          </select>
        </label>
        <div className="zoom-controls">
          <button onClick={() => setViewport({ x: 0, y: 65, zoom: 1 })}>Reset view</button>
          <span>{Math.round(viewport.zoom * 100)}%</span>
        </div>
      </div>
      <svg
        className="tree-canvas"
        role="application"
        aria-label={`${workspace} spatial tree`}
        onWheel={(event) => {
          event.preventDefault();
          const next = { ...viewport, zoom: Math.min(1.8, Math.max(0.35, viewport.zoom * (event.deltaY > 0 ? 0.9 : 1.1))) };
          setViewport(next);
        }}
        onPointerDown={(event) => {
          if (event.target !== event.currentTarget) return;
          drag.current = { x: event.clientX, y: event.clientY, originX: viewport.x, originY: viewport.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          setViewport({ ...viewport, x: drag.current.originX + event.clientX - drag.current.x, y: drag.current.originY + event.clientY - drag.current.y });
        }}
        onPointerUp={(event) => {
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
          persist(expanded, viewport);
        }}
      >
        <defs>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="0" dy="3" stdDeviation="5" floodOpacity="0.14" />
          </filter>
        </defs>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {items.map((item) => {
            const parent = item.parentKey ? itemMap.get(item.parentKey) : undefined;
            if (!parent) return null;
            return <path key={`edge:${item.key}`} className="tree-edge" d={`M ${parent.x} ${parent.y + 28} C ${parent.x} ${parent.y + 78}, ${item.x} ${item.y - 70}, ${item.x} ${item.y - 28}`} />;
          })}
          {items.map((item) => item.kind === "category" ? (
            <g key={item.key} className="category-visual" transform={`translate(${item.x} ${item.y})`}>
              <rect x="-76" y="-28" width="152" height="56" rx="18" />
              <text textAnchor="middle" y="4">{item.label.length > 20 ? `${item.label.slice(0, 18)}…` : item.label}</text>
              {item.childCount > 0 && (
                <g className="expand-control" role="button" tabIndex={0} onClick={() => toggle(item.id)} onKeyDown={(e) => e.key === "Enter" && toggle(item.id)}>
                  <circle cx="72" cy="24" r="13" />
                  <text x="72" y="28" textAnchor="middle">{expanded.has(item.id) ? "−" : "+"}</text>
                </g>
              )}
            </g>
          ) : (
            <g
              key={item.key}
              className={`node-visual ${selected?.id === item.id ? "selected" : ""}`}
              transform={`translate(${item.x} ${item.y})`}
              onClick={() => item.node && onSelect(item.node)}
              tabIndex={0}
              role="button"
              onKeyDown={(event) => event.key === "Enter" && item.node && onSelect(item.node)}
            >
              <title>{item.node?.content_markdown.slice(0, 180)}</title>
              <rect x="-82" y="-32" width="164" height="64" rx="10" filter="url(#shadow)" />
              <circle cx="-66" cy="-15" r="5" className={`type-dot type-${item.node?.knowledge_type.toLowerCase()}`} />
              <text textAnchor="middle" y="-2">{item.label.length > 24 ? `${item.label.slice(0, 22)}…` : item.label}</text>
              <text className="node-kind" textAnchor="middle" y="17">{item.node?.knowledge_type}</text>
            </g>
          ))}
        </g>
      </svg>
    </section>
  );
}
