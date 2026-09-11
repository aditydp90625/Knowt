export function knowledgeTypeColor(type: string): string {
  switch (type.toLocaleLowerCase("en-GB")) {
    case "reference": return "blue";
    case "practice": return "teal";
    case "debug": return "orange";
    case "result": return "violet";
    default: return "gray";
  }
}

export function knowledgeTypeClass(type: string): string {
  return `type-${type.trim().toLocaleLowerCase("en-GB").replace(/[^a-z0-9]+/g, "-")}`;
}
