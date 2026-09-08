import { eq } from "drizzle-orm";
import type { DatabaseContext } from "./database.js";
import { categories, knowledgeTypes, settings } from "./schema.js";

const TOPIC_ROOTS = [
  "Tools",
  "RF",
  "Electrical",
  "Embedded",
  "Digital Design",
  "Electronics",
  "Software",
  "Mechanical",
  "Robotics",
  "ML",
  "DSP",
  "Biology",
  "Chemistry",
  "Miscellaneous",
] as const;

const TOOL_CHILDREN = ["Altium", "CST", "AWR", "Vivado", "Vitis", "LTSpice"] as const;

const TYPES = [
  ["reference", "Reference", "Factual or explanatory information", true, 10, ""],
  ["practice", "Practice", "Useful engineering technique, convention or pattern", true, 20, "## Context\n\n## Practice\n\n## Why it works\n"],
  ["debug", "Debug", "Knowledge discovered while diagnosing a real problem", true, 30, "## Symptom\n\n## Cause\n\n## Resolution\n"],
  ["result", "Result", "Measured, observed or experimentally obtained result", true, 40, "## Setup\n\n## Result\n\n## Interpretation\n"],
  ["decision", "Decision", "A decision and its rationale", false, 50, "## Decision\n\n## Rationale\n\n## Alternatives\n"],
  ["project-record", "Project Record", "Project-specific record of work", false, 60, ""],
] as const;

export function seedDatabase(context: DatabaseContext): void {
  const now = new Date().toISOString();
  context.transaction(() => {
    for (const [id, name, description, enabled, sortOrder, templateMarkdown] of TYPES) {
      context.orm.insert(knowledgeTypes).values({ id, name, description, enabled, sortOrder, templateMarkdown }).onConflictDoNothing().run();
    }

    const hasCategories = context.orm.select({ id: categories.id }).from(categories).limit(1).get();
    if (!hasCategories) {
      const rootIds = new Map<string, string>();
      for (const name of TOPIC_ROOTS) {
        const id = crypto.randomUUID();
        rootIds.set(name, id);
        context.orm.insert(categories).values({
          id,
          workspace: "topic",
          parentId: null,
          name,
          normalizedName: name.toLocaleLowerCase("en-GB"),
          protected: name === "Miscellaneous",
          createdAt: now,
          updatedAt: now,
        }).run();
      }
      const toolsId = rootIds.get("Tools");
      if (!toolsId) throw new Error("Tools seed was not created");
      for (const name of TOOL_CHILDREN) {
        context.orm.insert(categories).values({
          id: crypto.randomUUID(),
          workspace: "topic",
          parentId: toolsId,
          name,
          normalizedName: name.toLocaleLowerCase("en-GB"),
          protected: false,
          createdAt: now,
          updatedAt: now,
        }).run();
      }
      context.orm.insert(categories).values({
        id: crypto.randomUUID(),
        workspace: "project",
        parentId: null,
        name: "General",
        normalizedName: "general",
        protected: true,
        createdAt: now,
        updatedAt: now,
      }).run();
    }

    if (!context.orm.select().from(settings).where(eq(settings.key, "app")).get()) {
      context.orm.insert(settings).values({
        key: "app",
        valueJson: JSON.stringify({ theme: "system", inboxPath: "data/inbox", rejectedRetentionDays: 30 }),
        updatedAt: now,
      }).run();
    }
  });
}
