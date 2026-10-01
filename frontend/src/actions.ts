// All host state changes go through this file. Components only read the store and call these functions.
// The bridge delivers page messages here; nothing else is allowed to write to the store.
import { fetchElement, fetchScreens } from "./api";
import { cancelAll, frameRect, request, resolveReply, send, senderOf } from "./bridge";
import { Cancelled, guard, handleRegionError, isCancelled, regionKey, reportOnce, setRegionError } from "./errors";
import { getState, setState, subscribe } from "./store";
import type { State } from "./store";
import type { Desc, Item, Mode, Pick, PreviewState, SNode, Tree, TNode } from "./types";

export const PREVIEW_W = 1280;
export const PREVIEW_H = 800;
export const MIN_K = 0.25;
export const MAX_K = 4;
export const COLS = 4;
export const GAP = 120;
export const TITLE_H = 48;

const emptyTree = (): Tree => ({ nodes: {}, kids: {}, parentOf: {}, expanded: {} });
const newPreview = (): PreviewState => ({ status: "connecting", docId: null, reload: 0, silent: false, errors: [], tree: emptyTree() });
const current = (id: string, docId: string | null) => getState().previews[id]?.docId === docId && docId !== null;

function patchPreview(id: string, fn: (p: PreviewState) => Partial<PreviewState>) {
  setState((s) => {
    const p = s.previews[id];
    return p ? { previews: { ...s.previews, [id]: { ...p, ...fn(p) } } } : {};
  });
}
const patchTree = (id: string, fn: (t: Tree) => Tree) => patchPreview(id, (p) => ({ tree: fn(p.tree) }));

/** Layers panel scroll position per preview. Not reactive on purpose; cleared when the page navigates or the board reloads. */
export const scrollMem = new Map<string, number>();

// ---------------------------------------------------------------- board

let screensCtl: AbortController | null = null;
let boardEl: HTMLElement | null = null;
export const setBoardEl = (el: HTMLElement | null) => { boardEl = el; };

export function loadScreens() {
  screensCtl?.abort();
  const ctl = new AbortController();
  screensCtl = ctl;
  connectTimers.forEach((t) => window.clearTimeout(t));
  connectTimers.clear();
  inflight.clear();
  lastTracked.clear();
  scrollMem.clear();
  setRegionError("board", null);
  setState({
    screens: { status: "loading", list: [] }, previews: {}, active: null, selection: { screenId: null, eids: [] },
    gone: false, hover: null, items: {}, reveal: null, search: { q: "", status: "idle", nodes: null },
  });
  const dev = getState().dev;
  if (dev.screensFail && !dev.sticky) setState((s) => ({ dev: { ...s.dev, screensFail: false } })); // one-shot unless "sticky"
  fetchScreens(ctl.signal, dev.screensFail)
    .then((list) => {
      if (ctl.signal.aborted) return;
      const previews: Record<string, PreviewState> = {};
      list.forEach((sc) => { previews[sc.id] = newPreview(); });
      setState({ screens: { status: "ready", list }, previews });
    })
    .catch((e) => {
      if (ctl.signal.aborted) return;
      handleRegionError("board", e, { screenId: null });
      setState({ screens: { status: "error", list: [] } });
    });
}

export function panBy(dx: number, dy: number) {
  clearHover();
  setState((s) => ({ viewAnim: false, view: { ...s.view, x: s.view.x + dx, y: s.view.y + dy } }));
}
/** Zoom around a point given in board-root coordinates. */
export function zoomAt(px: number, py: number, factor: number) {
  clearHover();
  setState((s) => {
    const k = Math.min(MAX_K, Math.max(MIN_K, s.view.k * factor));
    const r = k / s.view.k;
    return { viewAnim: false, view: { k, x: px - (px - s.view.x) * r, y: py - (py - s.view.y) * r } };
  });
}
export function zoomAtClient(clientX: number, clientY: number, factor: number) {
  const r = boardEl?.getBoundingClientRect();
  if (r) zoomAt(clientX - r.left, clientY - r.top, factor);
}

