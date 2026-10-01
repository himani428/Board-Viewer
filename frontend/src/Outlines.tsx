import { PREVIEW_H, PREVIEW_W } from "./actions";
import { useStore } from "./store";
import type { Item } from "./types";
import { C } from "./ui";

const LABEL_H = 18; // screen px, constant at every zoom level

function Box({ item, color, px, k }: { item: Item; color: string; px: number; k: number }) {
  const { rect, clip } = item;
  if (!rect || !clip) return null;
  const vis = { l: Math.max(rect.l, clip.l), t: Math.max(rect.t, clip.t), r: Math.min(rect.l + rect.w, clip.r), b: Math.min(rect.t + rect.h, clip.b) };
  if (vis.r <= vis.l || vis.b <= vis.t) return null;
  const lh = LABEL_H / k;
  // Label goes above the visible part of the element, below it when there is no room above inside the preview.
  let top = vis.t - lh;
  if (top < 0) top = vis.b + lh <= PREVIEW_H ? vis.b : vis.t;
  const left = Math.min(Math.max(vis.l, 0), PREVIEW_W - 40 / k);
  return (
    <>
      <div style={{ position: "absolute", left: clip.l, top: clip.t, width: clip.r - clip.l, height: clip.b - clip.t, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: rect.l - clip.l, top: rect.t - clip.t, width: rect.w, height: rect.h, boxSizing: "border-box", border: `${px / k}px solid ${color}` }} />
      </div>
      <div style={{ position: "absolute", left, top, transform: `scale(${1 / k})`, transformOrigin: "left top", height: LABEL_H, lineHeight: `${LABEL_H}px`, padding: "0 6px", fontSize: 11, whiteSpace: "nowrap", background: color, color: color === C.hover ? "#1a1205" : "#fff", fontWeight: 600, borderRadius: 3, fontFamily: C.font }}>
        {item.name}
      </div>
    </>
  );
}

/** Draws in board space (inside the zoomed layer), so it follows pan and zoom with no recomputation. Thickness is divided by zoom. */
export function Outlines({ id }: { id: string }) {
  const mode = useStore((s) => s.mode);
  const k = useStore((s) => s.view.k);
  const items = useStore((s) => s.items[id]);
  const sel = useStore((s) => s.selection);
  const hover = useStore((s) => s.hover);
  if (mode !== "select" || !items) return null;
  const selected = sel.screenId === id ? sel.eids : [];
  const hov = hover && hover.screenId === id ? items[hover.eid] : undefined;
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
      {selected.map((e) => items[e] && <Box key={"s" + e} item={items[e]} color={C.sel} px={2} k={k} />)}
      {hov && <Box key="hover" item={hov} color={C.hover} px={1} k={k} />}
    </div>
  );
}