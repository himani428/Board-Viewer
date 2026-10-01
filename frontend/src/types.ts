export type Mode = "select" | "interact";
export type Region = "board" | "preview" | "layers" | "layers-row" | "details" | "inspector";
export interface Screen { id: string; name: string; url: string }
export interface Rect { l: number; t: number; w: number; h: number }
export interface Clip { l: number; t: number; r: number; b: number }
export interface Live {
  name: string; tag: string; id: string | null; classes: string[];
  w: number; h: number; x: number; y: number; text: string; key: string | null;
  color: string; bg: string; fontFamily: string; fontSize: string; fontWeight: string;
  selector?: string;
}
/** What the page last told us about one tracked element. rect is null when it is fully out of view. */
export interface Item { eid: number; name: string; rect: Rect | null; clip: Clip | null; live?: Live }
export interface TNode { eid: number; name: string; tag: string; hasChildren: boolean }
export interface Desc extends TNode { chain: number[] }
export interface SNode extends TNode { parent: number; match: boolean }
export interface Pick { desc: Desc; item: Item | null }

export interface Kids { status: "loading" | "loaded" | "error"; list: number[]; error?: string }
export interface Tree {
  nodes: Record<number, TNode>;
  kids: Record<number, Kids>; // key 0 = children of <body>
  parentOf: Record<number, number>;
  expanded: Record<number, true>;
}
export interface PreviewState {
  status: "connecting" | "ready" | "failed";
  docId: string | null;
  reload: number;
  silent: boolean;
  errors: string[]; // messages of errors thrown inside the page
  tree: Tree;
}
export interface Details {
  screenId: string | null; key: string | null; nonce: number;
  status: "idle" | "loading" | "ready" | "none" | "error";
  data?: { component: string; description: string; status: string; owner: string };
}
export interface Search { q: string; status: "idle" | "loading" | "ready"; nodes: SNode[] | null }
export interface DevFlags {
  screensFail: boolean; detailsFail: boolean; detailsLatency: number;
  layersThrow: boolean; inspectorThrow: boolean; sticky: boolean;
}