let animTimer = 0;
/** Move the view with a short animation. The animation flag is dropped again so wheel and drag stay instant. */
function animateView(view: State["view"]) {
  clearHover();
  setState({ view, viewAnim: true });
  window.clearTimeout(animTimer);
  animTimer = window.setTimeout(() => setState({ viewAnim: false }), 400);
}
function viewForRect(l: number, t: number, w: number, h: number) {
  const r = boardEl?.getBoundingClientRect();
  if (!r) return null;
  const k = Math.min(MAX_K, Math.max(MIN_K, Math.min((r.width - 120) / w, (r.height - 120) / h)));
  return { k, x: (r.width - w * k) / 2 - l * k, y: (r.height - h * k) / 2 - t * k };
}
const cellOf = (index: number) => ({ col: index % COLS, row: Math.floor(index / COLS) });
export function fitAll() {
  const n = getState().screens.list.length;
  if (!n) return;
  const rows = Math.ceil(n / COLS);
  const v = viewForRect(0, 0, Math.min(n, COLS) * PREVIEW_W + (Math.min(n, COLS) - 1) * GAP, rows * (PREVIEW_H + TITLE_H + GAP) - GAP);
  if (v) animateView(v);
}
/** Zoom so one screen fills the board. */
export function focusScreen(id: string) {
  const i = getState().screens.list.findIndex((s) => s.id === id);
  if (i < 0) return;
  const { col, row } = cellOf(i);
  const v = viewForRect(col * (PREVIEW_W + GAP), row * (PREVIEW_H + TITLE_H + GAP), PREVIEW_W, PREVIEW_H + TITLE_H);
  if (v) animateView(v);
}
/** Zoom about the centre of the board (toolbar buttons and keys). */
export function zoomTo(k: number) {
  const r = boardEl?.getBoundingClientRect();
  if (!r) return;
  const s = getState();
  const nk = Math.min(MAX_K, Math.max(MIN_K, k));
  const cx = r.width / 2, cy = r.height / 2, f = nk / s.view.k;
  animateView({ k: nk, x: cx - (cx - s.view.x) * f, y: cy - (cy - s.view.y) * f });
}
export const zoomStep = (dir: 1 | -1) => zoomTo(getState().view.k * (dir > 0 ? 1.25 : 0.8));
export const resetView = () => animateView({ x: 40, y: 40, k: 0.4 });
export function collapseAll(id: string) {
  patchTree(id, (t) => ({ ...t, expanded: {} }));
}

export function setMode(mode: Mode) {
  if (getState().mode === mode) return;
  setState({ mode });
  clearHover();
  const s = getState();
  for (const id in s.previews) if (s.previews[id].docId) send(id, { t: "mode", mode }, s.previews[id].docId);
  if (mode === "select") {
    // A page that had keyboard focus must not keep it, or Tab/Enter would act on the page.
    const a = document.activeElement;
    if (a instanceof HTMLIFrameElement) a.blur();
    window.focus();
  }
}

// ---------------------------------------------------------------- previews and connection

const connectTimers = new Map<string, number>();
const clearConnect = (id: string) => {
  const t = connectTimers.get(id);
  if (t) window.clearTimeout(t);
  connectTimers.delete(id);
};
export function armConnect(id: string) {
  clearConnect(id);
  connectTimers.set(id, window.setTimeout(guard("preview", { screenId: id }, () => {
    const p = getState().previews[id];
    if (p && p.status === "connecting") failPreview(id, new Error("The preview did not respond within 10 seconds"));
  }), 10000));
}
function failPreview(id: string, e: unknown) {
  clearConnect(id);
  if (handleRegionError("preview", e, { screenId: id })) {
    cancelAll(id);
    patchPreview(id, () => ({ status: "failed" }));
  }
}
export function reloadPreview(id: string, silent = false) {
  clearConnect(id);
  cancelAll(id);
  lastTracked.delete(id);
  setRegionError(regionKey("preview", { screenId: id }), null);
  setState((s) => {
    const p = s.previews[id];
    if (!p) return {};
    const items = { ...s.items };
    delete items[id];
    return {
      previews: { ...s.previews, [id]: { ...newPreview(), reload: p.reload + 1, silent } }, items,
      selection: s.selection.screenId === id ? { screenId: null, eids: [] } : s.selection,
      hover: s.hover?.screenId === id ? null : s.hover,
    };
  });
}
export const pingPreview = (id: string) => send(id, { t: "ping" });

