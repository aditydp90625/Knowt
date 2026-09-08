export function normalizeLabel(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

export function cleanTags(values: string[]): string[] {
  const tags = new Map<string, string>();
  for (const value of values) {
    const display = value.trim().replace(/\s+/g, " ");
    const normalized = normalizeLabel(display);
    if (display && !tags.has(normalized)) tags.set(normalized, display);
  }
  return [...tags.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, display]) => display);
}

export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```\w*\n?|```/g, ""))
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[#>*_~`|\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ftsQuery(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/["*:^(){}[\]]/g, ""))
    .filter(Boolean)
    .map((term) => `"${term}"*`)
    .join(" AND ");
}
