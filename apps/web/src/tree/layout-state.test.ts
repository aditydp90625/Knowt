import type { LayoutState } from "@knowt/contracts";
import { describe, expect, it } from "vitest";
import { collapseAllLayout, expandAllLayout, toggleCategoryLayout } from "./layout-state";

const rootId = "00000000-0000-4000-8000-000000000001";
const childId = "00000000-0000-4000-8000-000000000002";
const initial: LayoutState = {
  viewport: { x: 0, y: 0, zoom: 1 },
  expandedCategoryIds: [rootId],
  showAllCategories: false,
  positions: { [`category:${rootId}`]: { x: 20, y: 30 } },
};

describe("tree layout controls", () => {
  it("expands categories first and then all category contents", () => {
    const categoriesOnly = expandAllLayout(initial, [rootId, childId]);
    expect(categoriesOnly).toMatchObject({ showAllCategories: true, expandedCategoryIds: [] });

    const allContents = expandAllLayout(categoriesOnly, [rootId, childId]);
    expect(allContents).toMatchObject({ showAllCategories: true, expandedCategoryIds: [rootId, childId] });
  });

  it("opens one category's nodes without hiding the expanded category hierarchy", () => {
    const categoriesOnly = expandAllLayout(initial, [rootId, childId]);
    const oneCategoryOpen = toggleCategoryLayout(categoriesOnly, rootId, childId);
    expect(oneCategoryOpen).toMatchObject({ showAllCategories: true, expandedCategoryIds: [childId] });
  });

  it("collapses all nodes first and then the category hierarchy", () => {
    const allContents = expandAllLayout(expandAllLayout(initial, [rootId, childId]), [rootId, childId]);
    const categoriesOnly = collapseAllLayout(allContents);
    expect(categoriesOnly).toMatchObject({ showAllCategories: true, expandedCategoryIds: [] });

    const rootOnly = collapseAllLayout(categoriesOnly);
    expect(rootOnly).toMatchObject({ showAllCategories: false, expandedCategoryIds: [] });
  });
});
