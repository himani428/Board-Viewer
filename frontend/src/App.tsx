import { useEffect, useState } from "react";
import { Board } from "./Board";
import { DevMenu } from "./DevMenu";
import { Inspector } from "./Inspector";
import { Layers } from "./Layers";
import { fitAll, onKey, resetView, setMode, zoomStep, zoomTo } from "./actions";
import { guard } from "./errors";
import { useStore } from "./store";
import { Btn, C, Kbd, Segmented } from "./ui";

const SHORTCUTS: [string, string][] = [
  ["V / I", "Select mode / Interact mode"],
  ["Click, Shift+click", "Select, add or remove an element"],
  ["Enter / Shift+Enter", "Select first child / parent"],
  ["Tab / Shift+Tab", "Next / previous sibling"],
  ["Esc", "Clear the selection"],
  ["Ctrl or Cmd + wheel", "Zoom the board, anywhere"],
  ["Wheel, drag", "Pan the board (wheel over a page scrolls the page)"],
  ["0  /  1  /  F", "Fit all screens  /  100%  /  focus the active screen"],
  ["+  /  -", "Zoom in / out"],
  ["Arrow keys in Layers", "Move, expand and collapse rows"],
  ["Double-click a screen title", "Zoom to that screen"],
  ["?", "This list"],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(5,6,10,.7)", display: "grid", placeItems: "center", backdropFilter: "blur(4px)" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 460, padding: 22, background: C.bg1, border: `1px solid ${C.line}`, borderRadius: 16, boxShadow: "0 30px 80px rgba(0,0,0,.6)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong style={{ fontSize: 16 }}>Keyboard and mouse</strong>
          <Btn small onClick={onClose}>Close</Btn>
        </div>
        {SHORTCUTS.map(([k, d]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 14, padding: "7px 0", borderTop: `1px solid ${C.line}`, fontSize: 13 }}>
            <span style={{ color: C.muted }}>{d}</span>
            <Kbd>{k}</Kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Floating readout over the board: what mode you are in, what is under the pointer, what is selected. */
function StatusPill({ onHelp }: { onHelp: () => void }) {
  const mode = useStore((s) => s.mode);
  const hover = useStore((s) => s.hover);
  const hoverName = useStore((s) => (s.hover ? s.items[s.hover.screenId]?.[s.hover.eid]?.name : undefined));
  const sel = useStore((s) => s.selection);
  const screenName = useStore((s) => s.screens.list.find((x) => x.id === s.selection.screenId)?.name);
  return (
    <div style={{ position: "absolute", left: 16, bottom: 16, display: "flex", gap: 10, alignItems: "center", padding: "8px 14px", borderRadius: 12, background: "rgba(18,21,28,.88)", border: `1px solid ${C.line}`, backdropFilter: "blur(8px)", fontSize: 12.5, color: C.muted }}>
      <span style={{ width: 8, height: 8, borderRadius: 4, background: mode === "select" ? C.sel : C.ok }} />
      {mode === "select" ? (
        <span>
          <b style={{ color: C.text }}>Select</b>: {hover && hoverName ? <>pointing at <b style={{ color: C.hover }}>{hoverName}</b></> : "click an element to inspect it. Pages do not react."}
        </span>
      ) : (
        <span><b style={{ color: C.text }}>Interact</b>: the pages behave normally. Selection is hidden, not lost.</span>
      )}
      {sel.eids.length > 0 && <span style={{ color: C.text }}>| {sel.eids.length} selected in {screenName}</span>}
      <Btn small onClick={onHelp} title="Shortcuts (?)">Shortcuts</Btn>
    </div>
  );
}

export function App() {
  const mode = useStore((s) => s.mode);
  const k = useStore((s) => s.view.k);
  const [panels, setPanels] = useState(true);
  const [help, setHelp] = useState(false);

  // Capture phase so shortcuts work wherever host focus is. Keys pressed inside a preview arrive as messages instead.
  useEffect(() => {
    const h = guard("board", { screenId: null }, (e: KeyboardEvent) => {
      if (e.key === "?" && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) { setHelp((v) => !v); return; }
      if (e.key === "Escape") setHelp(false);
      onKey({ key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, target: e.target }, () => e.preventDefault());
    });
    window.addEventListener("keydown", h as EventListener, true);
    return () => window.removeEventListener("keydown", h as EventListener, true);
  }, []);

  const ctx = { screenId: null };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: C.font, color: C.text, background: C.bg0 }}>
      <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "0 16px", height: 56, borderBottom: `1px solid ${C.line}`, background: C.bg1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, width: 190 }}>
          <div style={{ width: 24, height: 24, borderRadius: 7, background: `linear-gradient(135deg, ${C.sel}, ${C.hover})` }} />
          <strong style={{ fontSize: 15, letterSpacing: 0.2 }}>Board viewer</strong>
        </div>
        <Segmented
          value={mode}
          onChange={guard("board", ctx, (m: "select" | "interact") => setMode(m))}
          options={[{ value: "select", label: "Select  V", hint: "Click elements to inspect them (V)" }, { value: "interact", label: "Interact  I", hint: "Use the pages normally (I)" }]}
        />
        <span style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Btn small onClick={guard("board", ctx, () => zoomStep(-1))} title="Zoom out (-)">-</Btn>
          <button onClick={guard("board", ctx, () => zoomTo(1))} title="Zoom to 100% (1)" style={{ font: "inherit", fontSize: 12.5, width: 50, background: "transparent", color: C.text, border: 0, cursor: "pointer" }}>{Math.round(k * 100)}%</button>
          <Btn small onClick={guard("board", ctx, () => zoomStep(1))} title="Zoom in (+)">+</Btn>
        </div>
        <Btn onClick={guard("board", ctx, fitAll)} title="Fit every screen (0)">Fit</Btn>
        <Btn onClick={guard("board", ctx, resetView)} title="Back to 40% at the top left">Reset</Btn>
        <Btn onClick={() => setPanels(!panels)} active={panels}>Panels</Btn>
        <DevMenu />
      </header>
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        <main style={{ flex: 1, position: "relative", minWidth: 0 }}>
          <Board />
          <StatusPill onHelp={() => setHelp(true)} />
        </main>
        <aside style={{ width: panels ? 350 : 0, display: "flex", flexDirection: "column", borderLeft: panels ? `1px solid ${C.line}` : "none", background: C.bg1, overflow: "hidden", transition: "width .2s" }}>
          <div style={{ width: 350, display: "flex", flexDirection: "column", height: "100%" }}>
            <Layers />
            <Inspector />
          </div>
        </aside>
      </div>
      {help && <Shortcuts onClose={() => setHelp(false)} />}
    </div>
  );
}