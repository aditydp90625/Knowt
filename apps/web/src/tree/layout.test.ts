import type { Category, KnowledgeNode } from "@knowt/contracts";
import { describe, expect, it } from "vitest";
import { projectTree } from "./layout";

const now = "2026-09-07T12:00:00Z";
const root: Category = { id: "00000000-0000-4000-8000-000000000001", workspace: "topic", parentId: null, name: "Digital Design", protected: false, directNodeCount: 0, descendantNodeCount: 1, createdAt: now, updatedAt: now };
const child: Category = { id: "00000000-0000-4000-8000-000000000002", workspace: "topic", parentId: root.id, name: "FPGA", protected: false, directNodeCount: 1, descendantNodeCount: 1, createdAt: now, updatedAt: now };
const node: KnowledgeNode = {
  id: "00000000-0000-4000-8000-000000000003", title: "CDC", contentMarkdown: "Two flip-flops", knowledgeTypeId: "reference", knowledgeType: "Reference",
  topicCategoryId: child.id, projectCategoryId: "00000000-0000-4000-8000-000000000004", topicPath: [{ id: root.id, name: root.name }, { id: child.id, name: child.name }], projectPath: [], tags: [], sourceType: null, sourceDetails: null,
  version: 1, createdAt: now, updatedAt: now, deletedAt: null,
};

describe("tree projection", () => {
  it("only discloses descendants of expanded categories", () => {
    expect(projectTree("topic", root.id, [root, child], [node], new Set([root.id]), {}).nodes).toHaveLength(2);
    expect(projectTree("topic", root.id, [root, child], [node], new Set([root.id, child.id]), {}).nodes).toHaveLength(3);
  });

  it("retains saved spatial positions", () => {
    const result = projectTree("topic", root.id, [root], [], new Set([root.id]), { [`category:${root.id}`]: { x: 123, y: 456 } });
    expect(result.nodes[0]?.position).toEqual({ x: 123, y: 456 });
  });
});