function onHello(id: string, docId: string) {
  const p = getState().previews[id];
  if (!p || p.status === "failed") return;
  clearConnect(id);
  if (p.docId === docId) { if (p.status !== "ready") patchPreview(id, () => ({ status: "ready" })); return; }
  cancelAll(id);
  inflight.forEach((_, k) => { if (k.startsWith(id + ":")) inflight.delete(k); });
  lastTracked.set(id, JSON.stringify([docId, null, []]));
  scrollMem.delete(id);
  setState((s) => {
    const items = { ...s.items };
    delete items[id];
    return {
      previews: { ...s.previews, [id]: { ...p, status: "ready", docId, errors: [], tree: emptyTree() } }, items,
      selection: s.selection.screenId === id ? { screenId: null, eids: [] } : s.selection, // navigation clears the selection
      hover: s.hover?.screenId === id ? null : s.hover,
      gone: false,
      reveal: s.reveal?.screenId === id ? null : s.reveal,
    };
  });
  send(id, { t: "init", mode: getState().mode }, docId);
  if (getState().active === id) { void loadKids(id, 0); rerunSearch(); }
}
function onBye(id: string, docId: string) {
  const p = getState().previews[id];
  if (!p || p.docId !== docId || p.status !== "ready") return;
  patchPreview(id, () => ({ status: "connecting" }));
  armConnect(id);
}
function onPageError(id: string, message: string) {
  patchPreview(id, (p) => ({ errors: [...p.errors, message] }));
  reportOnce("preview", new Error(message), { screenId: id });
}

/** Ask a page something. Timeouts become a preview failure; cancellations are silent. */
async function agentCall<T>(id: string, msg: Record<string, unknown>, timeout = 3000): Promise<T | undefined> {
  const p = getState().previews[id];
  if (!p || p.status !== "ready" || !p.docId) return undefined;
  const docId = p.docId;
  try {
    return await request<T>(id, msg, docId, timeout);
  } catch (e) {
    if (isCancelled(e) || !current(id, docId)) return undefined;
    failPreview(id, e);
    return undefined;
  }
}

// ---------------------------------------------------------------- tracking (what the pages should measure)

const lastTracked = new Map<string, string>();
function syncTracking() {
  const s = getState();
  for (const id in s.previews) {
    const p = s.previews[id];
    if (p.status !== "ready" || !p.docId) continue;
    const hover = s.mode === "select" && s.hover?.screenId === id ? s.hover.eid : null;
    const selected = s.selection.screenId === id ? s.selection.eids : [];
    const sig = JSON.stringify([p.docId, hover, selected]);
    if (lastTracked.get(id) !== sig) { lastTracked.set(id, sig); send(id, { t: "track", hover, selected }, p.docId); }
  }
}
function onState(id: string, items: Item[]) {
  const map: Record<number, Item> = {};
  items.forEach((i) => { map[i.eid] = i; });
  setState((s) => ({ items: { ...s.items, [id]: map } }));
}
function seedItem(id: string, item: Item | null) {
  if (item) setState((s) => ({ items: { ...s.items, [id]: { ...s.items[id], [item.eid]: item } } }));
}

// ---------------------------------------------------------------- hover

