import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";

import { placeNewNodes } from "./layout";
import type { GraphPatch, ResearchEdge, ResearchNode } from "./types";

export type ActivityEntry = { id: string; at: string; message: string };

export type BoardState = {
  title: string;
  isDemo: boolean;
  nodes: ResearchNode[];
  edges: ResearchEdge[];
  activity: ActivityEntry[];
};

export type BoardAction =
  | { type: "nodesChange"; changes: NodeChange<ResearchNode>[] }
  | { type: "edgesChange"; changes: EdgeChange<ResearchEdge>[] }
  | { type: "merge"; patch: GraphPatch }
  | { type: "setPositions"; positions: Map<string, XYPosition> }
  | { type: "select"; nodeId: string | null }
  | { type: "log"; message: string }
  | { type: "replace"; state: BoardState };

export const emptyBoard: BoardState = {
  title: "Untitled research",
  isDemo: false,
  nodes: [],
  edges: [],
  activity: [],
};

const MAX_ACTIVITY = 50;

function log(state: BoardState, message: string): BoardState {
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), message };
  return { ...state, activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY) };
}

/** Upserts nodes/edges without replacing the board. Safe to call repeatedly with partial data. */
export function mergeGraph(state: BoardState, patch: GraphPatch): BoardState {
  const nodesById = new Map(state.nodes.map((n) => [n.id, n]));
  const newIds = new Set<string>();

  for (const input of patch.nodes ?? []) {
    const existing = nodesById.get(input.id);
    if (existing) {
      nodesById.set(input.id, {
        ...existing,
        data: { ...existing.data, ...input.data },
      } as ResearchNode);
    } else {
      nodesById.set(input.id, { ...input, position: input.position ?? { x: 0, y: 0 } } as ResearchNode);
      if (!input.position) newIds.add(input.id);
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

  let nodes = [...nodesById.values()];
  const edges = [...edgesById.values()];
  if (newIds.size) nodes = placeNewNodes(nodes, edges, newIds);

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
    const parsed = JSON.parse(raw) as BoardState;
    return Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) ? parsed : null;
  } catch {
    return null;
  }
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
