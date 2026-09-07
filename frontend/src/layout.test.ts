import { describe, expect, it } from "vitest";
import { layoutTree } from "./layout";
import type { Category } from "./types";

describe("layoutTree", () => {
  it("keeps children below their parent and hides collapsed descendants", () => {
    const categories: Category[] = [
      { id: "root", workspace: "topic", parent_id: null, name: "Root", protected: 0, direct_node_count: 0 },
      { id: "child", workspace: "topic", parent_id: "root", name: "Child", protected: 0, direct_node_count: 0 },
      { id: "grandchild", workspace: "topic", parent_id: "child", name: "Grandchild", protected: 0, direct_node_count: 0 },
    ];
    const visible = layoutTree("root", categories, [], "topic", new Set(["root"]));
    expect(visible.map((item) => item.id)).toEqual(["root", "child"]);
    expect(visible[1].y).toBeGreaterThan(visible[0].y);
  });
});

