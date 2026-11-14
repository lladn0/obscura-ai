import {
  applyEdgeChanges,
  applyNodeChanges,
  type EdgeChange,
  type NodeChange,
  type XYPosition,
} from "@xyflow/react";

import { buildHierarchy, defaultCollapsed } from "./hierarchy";
import type { LayoutMode } from "./layout";
import type { EdgeRelation, GraphPatch, ImageFields, NodeKind, ResearchEdge, ResearchNode } from "./types";

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
  /** Ids of nodes/edges the user deleted, so later research never brings them back. */
  deleted: string[];
};

export type NodeEdit = { label?: string; description?: string; context?: string };

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
  | { type: "stream"; ops: StreamOp[] }
  | { type: "log"; message: string }
  | { type: "addNote"; nodeId: string; position: XYPosition }
  | { type: "editNode"; nodeId: string; edit: NodeEdit }
  /** Image retrieval results; never marks the node as user-edited. */
  | { type: "setImage"; nodeId: string; data: ImageFields }
  | { type: "deleteNodes"; nodeIds: string[] }
  | { type: "deleteEdges"; edgeIds: string[] }
  | { type: "connect"; edgeId: string; source: string; target: string }
  | { type: "editEdge"; edgeId: string; relation: EdgeRelation; label?: string; width?: number }
  | { type: "minimizeNotes"; nodeIds: string[] | "all"; minimized: boolean }
  | { type: "replace"; state: BoardState };

/** Agent graph operations, applied in arrival order as one batch per frame. */
export type StreamOp =
  | {
      op: "node";
      nodeId: string;
      kind: NodeKind;
      researchId: string;
      branchId: string;
      data?: Record<string, unknown>;
      collapsed?: boolean;
    }
  | { op: "text"; nodeId: string; field: "label" | "description"; delta: string }
  /** `data` is validated final content and replaces provisional streamed text. */
  | { op: "done"; nodeId: string; data?: Record<string, unknown> }
  | { op: "edge"; edgeId: string; source: string; target: string; relation: EdgeRelation }
  /** Drop a provisional node that failed validation, with its edges. */
  | { op: "remove"; nodeId: string };

function applyStream(state: BoardState, ops: StreamOp[]): BoardState {
  const nodes = new Map(state.nodes.map((n) => [n.id, n]));
  const edges = new Map(state.edges.map((e) => [e.id, e]));
  const created: string[] = [];
  const collapsed = new Set(state.collapsed);
  const deleted = new Set(state.deleted);
  const patch = (id: string, fn: (data: ResearchNode["data"]) => ResearchNode["data"]) => {
    const n = nodes.get(id);
    if (n) nodes.set(id, { ...n, data: fn(n.data) } as ResearchNode);
  };

  for (const op of ops) {
    switch (op.op) {
      case "node":
        if (nodes.has(op.nodeId) || deleted.has(op.nodeId)) break; // duplicate or user-deleted
        nodes.set(op.nodeId, {
          id: op.nodeId,
          type: op.kind,
          position: { x: 0, y: 0 },
          data: { label: "", ...op.data, generating: true, researchId: op.researchId, branchId: op.branchId },
        } as ResearchNode);
        created.push(op.nodeId);
        if (op.collapsed) collapsed.add(op.nodeId);
        break;
      case "text":
        // User edits take priority over AI text for the same fields.
        patch(op.nodeId, (d) => (d.userEdited ? d : { ...d, [op.field]: (d[op.field] ?? "") + op.delta }));
        break;
      case "done":
        patch(op.nodeId, (d) => {
          const data = { ...op.data };
          if (d.userEdited) {
            delete data.label;
            delete data.description;
          }
          return { ...d, ...data, generating: false } as ResearchNode["data"];
        });
        break;
      case "remove":
        nodes.delete(op.nodeId);
        collapsed.delete(op.nodeId);
        for (const [id, e] of edges) if (e.source === op.nodeId || e.target === op.nodeId) edges.delete(id);
        break;
      case "edge":
        if (!nodes.has(op.source) || !nodes.has(op.target) || edges.has(op.edgeId) || deleted.has(op.edgeId)) break;
        edges.set(op.edgeId, {
          id: op.edgeId,
          source: op.source,
          target: op.target,
          type: "relation",
          data: { relation: op.relation },
        });
        break;
    }
  }

  // New nodes start on a connected neighbour; the layout pass grows them outward.
  const edgeList = [...edges.values()];
  for (const id of created) {
    if (!nodes.has(id)) continue; // created and removed in the same batch
    const neighbour = edgeList
      .map((e) => (e.source === id ? e.target : e.target === id ? e.source : null))
      .find((other) => other && !created.includes(other));
    if (neighbour) nodes.set(id, { ...nodes.get(id)!, position: nodes.get(neighbour)!.position });
  }
  const collapsedChanged = collapsed.size !== state.collapsed.length || state.collapsed.some((id) => !collapsed.has(id));
  return {
    ...state,
    nodes: [...nodes.values()],
    edges: edgeList,
    collapsed: collapsedChanged ? [...collapsed] : state.collapsed,
  };
}

