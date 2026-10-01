import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { clearHover, clearReveal, collapseAll, devSet, hoverRow, retryKids, retrySearch, scrollMem, selectRow, setSearch, toggleExpand } from "./actions";
import { guard, setRegionError } from "./errors";
import { getState, useStore } from "./store";
import type { SNode, TNode, Tree } from "./types";
import { Btn, C, RegionBoundary, RegionError } from "./ui";

type Row =
  | { kind: "node"; eid: number; depth: number; node: TNode; open: boolean; chevron: boolean; parent: number }
  | { kind: "loading"; depth: number; key: string }
  | { kind: "error"; depth: number; parent: number; msg: string; key: string };

function treeRows(t: Tree): Row[] {
  const out: Row[] = [];
  const walk = (parent: number, depth: number) => {
    const k = t.kids[parent];
    if (!k) return;
    for (const eid of k.list) {
      const node = t.nodes[eid];
      if (!node) continue;
      const open = !!t.expanded[eid];
      out.push({ kind: "node", eid, depth, node, open, chevron: node.hasChildren, parent });
      if (open) {
        const kk = t.kids[eid];
        if (!kk || kk.status === "loading") out.push({ kind: "loading", depth: depth + 1, key: "l" + eid });
        else if (kk.status === "error") out.push({ kind: "error", depth: depth + 1, parent: eid, msg: kk.error ?? "", key: "e" + eid });
        else walk(eid, depth + 1);
      }
    }
  };
  walk(0, 0);
  return out;
}
/** Search view: only matches and their ancestors, always expanded. Never touches the remembered expanded state. */
function searchRows(nodes: SNode[]): Row[] {
  const by = new Map<number, SNode[]>();
  nodes.forEach((n) => by.set(n.parent, [...(by.get(n.parent) ?? []), n]));
  const out: Row[] = [];
  const walk = (parent: number, depth: number) => {
    for (const n of by.get(parent) ?? []) {
      out.push({ kind: "node", eid: n.eid, depth, node: n, open: true, chevron: by.has(n.eid), parent });
      walk(n.eid, depth + 1);
    }
  };
  walk(0, 0);
  return out;
}

/** A small coloured dot per kind of element, so the tree can be scanned at a glance. */
function tagColor(tag: string) {
  if (/^(button|input|select|textarea|a|label|form)$/.test(tag)) return "#ff8a3d";
  if (/^(h[1-6]|p|span|strong|em|code|small|li|td|th)$/.test(tag)) return "#4dabf7";
  if (/^(img|svg|canvas|video|picture|path|circle|rect)$/.test(tag)) return "#3ddc97";
  if (/^(script|style|link|meta)$/.test(tag)) return "#5c6478";
  return "#9b8cff";
}

