// Local: the mock backend on :4000. Deployed: set VITE_API_URL in the host's build settings.
// Forgiving on purpose: a missing https:// or a trailing slash would otherwise turn into a confusing 404.
function normalizeBase(raw: string | undefined): string {
  let v = (raw ?? "").trim();
  if (!v) return "http://localhost:4000";
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  return v.replace(/\/+$/, "");
}
export const API: string = normalizeBase(import.meta.env.VITE_API_URL as string | undefined);
import type { Screen } from "./types";

function qs(params: Record<string, string | number | undefined>) {
  const p = Object.entries(params).filter(([, v]) => v !== undefined && v !== 0 && v !== "");
  return p.length ? "?" + p.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&") : "";
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { throw new Error("The server sent a malformed response"); }
}

export async function fetchScreens(signal: AbortSignal, fail: boolean): Promise<Screen[]> {
  const res = await fetch(`${API}/screens${qs({ fail: fail ? 1 : undefined })}`, { signal });
  if (!res.ok) throw new Error(`Could not load screens (HTTP ${res.status})`);
  const data = await readJson(res);
  if (!Array.isArray(data) || !data.every((s) => s && typeof s.id === "string" && typeof s.name === "string" && typeof s.url === "string"))
    throw new Error("The screens response had an unexpected shape");
  return data as Screen[];
}

export interface ElementDetails { component: string; description: string; status: string; owner: string }

/** Returns null for 404 ("no details"), throws for everything else that is not a good body. */
export async function fetchElement(key: string, signal: AbortSignal, o: { fail: boolean; latency: number }): Promise<ElementDetails | null> {
  const res = await fetch(`${API}/elements/${encodeURIComponent(key)}${qs({ fail: o.fail ? 1 : undefined, latency: o.latency })}`, { signal });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Could not load details (HTTP ${res.status})`);
  const d = (await readJson(res)) as Partial<ElementDetails> | null;
  if (!d || ["component", "description", "status", "owner"].some((f) => typeof (d as Record<string, unknown>)[f] !== "string"))
    throw new Error("The details response had an unexpected shape");
  return d as ElementDetails;
}