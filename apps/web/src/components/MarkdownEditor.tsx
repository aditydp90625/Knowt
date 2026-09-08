import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";

interface Props {
  value: string;
  resetKey: string | number;
  onChange(value: string): void;
}

export function MarkdownEditor({ value, resetKey, onChange }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!root.current) return;
    const editor = new Crepe({ root: root.current, defaultValue: value });
    editor.on((listener) => {
      listener.markdownUpdated((_context, markdown, previous) => {
        if (markdown !== previous) onChangeRef.current(markdown);
      });
    });
    void editor.create();
    return () => { void editor.destroy(); };
  }, [resetKey]);

  return <div ref={root} className="markdown-editor" />;
}
