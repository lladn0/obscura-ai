import { emptyBoard, LEGACY_BOARD_KEY, loadBoard, saveBoard, type BoardState } from "./board-state";

/**
 * Several independently saved boards in localStorage: an index of board
 * metadata plus one key per board. The single board saved by earlier versions
 * is migrated (copied, never deleted) the first time the index is read.
 */

export type BoardMeta = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  /** Last known AI research status (the user's own completion is tracked in analytics). */
  research?: "running" | "completed" | "failed";
};

const INDEX_KEY = "rabbithole:boards:v1";
const LEGACY_MODE_KEY = "rabbithole:layout-mode";
export const boardKey = (id: string) => `rabbithole:board:${id}`;
export const modeKey = (id: string) => `rabbithole:layout-mode:${id}`;

const listeners = new Set<() => void>();
export const onBoardsChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

function readIndex(): BoardMeta[] | null {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    return raw ? (JSON.parse(raw) as BoardMeta[]) : null;
  } catch {
    return null;
  }
}

function writeIndex(boards: BoardMeta[]) {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(boards));
  } catch {
    // Storage unavailable: boards still work for this page view.
  }
  for (const l of listeners) l();
}

const countNodes = (s: BoardState) => s.nodes.length;
const newId = () => `b-${crypto.randomUUID().slice(0, 8)}`;

/** All boards, most recently modified first. Migrates the legacy single board once. */
export function listBoards(): BoardMeta[] {
  let boards = readIndex();
  if (!boards) {
    boards = [];
    const legacy = loadBoard(LEGACY_BOARD_KEY);
    if (legacy && legacy.nodes.length) {
      const id = newId();
      const now = new Date().toISOString();
      saveBoard(boardKey(id), legacy);
      try {
        const mode = localStorage.getItem(LEGACY_MODE_KEY);
        if (mode) localStorage.setItem(modeKey(id), mode);
      } catch {}
      boards.push({ id, title: legacy.title, createdAt: now, updatedAt: now, nodeCount: countNodes(legacy) });
    }
    writeIndex(boards);
  }
  return [...boards].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const getBoardMeta = (id: string) => listBoards().find((b) => b.id === id) ?? null;

export function createBoard(title = "Untitled research"): BoardMeta {
  const now = new Date().toISOString();
  const meta: BoardMeta = { id: newId(), title, createdAt: now, updatedAt: now, nodeCount: 0 };
  saveBoard(boardKey(meta.id), { ...emptyBoard, title, pinned: { sun: {}, tree: {} }, deleted: [] });
  writeIndex([meta, ...listBoards()]);
  return meta;
}

export const loadBoardById = (id: string) => loadBoard(boardKey(id));

/** Save a board and refresh its index entry (title, node count, modified date). */
export function saveBoardById(id: string, state: BoardState) {
  saveBoard(boardKey(id), state);
  const boards = listBoards();
  const meta = boards.find((b) => b.id === id);
  if (!meta) return;
  const nodeCount = countNodes(state);
  if (meta.title === state.title && meta.nodeCount === nodeCount && Date.now() - Date.parse(meta.updatedAt) < 5000) return;
  writeIndex(
    boards.map((b) => (b.id === id ? { ...b, title: state.title, nodeCount, updatedAt: new Date().toISOString() } : b)),
  );
}

export function updateBoardMeta(id: string, patch: Partial<Omit<BoardMeta, "id">>) {
  const boards = listBoards();
  if (!boards.some((b) => b.id === id)) return;
  writeIndex(boards.map((b) => (b.id === id ? { ...b, ...patch } : b)));
}

export function renameBoard(id: string, title: string) {
  const state = loadBoardById(id);
  if (state) saveBoard(boardKey(id), { ...state, title });
  updateBoardMeta(id, { title, updatedAt: new Date().toISOString() });
}

export function deleteBoard(id: string) {
  try {
    localStorage.removeItem(boardKey(id));
    localStorage.removeItem(modeKey(id));
  } catch {}
  writeIndex(listBoards().filter((b) => b.id !== id));
}
