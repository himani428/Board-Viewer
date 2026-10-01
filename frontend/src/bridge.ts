// Host side of the host <-> page protocol. Knows frames and requests; knows nothing about UI state.
import { Cancelled } from "./errors";

const frames = new Map<string, { el: HTMLIFrameElement; origin: string }>();
interface Pending { screenId: string; resolve: (v: any) => void; reject: (e: Error) => void; timer: number }
const pending = new Map<number, Pending>();
let seq = 1;

export class TimeoutError extends Error {
  constructor(what: string, ms: number) { super(`The page did not answer "${what}" within ${ms / 1000}s`); this.name = "TimeoutError"; }
}

export function registerFrame(screenId: string, el: HTMLIFrameElement | null, url?: string) {
  if (el && url) frames.set(screenId, { el, origin: new URL(url).origin });
  else { frames.delete(screenId); cancelAll(screenId); }
}

/** Identify the sender by window identity and origin; anything else is ignored. */
export function senderOf(ev: MessageEvent): string | null {
  for (const [id, f] of frames) if (f.el.contentWindow === ev.source && f.origin === ev.origin) return id;
  return null;
}

export function frameRect(screenId: string): DOMRect | null {
  return frames.get(screenId)?.el.getBoundingClientRect() ?? null;
}

export function send(screenId: string, msg: Record<string, unknown>, docId?: string | null) {
  const f = frames.get(screenId);
  if (!f?.el.contentWindow) return;
  f.el.contentWindow.postMessage({ figr: 1, ...msg, ...(docId ? { docId } : {}) }, f.origin);
}

export function request<T>(screenId: string, msg: Record<string, unknown>, docId: string | null, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = seq++;
    const timer = window.setTimeout(() => {
      pending.delete(req);
      reject(new TimeoutError(String(msg.t), timeoutMs));
    }, timeoutMs);
    pending.set(req, { screenId, resolve, reject, timer });
    send(screenId, { ...msg, req }, docId);
  });
}

export function resolveReply(req: number, data: unknown) {
  const p = pending.get(req);
  if (!p) return; // late answer for something already timed out or cancelled
  window.clearTimeout(p.timer);
  pending.delete(req);
  p.resolve(data);
}

/** The page was replaced or the preview is gone: everything in flight is cancelled, not failed. */
export function cancelAll(screenId: string) {
  for (const [req, p] of pending) {
    if (p.screenId !== screenId) continue;
    window.clearTimeout(p.timer);
    pending.delete(req);
    p.reject(new Cancelled("page replaced"));
  }
}