function snapshot(el: HTMLElement) {
  const out: { eid: number; off: number }[] = [];
  for (const r of Array.from(el.querySelectorAll<HTMLElement>("[data-eid]"))) {
    const off = r.offsetTop - el.scrollTop;
    if (off + r.offsetHeight > 0) { out.push({ eid: Number(r.dataset.eid), off }); if (out.length >= 6) break; }
  }
  return out;
}
function ensureVisible(el: HTMLElement, row: HTMLElement) {
  if (row.offsetTop < el.scrollTop) el.scrollTop = row.offsetTop - 8;
  else if (row.offsetTop + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = row.offsetTop + row.offsetHeight - el.clientHeight + 8;
}

function LayersBody() {
  const active = useStore((s) => s.active);
  const preview = useStore((s) => (s.active ? s.previews[s.active] : undefined));
  const search = useStore((s) => s.search);
  const sel = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  const reveal = useStore((s) => s.reveal);
  const regionErr = useStore((s) => s.regionErrors.layers);
  const dev = useStore((s) => s.dev);
  const box = useRef<HTMLDivElement>(null);
  const anchors = useRef<{ eid: number; off: number }[]>([]);
  const prevRows = useRef<unknown>(null);
  if (box.current) anchors.current = snapshot(box.current); // what the user is looking at right now, before this render changes it
  if (dev.layersThrow) throw new Error("Dev menu: simulated render error in the layers panel");

  const searching = search.q !== "";
  const rows = useMemo<Row[]>(() => {
    if (!preview) return [];
    return searching ? (search.nodes ? searchRows(search.nodes) : []) : treeRows(preview.tree);
  }, [preview, searching, search.nodes]);
  const nodeRows = rows.filter((r): r is Extract<Row, { kind: "node" }> => r.kind === "node");
  const selected = new Set(sel.screenId === active ? sel.eids : []);
  let hoverEid: number | null = null;
  if (hover && hover.screenId === active) {
    const vis = new Set(nodeRows.map((r) => r.eid));
    for (const c of [hover.eid, ...[...hover.chain].reverse()]) if (vis.has(c)) { hoverEid = c; break; } // nearest visible ancestor
  }

  useLayoutEffect(() => { // switching preview: restore exactly where that preview was left
    anchors.current = [];
    prevRows.current = null;
    if (box.current) box.current.scrollTop = (active && scrollMem.get(active)) || 0;
  }, [active]);
  useLayoutEffect(() => { // rows added or removed above what the user is looking at must not move it
    const el = box.current;
    if (!el) return;
    if (prevRows.current !== null && prevRows.current !== rows) {
      for (const a of anchors.current) {
        const row = el.querySelector<HTMLElement>(`[data-eid="${a.eid}"]`);
        if (row) { const d = row.offsetTop - el.scrollTop - a.off; if (Math.abs(d) > 0.5) el.scrollTop += d; break; }
      }
    }
    prevRows.current = rows;
  });
  useEffect(() => { // selection made in the preview: show its row
    const el = box.current;
    if (!reveal || !el || reveal.screenId !== active) return;
    const row = el.querySelector<HTMLElement>(`[data-eid="${reveal.eid}"]`);
    if (row) { ensureVisible(el, row); if (active) scrollMem.set(active, el.scrollTop); clearReveal(); }
  }, [reveal, rows, active]);

  const ctx = { screenId: active };
  const onKeyDown = guard("layers", ctx, (e: React.KeyboardEvent) => {
    if (!active || !preview || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const lastSel = sel.screenId === active ? sel.eids[sel.eids.length - 1] : undefined;
    const i = nodeRows.findIndex((r) => r.eid === lastSel);
    const go = (eid: number | undefined) => {
      if (eid === undefined) return;
      selectRow(active, eid, false);
      requestAnimationFrame(() => { const el = box.current, row = el?.querySelector<HTMLElement>(`[data-eid="${eid}"]`); if (el && row) ensureVisible(el, row); });
    };
    const row = nodeRows[i];
    if (e.key === "ArrowDown") go(nodeRows[Math.min(i + 1, nodeRows.length - 1)]?.eid);
    else if (e.key === "ArrowUp") go(nodeRows[Math.max(i - 1, 0)]?.eid);
    else if (!row) return;
    else if (e.key === "ArrowRight") {
      if (searching) { if (nodeRows[i + 1]?.parent === row.eid) go(nodeRows[i + 1].eid); }
      else if (row.chevron && !row.open) toggleExpand(active, row.eid);
      else if (row.open) go(preview.tree.kids[row.eid]?.list[0]);
    } else if (e.key === "ArrowLeft") {
      if (!searching && row.open) toggleExpand(active, row.eid);
      else if (row.parent !== 0) go(row.parent);
    }
  });

  const total = rows.filter((r) => r.kind === "node").length;
  if (regionErr)
    return <div style={{ padding: 12 }}><RegionError title="Couldn't load layers" message={regionErr} onRetry={guard("layers", ctx, () => { if (search.q) retrySearch(); else setRegionError("layers", null); if (!getState().dev.sticky) devSet({ layersThrow: false }); })} /></div>;

  const rootKids = preview?.tree.kids[0];
  let body;
  if (!active || !preview) body = <div style={{ padding: "28px 18px", color: C.muted, textAlign: "center", fontSize: 12.5, lineHeight: 1.6 }}>
      <div style={{ fontSize: 26, marginBottom: 6, color: C.dim }}>[ ]</div>Click something in a preview<div style={{ color: C.dim }}>its layers appear here</div>
    </div>;
  else if (rootKids?.status === "error")
    body = <div style={{ padding: 12 }}><RegionError title="Couldn't load layers" message={rootKids.error ?? ""} onRetry={guard("layers", ctx, () => { void retryKids(active, 0); })} /></div>;
  else if (!rootKids || rootKids.status === "loading" || (searching && !search.nodes)) body = <div style={{ padding: 12, color: C.muted }}>{searching ? "Searching..." : "Loading..."}</div>;
  else if (!rows.length) body = <div style={{ padding: 12, color: C.muted }}>{searching ? "No matches" : "Empty page"}</div>;
  else
    body = rows.map((r) => {
      const pad = 10 + r.depth * 14;
      if (r.kind === "loading") return <div key={r.key} style={{ paddingLeft: pad + 18, height: 26, lineHeight: "26px", color: C.muted, fontSize: 12 }}>Loading...</div>;
      if (r.kind === "error")
        return (
          <div key={r.key} style={{ paddingLeft: pad + 18, minHeight: 24, display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: C.err }} title={r.msg}>
            Couldn't load <Btn small onClick={guard("layers-row", ctx, () => { void retryKids(active, r.parent); })}>Retry</Btn>
          </div>
        );
      return (
        <div
          key={r.eid}
          data-eid={r.eid}
          onMouseEnter={guard("layers", ctx, () => hoverRow(active, r.eid))}
          onMouseLeave={guard("layers", ctx, () => clearHover())}
          onClick={guard("layers", ctx, (e: React.MouseEvent) => selectRow(active, r.eid, e.shiftKey))}
          style={{ display: "flex", alignItems: "center", height: 26, paddingLeft: pad, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", color: C.text,
            background: selected.has(r.eid) ? C.selSoft : hoverEid === r.eid ? C.bg2 : "transparent", boxShadow: selected.has(r.eid) ? `inset 2px 0 0 ${C.sel}` : "none" }}
        >
          <span
            onClick={guard("layers", ctx, (e: React.MouseEvent) => { e.stopPropagation(); if (!searching && r.chevron) toggleExpand(active, r.eid); })}
            style={{ width: 18, textAlign: "center", color: C.muted, fontFamily: C.mono, fontSize: 11 }}
          >
            {r.chevron ? (r.open ? "v" : ">") : ""}
          </span>
          <span style={{ width: 7, height: 7, borderRadius: 4, background: tagColor(r.node.tag), marginRight: 8, flexShrink: 0 }} />
          {r.node.name}
        </div>
      );
    });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ padding: 10, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={search.q}
          onChange={guard("layers", ctx, (e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value))}
          placeholder="Search layers"
          style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "7px 10px", font: "inherit", fontSize: 12.5, border: `1px solid ${C.line}`, borderRadius: 8, background: C.bg0, color: C.text, outline: "none" }}
        />
        {!searching && active && (
          <Btn small title="Collapse every row" onClick={guard("layers", ctx, () => collapseAll(active))}>Collapse</Btn>
        )}
      </div>
      <div
        ref={box}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onScroll={guard("layers", ctx, (e: React.UIEvent<HTMLDivElement>) => { if (active) scrollMem.set(active, e.currentTarget.scrollTop); })}
        style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative", outline: "none", overflowAnchor: "none", colorScheme: "dark" }}
      >
        {body}
      </div>
      {active && preview && rootKids?.status === "loaded" && (
        <div style={{ padding: "5px 12px", fontSize: 11, color: C.dim, borderTop: `1px solid ${C.line}` }}>{total} {searching ? "matching rows" : "rows loaded"}</div>
      )}
    </div>
  );
}

export function Layers() {
  const active = useStore((s) => s.active);
  return (
    <section style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1, overflow: "hidden", borderBottom: `1px solid ${C.border}` }}>
      <h2 style={{ margin: 0, padding: "11px 14px", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted, borderBottom: `1px solid ${C.border}` }}>Layers</h2>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <RegionBoundary region="layers" ctx={{ screenId: active }} title="Couldn't draw the layers panel" onRetry={() => { if (!getState().dev.sticky) devSet({ layersThrow: false }); }}>
          <LayersBody />
        </RegionBoundary>
      </div>
    </section>
  );
}