"use client";

import { createContext, useContext } from "react";

import type { NodeEdit } from "@/graph/board-state";
import type { Hierarchy } from "@/graph/hierarchy";
import type { LayoutMode } from "@/graph/layout";

export type BoardView = {
  mode: LayoutMode;
  hierarchy: Hierarchy;
  collapsed: ReadonlySet<string>;
  toggleCollapse: (id: string) => void;
  /** Nodes with a user action (Deep Dive, Challenge, ...) in flight. */
  busy: ReadonlySet<string>;
  /** Node whose title/description is being edited in place. */
  editingId: string | null;
  setEditing: (id: string | null) => void;
  saveEdit: (id: string, edit: NodeEdit) => void;
};

export const BoardViewContext = createContext<BoardView | null>(null);

export function useBoardView() {
  const view = useContext(BoardViewContext);
  if (!view) throw new Error("useBoardView must be used inside BoardViewContext");
  return view;
}

/** Child count and fold state of a node's branch. */
export function useBranch(id: string) {
  const { hierarchy, collapsed, toggleCollapse } = useBoardView();
  const children = hierarchy.children.get(id)?.length ?? 0;
  const isCollapsed = collapsed.has(id);
  let hidden = 0;
  if (isCollapsed) {
    const stack = [...(hierarchy.children.get(id) ?? [])];
    while (stack.length) {
      hidden++;
      stack.push(...(hierarchy.children.get(stack.pop()!) ?? []));
    }
  }
  return { children, collapsed: isCollapsed, hidden, toggle: () => toggleCollapse(id) };
}
