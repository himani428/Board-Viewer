import { report } from "../report.js";
import { getState, setState } from "./store";
import type { Region } from "./types";

export interface Ctx { screenId: string | null; elementKey?: string }

/** A request that was cancelled or replaced because the user moved on. Never a failure. */
export class Cancelled extends Error {
  constructor(why = "cancelled") { super(why); this.name = "Cancelled"; }
}
export const isCancelled = (e: unknown) =>
  e instanceof Cancelled || (e instanceof DOMException && e.name === "AbortError") || (e as Error)?.name === "AbortError";

const reported = new WeakSet<object>();
const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(typeof e === "string" ? e : JSON.stringify(e)));

export const regionKey = (region: Region, ctx: Ctx, eid?: number) =>
  region === "board" || region === "layers" || region === "inspector" || region === "details"
    ? region
    : `${region}:${ctx.screenId}${eid !== undefined ? ":" + eid : ""}`;

/** Report once per error object, no matter how many handlers it passes through. */
export function reportOnce(region: Region, err: unknown, ctx: Ctx): Error {
  const e = toError(err);
  if (!reported.has(e)) {
    reported.add(e);
    const context: { region: Region; screenId: string | null; elementKey?: string } = { region, screenId: ctx.screenId };
    if (ctx.elementKey !== undefined) context.elementKey = ctx.elementKey;
    report(e, context);
  }
  return e;
}

/** Is the region this error belongs to still there? A late error from a gone region is dropped. */
function alive(region: Region, ctx: Ctx): boolean {
  if ((region === "preview" || region === "layers-row") && ctx.screenId) return !!getState().previews[ctx.screenId];
  return true;
}

export function setRegionError(key: string, message: string | null) {
  const cur = getState().regionErrors[key];
  if (message === null ? cur === undefined : cur === message) return; // nothing changes, nobody is notified
  setState((s) => {
    const next = { ...s.regionErrors };
    if (message === null) delete next[key]; else next[key] = message;
    return { regionErrors: next };
  });
}

/** The single entry point for every failure: report once, show the error in that region only. */
export function handleRegionError(region: Region, err: unknown, ctx: Ctx, eid?: number): Error | null {
  if (isCancelled(err) || !alive(region, ctx)) return null;
  const e = reportOnce(region, err, ctx);
  setRegionError(regionKey(region, ctx, eid), e.message || "Unknown error");
  return e;
}

/** Wrap any callback (event handler, timer, message handler, response handler) so a throw becomes a region error. */
export function guard<A extends unknown[], R>(region: Region, ctx: Ctx | (() => Ctx), fn: (...a: A) => R) {
  return (...a: A): R | undefined => {
    const c = () => (typeof ctx === "function" ? ctx() : ctx);
    try {
      const r = fn(...a);
      if (r && typeof (r as unknown as Promise<unknown>).then === "function") {
        // Return the handled promise so callers can never see (or double-report) the rejection.
        return (r as unknown as Promise<unknown>).catch((e) => { handleRegionError(region, e, c()); }) as unknown as R;
      }
      return r;
    } catch (e) {
      handleRegionError(region, e, c());
      return undefined;
    }
  };
}