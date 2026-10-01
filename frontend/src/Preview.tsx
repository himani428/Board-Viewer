import { memo, useCallback, useEffect, useRef, useState } from "react";
import { PREVIEW_H, PREVIEW_W, TITLE_H, armConnect, clearHover, focusScreen, GAP, pickAt, pingPreview, probeAt, reloadPreview } from "./actions";
import { registerFrame } from "./bridge";
import { guard } from "./errors";
import { Outlines } from "./Outlines";
import { useStore } from "./store";
import type { Screen } from "./types";
import { C, RegionBoundary, RegionError } from "./ui";

function PageErrorBadge({ errors }: { errors: string[] }) {
  const [open, setOpen] = useState(false);
  if (!errors.length) return null;
  return (
    <span style={{ position: "relative", marginLeft: 16 }} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <span style={{ fontSize: 22, background: C.err, color: "#2a0a0a", fontWeight: 700, padding: "2px 14px", borderRadius: 999, cursor: "default" }}>Page error</span>
      {open && (
        <div style={{ position: "absolute", left: 0, top: 40, zIndex: 5, width: 520, padding: 12, background: C.bg1, border: `1px solid ${C.line}`, color: C.text, fontFamily: C.mono, fontSize: 20, borderRadius: 10, whiteSpace: "pre-wrap" }}>
          {errors.join("\n")}
        </div>
      )}
    </span>
  );
}

function PreviewBody({ screen }: { screen: Screen }) {
  const id = screen.id;
  const p = useStore((s) => s.previews[id]);
  const mode = useStore((s) => s.mode);
  const err = useStore((s) => s.regionErrors[`preview:${id}`]);
  const overlay = useRef<HTMLDivElement>(null);
  const frameRef = useCallback((el: HTMLIFrameElement | null) => registerFrame(id, el, screen.url), [id, screen.url]);
  useEffect(() => { armConnect(id); }, [id, p?.reload]);
  if (!p) return null;

  const failed = p.status === "failed";
  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * PREVIEW_W) / r.width, y: ((e.clientY - r.top) * PREVIEW_H) / r.height };
  };
  const ctx = { screenId: id };
  const src = screen.url + (p.silent ? "?__silent=1" : "");

  return (
    <>
      <div
        onDoubleClick={guard("preview", ctx, () => focusScreen(id))}
        title="Double-click to focus this screen"
        style={{ height: TITLE_H, fontSize: 26, fontWeight: 600, display: "flex", alignItems: "center", gap: 14, color: C.text, fontFamily: C.font, userSelect: "none" }}
      >
        <span style={{ width: 14, height: 14, borderRadius: 7, background: failed ? C.err : p.status === "ready" ? C.ok : C.warn, boxShadow: `0 0 12px ${failed ? C.err : p.status === "ready" ? C.ok : C.warn}` }} />
        {screen.name}
        <PageErrorBadge errors={p.errors} />
      </div>
      <div style={{ position: "relative", width: PREVIEW_W, height: PREVIEW_H, background: "#fff", borderRadius: 6, overflow: "hidden", boxShadow: "0 0 0 1px rgba(255,255,255,.07), 0 18px 60px rgba(0,0,0,.55)" }}>
        <iframe key={p.reload} ref={frameRef} src={src} title={screen.name} onLoad={guard("preview", ctx, () => pingPreview(id))}
          style={{ width: PREVIEW_W, height: PREVIEW_H, border: 0, display: "block", background: "#fff" }} />
        <Outlines id={id} />
        <div
          ref={overlay}
          data-preview={id}
          onMouseDown={(e) => e.preventDefault()}
          onPointerMove={guard("preview", ctx, (e: React.PointerEvent) => { const { x, y } = toPage(e); probeAt(id, x, y); })}
          onPointerLeave={guard("preview", ctx, () => clearHover())}
          onClick={guard("preview", ctx, (e: React.MouseEvent) => { const { x, y } = toPage(e); void pickAt(id, x, y, e.shiftKey); })}
          style={{ position: "absolute", inset: 0, pointerEvents: mode === "select" && !failed ? "auto" : "none" }}
        />
        {failed && (
          <div style={{ position: "absolute", inset: 0, background: C.bg1, display: "grid", placeItems: "center", padding: 80 }}>
            <div style={{ maxWidth: 900 }}>
              <RegionError big title="Couldn't connect to this preview" message={err ?? "No response from the page"} onRetry={guard("preview", ctx, () => reloadPreview(id))} />
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export const Preview = memo(function Preview({ screen, col, row }: { screen: Screen; col: number; row: number }) {
  const gap = GAP;
  return (
    <div data-screen={screen.id} style={{ position: "absolute", left: col * (PREVIEW_W + gap), top: row * (PREVIEW_H + TITLE_H + gap), width: PREVIEW_W }}>
      <RegionBoundary region="preview" ctx={{ screenId: screen.id }} title="Couldn't connect to this preview" big>
        <PreviewBody screen={screen} />
      </RegionBoundary>
    </div>
  );
});