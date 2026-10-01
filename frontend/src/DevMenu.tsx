import { useState } from "react";
import { devPageError, devSet, devStallChildren, devThrow, loadScreens, reloadPreview } from "./actions";
import { guard } from "./errors";
import { getState, useStore } from "./store";
import { Btn, C } from "./ui";

/** Dev-only: triggers each failure on demand. Hidden in production builds. */
export function DevMenu() {
  const [open, setOpen] = useState(false);
  const dev = useStore((s) => s.dev);
  const [region, setRegion] = useState<"board" | "preview" | "layers" | "inspector">("layers");
  if (!import.meta.env.DEV) return null;
  const target = () => getState().active ?? getState().screens.list[0]?.id ?? null;
  const run = (fn: (id: string) => void) => guard("board", { screenId: null }, () => { const id = target(); if (id) fn(id); setOpen(false); });
  const item = (label: string, fn: () => void) => <div key={label}><Btn small onClick={guard("board", { screenId: null }, () => { fn(); setOpen(false); })} style={{ width: "100%", textAlign: "left", marginBottom: 4 }}>{label}</Btn></div>;
  return (
    <div style={{ position: "relative" }}>
      <Btn onClick={() => setOpen(!open)} active={open}>Dev</Btn>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 42, zIndex: 100, width: 340, padding: 12, background: C.bg1, color: C.text, border: `1px solid ${C.border}`, borderRadius: 12, boxShadow: "0 20px 50px rgba(0,0,0,.55)" }}>
          <div style={{ fontSize: 11, color: C.muted, marginBottom: 8, lineHeight: 1.5 }}>Simulate failures to see how each region contains them. These buttons act on the active preview (or the first one). Every error appears with a Retry.</div>
          {item("Board: /screens fails, reload board", () => { devSet({ screensFail: true }); loadScreens(); })}
          {item("Preview: page never answers (10s)", () => run((id) => reloadPreview(id, true))())}
          {item("Preview: throw an error inside the page", () => run((id) => devPageError(id))())}
          {item("Layers: render error", () => devSet({ layersThrow: true }))}
          {item("Layers: next row load never answers (3s)", () => run((id) => devStallChildren(id))())}
          {item("Details: next fetch fails", () => devSet({ detailsFail: true }))}
          {item("Inspector: render error", () => devSet({ inspectorThrow: true }))}
          <div style={{ display: "flex", gap: 6, alignItems: "center", margin: "8px 0 4px", fontSize: 12 }}>
            Throw in
            <select value={region} onChange={(e) => setRegion(e.target.value as typeof region)} style={{ font: "inherit", fontSize: 12, background: C.bg2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6 }}>
              <option value="board">board</option><option value="preview">preview</option><option value="layers">layers</option><option value="inspector">inspector</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(["timer", "click", "message", "response"] as const).map((k) => (
              <Btn key={k} small onClick={guard("board", { screenId: null }, () => { devThrow(k, region, target()); setOpen(false); })}>{k}</Btn>
            ))}
          </div>
          <label style={{ display: "block", marginTop: 10, fontSize: 12 }}>
            <input type="checkbox" checked={dev.sticky} onChange={(e) => devSet({ sticky: e.target.checked })} /> Retries fail again (sticky)
          </label>
          <label style={{ display: "block", marginTop: 6, fontSize: 12 }}>
            Details latency{" "}
            <select value={dev.detailsLatency} onChange={(e) => devSet({ detailsLatency: Number(e.target.value) })} style={{ font: "inherit", fontSize: 12, background: C.bg2, color: C.text, border: `1px solid ${C.line}`, borderRadius: 6 }}>
              <option value={0}>none</option><option value={1500}>1.5s</option><option value={4000}>4s</option>
            </select>
          </label>
        </div>
      )}
    </div>
  );
}