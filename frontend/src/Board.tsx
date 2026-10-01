import { useEffect, useRef } from "react";
import { COLS, PREVIEW_W, clearSelection, loadScreens, panBy, scrollPage, setBoardEl, zoomAtClient } from "./actions";
import { guard } from "./errors";
import { Preview } from "./Preview";
import { useStore } from "./store";
import { C, RegionBoundary, RegionError } from "./ui";

const lineScale = (e: WheelEvent) => (e.deltaMode === 1 ? 16 : 1);

function BoardBody() {
  const screens = useStore((s) => s.screens);
  const err = useStore((s) => s.regionErrors.board);
  const view = useStore((s) => s.view);
  const anim = useStore((s) => s.viewAnim);
  const root = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null);

  // Native, non-passive listener: Ctrl/Cmd+wheel must be able to cancel the browser's own page zoom.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    setBoardEl(el);
    const onWheel = guard("board", { screenId: null }, (e: WheelEvent) => {
      const k = lineScale(e);
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoomAtClient(e.clientX, e.clientY, Math.exp(-e.deltaY * k * 0.0015)); return; }
      const pv = (e.target as Element).closest("[data-preview]") as HTMLElement | null;
      e.preventDefault();
      if (pv) { // Select mode: the wheel over a preview scrolls that page (Interact mode never gets here, the page handles it)
        const r = pv.getBoundingClientRect();
        const s = PREVIEW_W / r.width;
        scrollPage(pv.dataset.preview!, (e.clientX - r.left) * s, (e.clientY - r.top) * s, e.deltaX * k, e.deltaY * k);
      } else panBy(-e.deltaX * k, -e.deltaY * k);
    });
    el.addEventListener("wheel", onWheel as EventListener, { passive: false });
    return () => { el.removeEventListener("wheel", onWheel as EventListener); setBoardEl(null); };
  }, [screens.status, err]);

  if (screens.status === "error" || err)
    return <div style={{ padding: 24, maxWidth: 480 }}><RegionError title="Couldn't load the board" message={err ?? "Unknown error"} onRetry={guard("board", { screenId: null }, loadScreens)} /></div>;
  if (screens.status === "loading") return <div style={{ padding: 24, color: C.muted }}>Loading screens...</div>;

  const ctx = { screenId: null };
  return (
    <div
      ref={root}
      onPointerDown={guard("board", ctx, (e: React.PointerEvent) => {
        if (e.button !== 0 || (e.target as Element).closest("[data-preview]")) return;
        drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
      })}
      onPointerMove={guard("board", ctx, (e: React.PointerEvent) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.x, dy = e.clientY - d.y;
        d.x = e.clientX; d.y = e.clientY; d.moved += Math.abs(dx) + Math.abs(dy);
        if (d.moved > 3) {
          if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); // only once it is really a drag, so double-click on a title still works
          panBy(dx, dy);
        }
      })}
      onPointerUp={guard("board", ctx, () => {
        const d = drag.current;
        drag.current = null;
        if (d && d.moved <= 3) clearSelection(); // a click on empty board space
      })}
      style={{
        position: "absolute", inset: 0, overflow: "hidden", cursor: "grab", touchAction: "none", background: C.bg0,
        backgroundImage: "radial-gradient(circle, #2b3142 1.2px, transparent 1.4px)", backgroundSize: `${28 * view.k}px ${28 * view.k}px`,
        backgroundPosition: `${view.x}px ${view.y}px`, transition: anim ? "background-position .38s cubic-bezier(.2,.8,.2,1), background-size .38s cubic-bezier(.2,.8,.2,1)" : "none",
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transition: anim ? "transform .38s cubic-bezier(.2,.8,.2,1)" : "none" }}>
        {screens.list.map((sc, i) => <Preview key={sc.id} screen={sc} col={i % COLS} row={Math.floor(i / COLS)} />)}
      </div>
    </div>
  );
}

export function Board() {
  return <RegionBoundary region="board" ctx={{ screenId: null }} title="Couldn't draw the board" onRetry={loadScreens}><BoardBody /></RegionBoundary>;
}