let probeBusy = false;
let probePending: { id: string; x: number; y: number } | null = null;
let hoverGen = 0;
function setHover(h: State["hover"]) {
  const c = getState().hover;
  if (c === h || (c && h && c.screenId === h.screenId && c.eid === h.eid)) return;
  setState({ hover: h });
}
export function clearHover() { hoverGen++; probePending = null; setHover(null); }
/** Coalesced: at most one probe in flight, newest position wins. */
export function probeAt(id: string, x: number, y: number) {
  probePending = { id, x, y };
  if (!probeBusy) void runProbe();
}
async function runProbe() {
  probeBusy = true;
  try {
    while (probePending) {
      const p = probePending;
      probePending = null;
      const gen = hoverGen;
      const r = await agentCall<Pick | null>(p.id, { t: "probe", x: p.x, y: p.y });
      if (gen !== hoverGen || getState().mode !== "select" || r === undefined) continue;
      if (r) { seedItem(p.id, r.item); setHover({ screenId: p.id, eid: r.desc.eid, chain: r.desc.chain }); }
      else setHover(null);
    }
  } finally { probeBusy = false; }
}
export function hoverRow(id: string, eid: number | null) {
  if (getState().mode !== "select") return;
  if (eid === null) return setHover(null);
  const po = getState().previews[id]?.tree.parentOf ?? {};
  const chain: number[] = [];
  for (let p = po[eid]; p !== undefined && p !== 0; p = po[p]) chain.unshift(p);
  setHover({ screenId: id, eid, chain });
}

// ---------------------------------------------------------------- selection

export function setActive(id: string) {
  if (getState().active === id) return;
  setState({ active: id });
  void loadKids(id, 0);
  rerunSearch();
}
export const clearSelection = () => setState({ selection: { screenId: null, eids: [] }, gone: false });

function nextSelection(id: string, eid: number, shift: boolean): number[] {
  const sel = getState().selection;
  if (shift && sel.screenId === id) return sel.eids.includes(eid) ? sel.eids.filter((e) => e !== eid) : [...sel.eids, eid];
  return [eid]; // plain click, or shift-click in another preview, replaces
}
function commitSelection(id: string, eids: number[]) {
  setState({ selection: { screenId: eids.length ? id : null, eids }, gone: false });
}

export async function pickAt(id: string, x: number, y: number, shift: boolean) {
  setActive(id);
  const r = await agentCall<Pick | null>(id, { t: "pick", x, y });
  if (r === undefined) return;
  if (!r) return clearSelection(); // page background
  seedItem(id, r.item);
  const eids = nextSelection(id, r.desc.eid, shift);
  commitSelection(id, eids);
  if (eids.includes(r.desc.eid)) void revealInTree(id, r.desc.chain, r.desc.eid);
}
export function selectRow(id: string, eid: number, shift: boolean) {
  commitSelection(id, nextSelection(id, eid, shift));
  send(id, { t: "reveal", eid }, getState().previews[id]?.docId);
}
export async function navigate(op: "first" | "parent" | "next" | "prev") {
  const sel = getState().selection;
  if (!sel.screenId || !sel.eids.length) return;
  const id = sel.screenId;
  const from = sel.eids[sel.eids.length - 1];
  const r = await agentCall<Pick | null>(id, { t: "nav", eid: from, op });
  const now = getState().selection;
  if (!r || now.screenId !== id || now.eids[now.eids.length - 1] !== from) return; // nothing there, or the user moved on
  seedItem(id, r.item);
  commitSelection(id, [r.desc.eid]);
  send(id, { t: "reveal", eid: r.desc.eid }, getState().previews[id]?.docId);
  void revealInTree(id, r.desc.chain, r.desc.eid);
}

// ---------------------------------------------------------------- layers tree

const inflight = new Map<string, Promise<boolean>>();
function setKids(id: string, parent: number, kids: Tree["kids"][number]) {
  patchTree(id, (t) => ({ ...t, kids: { ...t.kids, [parent]: kids } }));
}
function applyKids(t: Tree, parent: number, nodes: TNode[]): Tree {
  const n = { ...t.nodes };
  const po = { ...t.parentOf };
  nodes.forEach((x) => { n[x.eid] = x; po[x.eid] = parent; });
  return { ...t, nodes: n, parentOf: po, kids: { ...t.kids, [parent]: { status: "loaded", list: nodes.map((x) => x.eid) } } };
}

