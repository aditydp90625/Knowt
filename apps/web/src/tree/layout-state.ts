import type { LayoutState } from "@knowt/contracts";

export function toggleCategoryLayout(current: LayoutState, rootId: string, categoryId: string): LayoutState {
  const expanded = new Set(current.expandedCategoryIds);
  if (expanded.has(categoryId) && (current.showAllCategories || categoryId !== rootId)) expanded.delete(categoryId);
  else expanded.add(categoryId);
  return { ...current, expandedCategoryIds: [...expanded] };
}

export function expandAllLayout(current: LayoutState, categoryIds: string[]): LayoutState {
  if (!current.showAllCategories) {
    return { ...current, expandedCategoryIds: [], showAllCategories: true, positions: {} };
  }
  const expanded = new Set(current.expandedCategoryIds);
  if (categoryIds.every((id) => expanded.has(id))) return current;
  return { ...current, expandedCategoryIds: [...new Set(categoryIds)], positions: {} };
}

export function collapseAllLayout(current: LayoutState): LayoutState {
  if (!current.showAllCategories && current.expandedCategoryIds.length === 0) return current;
  if (current.showAllCategories && current.expandedCategoryIds.length === 0) {
    return { ...current, showAllCategories: false, positions: {} };
  }
  return { ...current, expandedCategoryIds: [], showAllCategories: true, positions: {} };
}
