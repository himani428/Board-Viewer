import { Component, type CSSProperties, type ReactNode } from "react";
import { guard, handleRegionError, regionKey, setRegionError, type Ctx } from "./errors";
import type { Region } from "./types";

/** One palette for the whole app: graphite surfaces, one violet accent for selection, orange for hover. */
export const C = {
  bg0: "#0b0d12", bg1: "#12151c", bg2: "#1a1e28", bg3: "#242a38", line: "#262b38", border: "#262b38",
  text: "#e7e9ee", muted: "#8b93a7", dim: "#5c6478",
  sel: "#7c5cff", selSoft: "rgba(124,92,255,.16)", hover: "#ff8a3d",
  ok: "#3ddc97", warn: "#ffc857", err: "#ff6b6b", errBg: "rgba(255,107,107,.10)", errLine: "rgba(255,107,107,.35)",
  font: "'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif", mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
};

export function Btn(p: { children: ReactNode; onClick: () => void; active?: boolean; small?: boolean; title?: string; style?: CSSProperties; disabled?: boolean }) {
  return (
    <button
      title={p.title}
      disabled={p.disabled}
      onClick={p.onClick}
      style={{
        font: "inherit", fontSize: p.small ? 11 : 12.5, fontWeight: 500, padding: p.small ? "3px 9px" : "6px 12px", borderRadius: 8, cursor: "pointer",
        border: `1px solid ${p.active ? C.sel : C.line}`, background: p.active ? C.sel : C.bg2, color: p.active ? "#fff" : C.text,
        transition: "background .15s, border-color .15s", ...p.style,
      }}
    >
      {p.children}
    </button>
  );
}

/** Two or more mutually exclusive options in one pill. */
export function Segmented<T extends string>(p: { value: T; options: { value: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div style={{ display: "inline-flex", padding: 3, gap: 2, background: C.bg0, border: `1px solid ${C.line}`, borderRadius: 11 }}>
      {p.options.map((o) => (
        <button
          key={o.value}
          title={o.hint}
          onClick={() => p.onChange(o.value)}
          style={{
            font: "inherit", fontSize: 12.5, fontWeight: 600, padding: "6px 14px", borderRadius: 8, border: 0, cursor: "pointer",
            background: p.value === o.value ? C.sel : "transparent", color: p.value === o.value ? "#fff" : C.muted,
            boxShadow: p.value === o.value ? "0 2px 10px rgba(124,92,255,.45)" : "none", transition: "all .15s",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const Kbd = ({ children }: { children: ReactNode }) => (
  <kbd style={{ fontFamily: C.mono, fontSize: 11, padding: "1px 6px", borderRadius: 5, background: C.bg3, border: `1px solid ${C.line}`, color: C.text }}>{children}</kbd>
);

/** The one error presentation used by every region: what failed, the real message, and a Retry. */
export function RegionError(p: { title: string; message: string; onRetry: () => void; big?: boolean }) {
  const f = p.big ? 3 : 1;
  return (
    <div role="alert" style={{ padding: 12 * f, color: C.err, background: C.errBg, border: `1px solid ${C.errLine}`, borderRadius: 10 * f, fontSize: 13 * f, fontFamily: C.font }}>
      <div style={{ fontWeight: 600 }}>{p.title}</div>
      <div style={{ margin: `${4 * f}px 0 ${10 * f}px`, color: "#ffc9c9", wordBreak: "break-word", fontSize: 12 * f }}>{p.message}</div>
      <Btn onClick={p.onRetry} style={p.big ? { fontSize: 36, padding: "8px 24px" } : undefined}>Retry</Btn>
    </div>
  );
}

interface BProps { region: Region; ctx: Ctx; title: string; onRetry?: () => void; big?: boolean; children: ReactNode }
/** Contains render errors to one region. The error is reported once and shown here, with a Retry. */
export class RegionBoundary extends Component<BProps, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { handleRegionError(this.props.region, err, this.props.ctx); }
  retry = guard("board", { screenId: null }, () => {
    setRegionError(regionKey(this.props.region, this.props.ctx), null);
    this.props.onRetry?.();
    this.setState({ err: null });
  });
  render() {
    if (this.state.err) return <RegionError title={this.props.title} message={this.state.err.message} onRetry={this.retry} big={this.props.big} />;
    return this.props.children;
  }
}