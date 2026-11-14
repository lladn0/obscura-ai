import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";

import { buildHierarchy, defaultCollapsed } from "./hierarchy";
import type { LayoutMode } from "./layout";
import type { GraphPatch, ResearchEdge, ResearchNode } from "./types";

export type ActivityEntry = { id: string; at: string; message: string };

export type BoardState = {
  title: string;
  isDemo: boolean;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  activity: ActivityEntry[];
  /** Nodes whose branch is folded away. */
  collapsed: string[];
  /** Positions the user dragged nodes to, kept separately per layout mode. */
  pinned: Record<LayoutMode, Record<string, XYPosition>>;
};

export type BoardAction =
  | { type: "nodesChange"; changes: NodeChange<ResearchNode>[] }
  | { type: "edgesChange"; changes: EdgeChange<ResearchEdge>[] }
  | { type: "merge"; patch: GraphPatch }
  | { type: "setPositions"; positions: Map<string, XYPosition> }
  | { type: "select"; nodeId: string | null }
  | { type: "toggleCollapse"; nodeId: string }
  | { type: "setCollapsed"; nodeIds: string[] }
  | { type: "pin"; mode: LayoutMode; nodeIds: string[] }
  | { type: "unpin"; mode: LayoutMode; nodeIds: string[] | "all" }
  | { type: "log"; message: string }
  | { type: "replace"; state: BoardState };

export const emptyBoard: BoardState = {
  title: "Untitled research",
  isDemo: false,
  nodes: [],
  edges: [],
  activity: [],
  collapsed: [],
  pinned: { sun: {}, tree: {} },
};

const MAX_ACTIVITY = 50;

function log(state: BoardState, message: string): BoardState {
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), message };
  return { ...state, activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY) };
}

/** Upserts nodes/edges without replacing the board. Safe to call repeatedly with partial data. */
export function mergeGraph(state: BoardState, patch: GraphPatch): BoardState {
  const nodesById = new Map(state.nodes.map((n) => [n.id, n]));

  const incoming = patch.nodes ?? [];
  for (const input of incoming) {
    const existing = nodesById.get(input.id);
    if (existing) {
      nodesById.set(input.id, {
        ...existing,
        data: { ...existing.data, ...input.data },
      } as ResearchNode);
    } else {
      nodesById.set(input.id, { ...input, position: input.position ?? { x: 0, y: 0 } } as ResearchNode);
    }
  }

  const edgesById = new Map(state.edges.map((e) => [e.id, e]));
  for (const input of patch.edges ?? []) {
    if (!nodesById.has(input.source) || !nodesById.has(input.target)) continue;
    const existing = edgesById.get(input.id);
    edgesById.set(input.id, {
      ...existing,
      ...input,
      type: "relation",
      data: { ...existing?.data, ...input.data },
    } as ResearchEdge);
  }

  const edges = [...edgesById.values()];
  // New nodes without a position start on a connected neighbour; the layout
  // pass then animates them outward into their branch.
  for (const input of incoming) {
    if (input.position || state.nodes.some((n) => n.id === input.id)) continue;
    const anchor = edges
      .map((e) => (e.source === input.id ? e.target : e.target === input.id ? e.source : null))
      .map((id) => (id ? nodesById.get(id) : undefined))
      .find((n) => n && n.id !== input.id);
    if (anchor) nodesById.set(input.id, { ...nodesById.get(input.id)!, position: anchor.position });
  }
  const nodes = [...nodesById.values()];

  const next = { ...state, nodes, edges };
  return patch.activity ? log(next, patch.activity) : next;
}

export function boardReducer(state: BoardState, action: BoardAction): BoardState {
  switch (action.type) {
    case "nodesChange":
      return { ...state, nodes: applyNodeChanges(action.changes, state.nodes) };
    case "edgesChange":
      return { ...state, edges: applyEdgeChanges(action.changes, state.edges) };
    case "merge":
      return mergeGraph(state, action.patch);
    case "setPositions":
      return {
        ...state,
        nodes: state.nodes.map((n) => {
          const position = action.positions.get(n.id);
          return position ? { ...n, position } : n;
        }),
      };
    case "select":
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.selected === (n.id === action.nodeId) ? n : { ...n, selected: n.id === action.nodeId },
        ),
        edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
      };
    case "toggleCollapse": {
      const collapsed = state.collapsed.includes(action.nodeId)
        ? state.collapsed.filter((id) => id !== action.nodeId)
        : [...state.collapsed, action.nodeId];
      return { ...state, collapsed };
    }
    case "setCollapsed":
      return { ...state, collapsed: action.nodeIds };
    case "pin": {
      const pins = { ...state.pinned[action.mode] };
      for (const n of state.nodes) if (action.nodeIds.includes(n.id)) pins[n.id] = n.position;
      return { ...state, pinned: { ...state.pinned, [action.mode]: pins } };
    }
    case "unpin": {
      const pins: Record<string, XYPosition> = {};
      if (action.nodeIds !== "all") {
        for (const [id, p] of Object.entries(state.pinned[action.mode]))
          if (!action.nodeIds.includes(id)) pins[id] = p;
      }
      return { ...state, pinned: { ...state.pinned, [action.mode]: pins } };
    }
    case "log":
      return log(state, action.message);
    case "replace":
      return action.state;
  }
}

// --- Persistence -----------------------------------------------------------

const STORAGE_KEY = "rabbithole:board:v1";

export function loadBoard(): BoardState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BoardState>;
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    return withDefaults({ ...emptyBoard, ...parsed } as BoardState, parsed);
  } catch {
    return null;
  }
}

/** Boards saved before collapsing/pinning existed get sensible defaults. */
export function withDefaults(state: BoardState, saved: Partial<BoardState> = {}): BoardState {
  return {
    ...state,
    collapsed: Array.isArray(saved.collapsed)
      ? saved.collapsed
      : defaultCollapsed(buildHierarchy(state.nodes, state.edges)),
    pinned: { sun: saved.pinned?.sun ?? {}, tree: saved.pinned?.tree ?? {} },
  };
}

export function saveBoard(state: BoardState) {
  try {
    // Transient interaction flags are not persisted (JSON drops undefined).
    const nodes = state.nodes.map((n) => ({ ...n, selected: undefined, dragging: undefined }));
    const edges = state.edges.map((e) => ({ ...e, selected: undefined }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, nodes, edges }));
  } catch {
    // Storage unavailable (private mode, quota): the board still works in memory.
  }
}