/** Load the children of a row (0 = body). Deduplicated per row, so collapsing and re-expanding never doubles up. */
export function loadKids(id: string, parent: number): Promise<boolean> {
  const p = getState().previews[id];
  if (!p || p.status !== "ready" || !p.docId) return Promise.resolve(false);
  if (p.tree.kids[parent]?.status === "loaded") return Promise.resolve(true);
  const key = `${id}:${p.docId}:${parent}`;
  const existing = inflight.get(key);
  if (existing) return existing;
  const docId = p.docId;
  setKids(id, parent, { status: "loading", list: p.tree.kids[parent]?.list ?? [] });
  const run = (async () => {
    try {
      const nodes = await request<TNode[]>(id, { t: "children", eid: parent }, docId, 3000);
      if (!current(id, docId)) return false;
      patchTree(id, (t) => applyKids(t, parent, nodes));
      return true;
    } catch (e) {
      if (isCancelled(e) || !current(id, docId)) return false;
      const err = reportOnce(parent === 0 ? "layers" : "layers-row", e, { screenId: id });
      setKids(id, parent, { status: "error", list: [], error: err.message });
      return false;
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, run);
  return run;
}
export function retryKids(id: string, parent: number) {
  patchTree(id, (t) => { const k = { ...t.kids }; delete k[parent]; return { ...t, kids: k }; });
  return loadKids(id, parent);
}
export function toggleExpand(id: string, eid: number) {
  const open = !getState().previews[id]?.tree.expanded[eid];
  patchTree(id, (t) => {
    const ex = { ...t.expanded };
    if (open) ex[eid] = true; else delete ex[eid];
    return { ...t, expanded: ex };
  });
  if (open) void loadKids(id, eid);
}
async function revealInTree(id: string, chain: number[], eid: number) {
  if (getState().search.q) return; // search view shows its own rows; the expanded state is left untouched
  patchTree(id, (t) => { const ex = { ...t.expanded }; chain.forEach((c) => { ex[c] = true; }); return { ...t, expanded: ex }; });
  if (!(await loadKids(id, 0))) return;
  for (const c of chain) if (!(await loadKids(id, c))) return;
  const s = getState();
  if (s.active === id && s.selection.screenId === id) setState({ reveal: { screenId: id, eid, nonce: Date.now() } });
}
export const clearReveal = () => setState({ reveal: null });

function onMutated(id: string, removed: number[], updates: { parent: number; children: TNode[] }[]) {
  setState((s) => {
    const p = s.previews[id];
    if (!p) return {};
    const gone = new Set(removed);
    let t = p.tree;
    if (gone.size) {
      const nodes = { ...t.nodes }, kids = { ...t.kids }, po = { ...t.parentOf }, ex = { ...t.expanded };
      gone.forEach((e) => { delete nodes[e]; delete kids[e]; delete po[e]; delete ex[e]; });
      t = { nodes, kids, parentOf: po, expanded: ex };
    }
    updates.forEach((u) => { if (t.kids[u.parent]?.status === "loaded") t = applyKids(t, u.parent, u.children); });
    const out: Partial<State> = { previews: { ...s.previews, [id]: { ...p, tree: t } } };
    if (gone.size) {
      if (s.selection.screenId === id) {
        const eids = s.selection.eids.filter((e) => !gone.has(e));
        if (eids.length !== s.selection.eids.length) {
          out.selection = eids.length ? { screenId: id, eids } : { screenId: null, eids: [] };
          if (!eids.length) out.gone = true;
        }
      }
      if (s.hover?.screenId === id && gone.has(s.hover.eid)) out.hover = null;
      if (s.items[id]) {
        const it = { ...s.items[id] };
        gone.forEach((e) => delete it[e]);
        out.items = { ...s.items, [id]: it };
      }
    }
    return out;
  });
  if (getState().active === id && (removed.length || updates.length)) rerunSearch();
}

// ---------------------------------------------------------------- search (covers rows that were never loaded)

let searchTimer = 0;
let searchToken = 0;
export function setSearch(q: string) {
  setRegionError("layers", null);
  setState((s) => ({ search: { q, status: q ? "loading" : "idle", nodes: q ? s.search.nodes : null } }));
  window.clearTimeout(searchTimer);
  searchToken++;
  if (q) searchTimer = window.setTimeout(guard("layers", () => ({ screenId: getState().active }), runSearch), 150);
}
export function rerunSearch() {
  if (getState().search.q) void runSearch();
}
export async function runSearch() {
  const s = getState();
  const id = s.active;
  const q = s.search.q;
  const docId = id ? s.previews[id]?.docId ?? null : null;
  if (!id || !q || !docId) return;
  const tok = ++searchToken;
  try {
    const nodes = await request<SNode[]>(id, { t: "search", q }, docId, 3000);
    if (tok !== searchToken || !current(id, docId)) return;
    setState((st) => ({ search: { q: st.search.q, status: "ready", nodes } }));
  } catch (e) {
    if (tok !== searchToken || isCancelled(e) || !current(id, docId)) return;
    handleRegionError("layers", e, { screenId: id });
    setState((st) => ({ search: { ...st.search, status: "idle" } }));
  }
}
export function retrySearch() {
  setRegionError("layers", null);
  void runSearch();
}

// ---------------------------------------------------------------- inspector details (latest selection wins)

let detailsCtl: AbortController | null = null;
function desiredDetails(s: State): { screenId: string; key: string | null } | null {
  if (s.selection.eids.length !== 1 || !s.selection.screenId) return null;
  const it = s.items[s.selection.screenId]?.[s.selection.eids[0]];
  return it?.live ? { screenId: s.selection.screenId, key: it.live.key } : null;
}
let syncingDetails = false;
function syncDetails() {
  if (syncingDetails) return; // our own state writes below notify subscribers again; do not re-enter
  syncingDetails = true;
  try {
    const s = getState();
    const want = desiredDetails(s);
    const d = s.details;
    if (!want || want.key === null) {
      const next = want ? { screenId: want.screenId, key: null } : { screenId: null, key: null };
      if (d.status !== "idle" || d.key !== next.key || d.screenId !== next.screenId) {
        detailsCtl?.abort();
        setState({ details: { ...next, nonce: d.nonce + 1, status: "idle" } });
        setRegionError("details", null);
      }
      return;
    }
    if (want.screenId === d.screenId && want.key === d.key) return;
    startDetails(want.screenId, want.key);
  } finally { syncingDetails = false; }
}
function startDetails(screenId: string, key: string) {
  detailsCtl?.abort();
  const ctl = new AbortController();
  detailsCtl = ctl;
  const nonce = getState().details.nonce + 1;
  setState({ details: { screenId, key, nonce, status: "loading" } });
  setRegionError("details", null);
  const dev = getState().dev;
  if (dev.detailsFail && !dev.sticky) setState((s) => ({ dev: { ...s.dev, detailsFail: false } })); // one request only
  const live = () => !ctl.signal.aborted && getState().details.nonce === nonce;
  if (dev.detailsFail && !dev.sticky) setState((s) => ({ dev: { ...s.dev, detailsFail: false } })); // one-shot unless "sticky"
  fetchElement(key, ctl.signal, { fail: dev.detailsFail, latency: dev.detailsLatency })
    .then((data) => {
      if (!live()) return;
      setState((s) => ({ details: { ...s.details, status: data ? "ready" : "none", data: data ?? undefined } }));
    })
    .catch((e) => {
      if (!live() || isCancelled(e)) return;
      handleRegionError("details", e, { screenId, elementKey: key });
      setState((s) => ({ details: { ...s.details, status: "error" } }));
    });
}
export function retryDetails() {
  const d = getState().details;
  if (d.screenId && d.key) startDetails(d.screenId, d.key);
}

// ---------------------------------------------------------------- keyboard (from the host and forwarded from pages)

export interface KeyInfo { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean; target?: EventTarget | null }
export function onKey(k: KeyInfo, preventDefault: () => void) {
  if (k.ctrlKey || k.metaKey || k.altKey) return;
  const t = k.target as HTMLElement | null | undefined;
  const typing = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  if (k.key === "Escape") return clearSelection();
  if (typing) return;
  if (k.key === "v" || k.key === "V") return setMode("select");
  if (k.key === "i" || k.key === "I") return setMode("interact");
  if (k.key === "0") return fitAll();
  if (k.key === "1") return zoomTo(1);
  if (k.key === "f" || k.key === "F") { const a = getState().active ?? getState().screens.list[0]?.id; if (a) focusScreen(a); return; }
  if (k.key === "+" || k.key === "=") return zoomStep(1);
  if (k.key === "-") return zoomStep(-1);
  const s = getState();
  if (s.mode !== "select" || !s.selection.eids.length) return;
  const onButton = !!t && (t.tagName === "BUTTON" || t.tagName === "A");
  if (k.key === "Enter" && !onButton) { preventDefault(); void navigate(k.shiftKey ? "parent" : "first"); }
  else if (k.key === "Tab") { preventDefault(); void navigate(k.shiftKey ? "prev" : "next"); }
}

// ---------------------------------------------------------------- messages from pages

function dispatch(id: string, m: any) {
  if (m.t === "hello") return onHello(id, m.docId);
  const p = getState().previews[id];
  if (!p || p.docId !== m.docId) return; // from a document that has been replaced
  switch (m.t) {
    case "reply": return resolveReply(m.req, m.data);
    case "bye": return onBye(id, m.docId);
    case "state": return onState(id, m.items);
    case "mutated": return onMutated(id, m.removed, m.updates);
    case "pageError": return onPageError(id, String(m.message));
    case "key": return onKey(m, () => {});
    case "wheelZoom": {
      const r = frameRect(id);
      if (r) zoomAtClient(r.left + m.x * (r.width / PREVIEW_W), r.top + m.y * (r.height / PREVIEW_H), Math.exp(-m.deltaY * 0.0015));
      return;
    }
  }
}
export function onWindowMessage(ev: MessageEvent) {
  const m = ev.data;
  if (!m || m.figr !== 1) return;
  const id = senderOf(ev);
  if (!id) return;
  guard("preview", { screenId: id }, () => dispatch(id, m))();
}
/** Forward a wheel gesture that happened over a preview in Select mode to the page, as a scroll. */
export function scrollPage(id: string, x: number, y: number, dx: number, dy: number) {
  send(id, { t: "scroll", x, y, dx, dy }, getState().previews[id]?.docId);
}

// ---------------------------------------------------------------- dev menu

export function devPageError(id: string) { send(id, { t: "debug", cmd: "throw" }, getState().previews[id]?.docId); }
export function devStallChildren(id: string) { send(id, { t: "debug", cmd: "stallChildren" }, getState().previews[id]?.docId); }
export function devSet(p: Partial<State["dev"]>) { setState((s) => ({ dev: { ...s.dev, ...p } })); }
export function devThrow(kind: "timer" | "click" | "message" | "response", region: "board" | "preview" | "layers" | "inspector", screenId: string | null) {
  const ctx = { screenId: region === "board" ? null : screenId };
  const boom = () => { throw new Error(`Dev menu: simulated error in ${kind} (${region})`); };
  if (kind === "timer") window.setTimeout(guard(region, ctx, boom), 0);
  else if (kind === "click") guard(region, ctx, boom)();
  else if (kind === "message") guard(region, ctx, boom)();
  else void Promise.resolve().then(guard(region, ctx, () => { throw new Error("Dev menu: simulated error when a response arrives (" + region + ")"); }));
}
export { Cancelled };

let started = false;
export function startApp() {
  if (started) return;
  started = true;
  subscribe(syncTracking);
  subscribe(syncDetails);
  window.addEventListener("message", onWindowMessage);
  window.addEventListener("unhandledrejection", (e) => {
    if (isCancelled(e.reason)) return;
    reportOnce("board", e.reason, { screenId: null });
  });
  loadScreens();
}