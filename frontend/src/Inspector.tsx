import { useState, type ReactNode } from "react";
import { devSet, retryDetails } from "./actions";
import { guard, setRegionError } from "./errors";
import { getState, useStore } from "./store";
import type { Live } from "./types";
import { Btn, C, RegionBoundary, RegionError } from "./ui";

const isColor = (label: string) => label === "Text colour" || label === "Background";
const FIELDS: [string, (l: Live) => string][] = [
  ["Name", (l) => l.name], ["Tag", (l) => l.tag], ["Id", (l) => l.id ?? "-"], ["Classes", (l) => l.classes.join(" ") || "-"],
  ["Size", (l) => `${l.w} x ${l.h} px`], ["Position", (l) => `${l.x}, ${l.y}`], ["Text", (l) => l.text || "-"],
  ["Text colour", (l) => l.color], ["Background", (l) => l.bg], ["Font family", (l) => l.fontFamily],
  ["Font size", (l) => l.fontSize], ["Font weight", (l) => l.fontWeight],
];

function Field({ label, value, swatch }: { label: string; value: ReactNode; swatch?: string }) {
  return (
    <div style={{ display: "flex", gap: 10, padding: "4px 0", fontSize: 12.5 }}>
      <div style={{ width: 88, flexShrink: 0, color: C.muted }}>{label}</div>
      <div style={{ wordBreak: "break-word", minWidth: 0, display: "flex", alignItems: "center", gap: 7, color: C.text }}>
        {swatch && <span style={{ width: 13, height: 13, borderRadius: 4, flexShrink: 0, background: swatch, border: `1px solid ${C.line}` }} />}
        {value}
      </div>
    </div>
  );
}
const H = ({ children }: { children: ReactNode }) => <h3 style={{ margin: "16px 0 6px", fontSize: 11, textTransform: "uppercase", letterSpacing: 1.2, color: C.muted }}>{children}</h3>;
const note = (t: string) => <div style={{ fontSize: 12.5, color: C.muted }}>{t}</div>;

function DetailsBody({ liveKey }: { liveKey: string | null }) {
  const d = useStore((s) => s.details);
  const err = useStore((s) => s.regionErrors.details);
  if (!liveKey) return note("No details");
  if (err || d.status === "error")
    return <RegionError title="Couldn't load details" message={err ?? "Unknown error"} onRetry={guard("details", { screenId: d.screenId, elementKey: liveKey }, () => { setRegionError("details", null); retryDetails(); })} />;
  if (d.key !== liveKey || d.status === "loading" || d.status === "idle") return note("Loading details...");
  if (d.status === "none" || !d.data) return note("No details for this element");
  const chip: Record<string, string> = { stable: C.ok, deprecated: C.warn, experimental: "#4dabf7" };
  return (
    <>
      <Field label="Component" value={d.data.component} />
      <Field label="Description" value={d.data.description} />
      <Field label="Status" value={<span style={{ padding: "1px 9px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, background: C.bg3, color: chip[d.data.status] ?? C.text }}>{d.data.status}</span>} />
      <Field label="Owner" value={d.data.owner} />
    </>
  );
}

function CopyBar({ live }: { live: Live }) {
  const [done, setDone] = useState<string | null>(null);
  const copy = (what: string, text: string) => guard("inspector", { screenId: null }, async () => {
    await navigator.clipboard.writeText(text);
    setDone(what);
    window.setTimeout(() => setDone(null), 1400);
  })();
  const css = [`width: ${live.w}px;`, `height: ${live.h}px;`, `color: ${live.color};`, `background: ${live.bg};`, `font-family: ${live.fontFamily};`, `font-size: ${live.fontSize};`, `font-weight: ${live.fontWeight};`].join("\n");
  return (
    <div style={{ display: "flex", gap: 6, margin: "10px 0 2px", flexWrap: "wrap" }}>
      <Btn small onClick={() => copy("sel", live.selector ?? "")}>{done === "sel" ? "Copied" : "Copy selector"}</Btn>
      <Btn small onClick={() => copy("css", css)}>{done === "css" ? "Copied" : "Copy CSS"}</Btn>
    </div>
  );
}

function InspectorBody() {
  const sel = useStore((s) => s.selection);
  const gone = useStore((s) => s.gone);
  const items = useStore((s) => (s.selection.screenId ? s.items[s.selection.screenId] : undefined));
  const dev = useStore((s) => s.dev);
  const err = useStore((s) => s.regionErrors.inspector);
  if (dev.inspectorThrow) throw new Error("Dev menu: simulated render error in the inspector");
  if (err) return <RegionError title="Couldn't show the inspector" message={err} onRetry={guard("inspector", { screenId: sel.screenId }, () => { setRegionError("inspector", null); if (!getState().dev.sticky) devSet({ inspectorThrow: false }); })} />;

  if (!sel.eids.length)
    return (
      <div style={{ padding: "26px 8px", textAlign: "center", color: C.muted, fontSize: 12.5, lineHeight: 1.6 }}>
        {gone ? <><div style={{ color: C.warn, fontWeight: 600 }}>This element no longer exists</div>The page removed it.</> : <>Select an element to inspect it<div style={{ color: C.dim }}>click in Select mode, or pick a layer</div></>}
      </div>
    );
  const lives = sel.eids.map((e) => items?.[e]?.live).filter((l): l is Live => !!l);
  if (!lives.length) return note("Loading...");
  const multi = sel.eids.length > 1;
  return (
    <>
      {multi ? <div style={{ fontWeight: 700, fontSize: 15 }}>{sel.eids.length} elements</div> : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: C.mono, fontSize: 11.5, padding: "2px 8px", borderRadius: 6, background: C.selSoft, color: "#b9a8ff" }}>{lives[0].tag}</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{lives[0].name}</span>
        </div>
      )}
      {!multi && lives[0].selector && <code style={{ display: "block", marginTop: 8, padding: "6px 9px", borderRadius: 8, background: C.bg0, border: `1px solid ${C.line}`, fontFamily: C.mono, fontSize: 11, color: C.muted, wordBreak: "break-all" }}>{lives[0].selector}</code>}
      {!multi && <CopyBar live={lives[0]} />}
      <H>Live</H>
      {FIELDS.map(([label, get]) => {
        const vals = lives.map(get);
        const same = vals.every((v) => v === vals[0]);
        return <Field key={label} label={label} value={same ? vals[0] : "Mixed"} swatch={same && isColor(label) ? vals[0] : undefined} />;
      })}
      {!multi && (
        <>
          <H>Details</H>
          <RegionBoundary region="details" ctx={{ screenId: sel.screenId, elementKey: lives[0].key ?? undefined }} title="Couldn't show details">
            <DetailsBody liveKey={lives[0].key} />
          </RegionBoundary>
        </>
      )}
    </>
  );
}

export function Inspector() {
  const active = useStore((s) => s.active);
  return (
    <section style={{ display: "flex", flexDirection: "column", height: "46%", minHeight: 0 }}>
      <h2 style={{ margin: 0, padding: "11px 14px", fontSize: 11, letterSpacing: 1.2, textTransform: "uppercase", color: C.muted, borderBottom: `1px solid ${C.border}` }}>Inspector</h2>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 14px", colorScheme: "dark" }}>
        <RegionBoundary region="inspector" ctx={{ screenId: active }} title="Couldn't show the inspector" onRetry={() => { if (!getState().dev.sticky) devSet({ inspectorThrow: false }); }}>
          <InspectorBody />
        </RegionBoundary>
      </div>
    </section>
  );
}