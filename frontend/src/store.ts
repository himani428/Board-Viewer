import { useSyncExternalStore } from "react";
import type { Details, DevFlags, Item, Mode, PreviewState, Screen, Search } from "./types";

export interface State {
  screens: { status: "loading" | "ready" | "error"; list: Screen[] };
  view: { x: number; y: number; k: number };
  viewAnim: boolean; // true briefly while the view animates to a new position (fit, focus, zoom buttons)
  mode: Mode;
  previews: Record<string, PreviewState>;
  active: string | null;
  selection: { screenId: string | null; eids: number[] }; // last eid = most recently selected
  gone: boolean; // selection emptied because the page removed the elements
  hover: { screenId: string; eid: number; chain: number[] } | null;
  items: Record<string, Record<number, Item>>;
  reveal: { screenId: string; eid: number; nonce: number } | null; // layers panel should scroll to this row
  search: Search;
  details: Details;
  regionErrors: Record<string, string>;
  dev: DevFlags;
}

export const initialState: State = {
  screens: { status: "loading", list: [] },
  view: { x: 40, y: 40, k: 0.4 },
  viewAnim: false,
  mode: "select",
  previews: {},
  active: null,
  selection: { screenId: null, eids: [] },
  gone: false,
  hover: null,
  items: {},
  reveal: null,
  search: { q: "", status: "idle", nodes: null },
  details: { screenId: null, key: null, nonce: 0, status: "idle" },
  regionErrors: {},
  dev: { screensFail: false, detailsFail: false, detailsLatency: 0, layersThrow: false, inspectorThrow: false, sticky: false },
};

type Listener = () => void;
let state: State = initialState;
const listeners = new Set<Listener>();

export const getState = () => state;
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function subscribe(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
/** Selectors must return stable references (a field of state, or a primitive). */
export function useStore<T>(selector: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}