export const emptyBoard: BoardState = {
  title: "Untitled research",
  isDemo: false,
  nodes: [],
  edges: [],
  activity: [],
  collapsed: [],
  pinned: { sun: {}, tree: {} },
  deleted: [],
};

const MAX_ACTIVITY = 50;

function log(state: BoardState, message: string): BoardState {
  const entry = { id: crypto.randomUUID(), at: new Date().toISOString(), message };
  return { ...state, activity: [entry, ...state.activity].slice(0, MAX_ACTIVITY) };
}

/** Upserts nodes/edges without replacing the board. Safe to call repeatedly with partial data. */
export function mergeGraph(state: BoardState, patch: GraphPatch): BoardState {
  const nodesById = new Map(state.nodes.map((n) => [n.id, n]));

  const incoming = (patch.nodes ?? []).filter((n) => !state.deleted.includes(n.id));
  for (const input of incoming) {
    const existing = nodesById.get(input.id);
    if (existing) {
      nodesById.set(input.id, {
        ...existing,
        data: existing.data.userEdited
          ? { ...existing.data, ...input.data, label: existing.data.label, description: existing.data.description }
          : { ...existing.data, ...input.data },
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
    case "stream":
      return applyStream(state, action.ops);
    case "log":
      return log(state, action.message);
    case "replace":
      return action.state;
    case "addNote":
      return {
        ...state,
        nodes: [
          ...state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
          {
            id: action.nodeId,
            type: "note",
            position: action.position,
            selected: true,
            data: { label: "New note", description: "" },
          },
        ],
        edges: state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
      };
    case "editNode":
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.nodeId
            ? ({
                ...n,
                data: {
                  ...n.data,
                  ...action.edit,
                  userEdited:
                    n.data.userEdited ||
                    (n.type !== "note" && ("label" in action.edit || "description" in action.edit)) ||
                    undefined,
                },
              } as ResearchNode)
            : n,
        ),
      };
    case "setImage":
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.id === action.nodeId ? ({ ...n, data: { ...n.data, ...action.data } } as ResearchNode) : n,
        ),
      };
    case "deleteNodes": {
      const ids = new Set(action.nodeIds);
      const goneEdges = state.edges.filter((e) => ids.has(e.source) || ids.has(e.target)).map((e) => e.id);
      const strip = (pins: Record<string, XYPosition>) =>
        Object.fromEntries(Object.entries(pins).filter(([id]) => !ids.has(id)));
      return {
        ...state,
        nodes: state.nodes.filter((n) => !ids.has(n.id)),
        edges: state.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target)),
        collapsed: state.collapsed.filter((id) => !ids.has(id)),
        pinned: { sun: strip(state.pinned.sun), tree: strip(state.pinned.tree) },
        deleted: [...state.deleted, ...ids, ...goneEdges],
      };
    }
    case "deleteEdges": {
      const ids = new Set(action.edgeIds);
      return { ...state, edges: state.edges.filter((e) => !ids.has(e.id)), deleted: [...state.deleted, ...ids] };
    }
    case "connect": {
      if (action.source === action.target) return state;
      const exists = state.edges.some(
        (e) => e.data?.manual && e.source === action.source && e.target === action.target,
      );
      if (exists) return state;
      const edge: ResearchEdge = {
        id: action.edgeId,
        source: action.source,
        target: action.target,
        type: "relation",
        selected: true,
        data: { relation: "related_to", manual: true },
      };
      // A note linked to a folded branch folds with it: open the branch so it doesn't vanish now.
      const kinds = new Map(state.nodes.map((n) => [n.id, n.type]));
      const hasNote = kinds.get(action.source) === "note" || kinds.get(action.target) === "note";
      return {
        ...state,
        nodes: state.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
        edges: [...state.edges.map((e) => (e.selected ? { ...e, selected: false } : e)), edge],
        collapsed: hasNote
          ? state.collapsed.filter((id) => id !== action.source && id !== action.target)
          : state.collapsed,
      };
    }
    case "editEdge":
      return {
        ...state,
        edges: state.edges.map((e) =>
          e.id === action.edgeId
            ? {
                ...e,
                data: {
                  ...e.data!,
                  relation: action.relation,
                  label: action.label || undefined,
                  width: action.width ?? e.data?.width,
                },
              }
            : e,
        ),
      };
    case "minimizeNotes":
      return {
        ...state,
        nodes: state.nodes.map((n) =>
          n.type === "note" && (action.nodeIds === "all" || action.nodeIds.includes(n.id))
            ? { ...n, data: { ...n.data, minimized: action.minimized || undefined } }
            : n,
        ),
      };
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
    deleted: Array.isArray(saved.deleted) ? saved.deleted : [],
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
