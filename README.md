# Board viewer (Figr frontend assignment)

Run it:

```
npm i
npm start
```

This starts the mock backend (API on :4000, pages on :4001) and the app on http://localhost:5173. Node 18+.
`npm run build` type checks and builds. In dev, the toolbar has a **Dev** menu that triggers every failure in R6 on demand.

## Features beyond the brief

Zoom buttons, **Fit** (all screens) and **Reset**; double-click a screen title (or press `F`) to zoom to it; `0` fits all, `1` is 100%, `+`/`-` zoom. A status pill shows the mode, what is under the pointer and the selection size. Inspector extras: copy a CSS selector, copy the element's CSS, colour swatches, status chip. Layers extras: element-kind colour dots, Collapse button, row count. Collapsible side panels, a shortcuts sheet (`?`), and screen status dots on every preview.

## Beyond the brief

Fit (0), 100% (1), zoom in and out (+ and -), focus a screen (F or double-click its title), Collapse all in Layers, a status pill that shows the mode and what is under the pointer, a copyable CSS selector and CSS in the inspector, colour swatches, a shortcuts overlay (?), and a collapsible side panel.

## What was added to the starter kit

- `backend/pages/agent.js` (new): the script that runs inside each preview page.
- `backend/pages/page-*.html` (edited): one `<script src="agent.js">` tag each, inside `<head>`, nothing else changed.
- `frontend/` (new app, React + TypeScript + Vite). `frontend/report.js` is used as given.
- `scripts/start.mjs`, `package.json`: one command to run everything.

## Decisions on ambiguous or conflicting requirements

- **Outlines are drawn by the host, over the iframe, in board space.** Pages are cross-origin, so the host cannot read DOM boxes. The page measures and the host draws inside the zoomed layer, with border width and label scale divided by zoom, so thickness and label size are constant at every zoom level and panning needs no recomputation.
- **Select mode puts a transparent host layer over each preview.** Clicks, focus, forms and links never reach the page. The host asks the page what is under a point (`elementFromPoint`), which also works for disabled buttons, images and SVG. Interact mode removes the layer.
- **Wheel over a preview in Select mode** is forwarded to the page as a scroll that targets the innermost scrollable ancestor that can still move. In Interact mode the page scrolls natively. Ctrl/Cmd+wheel always zooms the board, and the page forwards it because an iframe swallows wheel events.
- **Shortcuts inside an editable field** (input, textarea, select) are ignored for V and I, so typing "v" in a form in Interact mode does not switch modes. Escape always clears the selection.
- **Search and expanded state.** While a search is active, selecting an element in the preview does not expand ancestors in the remembered tree, because clearing the search must restore exactly the earlier expanded state. The search view shows its own rows, always expanded.
- **Active preview** is set by any click in Select mode, including a click on page background (which also clears the selection).
- **Page errors** (the badge) are also failures and are reported once each, with region `preview`.
- **Label placement** uses the visible part of the element (after clipping), above it, or below it when there is no room above inside the preview.
- **Dev flags** apply to the next request only, unless "Retries fail again" is ticked.

## State: what lives where

There are two owners and nothing is shared between them.

**Page (agent.js) owns everything that needs the DOM.** It keeps a registry of numeric element ids to nodes. The host never holds a node, only ids. The agent also owns hit testing, measuring, tree walking, search, sibling/parent/child navigation, and mutation observation.

**Host owns UI state**, in one store (`frontend/src/store.ts`). It is written only by functions in `frontend/src/actions.ts`; components read it and call actions. The bridge (`bridge.ts`) only moves messages and tracks requests. The store holds: screens, board view (x, y, zoom), mode, per-preview runtime (status, document id, page errors, layers tree with expanded rows), active preview, selection (screen + element ids, last is most recent), hover, measured items per preview, search, inspector details, and region errors.

Element ids are per page document, so everything in the host is keyed by `screenId + eid`.

## Host and page protocol

Messages are `postMessage` objects `{ figr: 1, t, docId, ... }`. The host accepts a message only if the sender window is one of its iframes and the origin matches that screen's URL. Every page document generates a random `docId` and sends `hello`. Host to page messages carry the `docId` they are meant for, and the page ignores any other.

| Direction | Messages |
| --- | --- |
| page to host | `hello`, `bye` (pagehide), `reply {req}`, `state` (rects and live values of tracked elements, only when changed), `mutated` (removed ids, changed child lists), `key`, `wheelZoom`, `pageError` |
| host to page | `ping`, `init`/`mode`, `track {hover, selected}`, `probe`/`pick {x,y}`, `children {eid}`, `search {q}`, `nav {eid, op}`, `reveal {eid}`, `scroll`, `blur`, `debug` |

When a side is slow, gone or replaced:

- **Slow page.** Requests have timeouts (3s for children, search, nav, probe). A timeout is a failure in that region. A late reply for something already timed out is dropped.
- **Page never connects.** Each preview has a 10s connect timer, started on mount, reload and `bye`. No `hello` in time gives "Couldn't connect to this preview" with Retry.
- **Page navigates.** `bye` marks the preview as connecting. The new document sends `hello` with a new `docId`. The host cancels every pending request for that preview (cancelled, not failed, nothing reported), clears its selection, hover, items and tree, and sends `init`. The iframe is never remounted, so the board does not reload.
- **Host gone or reloaded.** Messages to a page with no live host go nowhere, and a page started without a parent does not run the agent.
- **Stale messages.** Anything from a `docId` that is no longer current is ignored.
- Hover is coalesced: one probe in flight, newest pointer position wins, and a generation counter discards answers that arrive after the pointer left.

## Identifying elements across re-renders and navigation

Each known element has a locator, refreshed on every DOM mutation:

- its own unique `data-key` or `id`, or
- a unique `data-key` on an ancestor, plus child-index steps below it. The element found must have the same tag, class and `data-name` as before.

When a node is removed, the agent tries its locator. If exactly one matching node exists, the same element id moves onto it, so selection, expanded rows and hover survive a full `innerHTML` rebuild. Otherwise the element is reported as removed and leaves the selection. An `id` on an ancestor is deliberately not enough, because a list under it may have gained items, and position alone is never used, so a selection cannot jump to a different element. Navigation creates a new document and a new id space, so nothing carries over.

## Layers tree

Children load per row on first expand, through one in-flight promise per row, so collapsing and re-expanding cannot create duplicates or gaps. Loading is shown on the row, a 3s timeout shows "Couldn't load" with a Retry on that row only. Selecting in the preview expands the ancestor chain and loads each level in turn (page 5 is 30 levels deep). Expanded rows live in the store per preview. Panel scroll position is remembered per preview, and the panel keeps the first visible rows anchored when rows are added or removed above them. Search runs inside the page over the whole DOM, so never-loaded rows are found.

## Failures

Every failure goes through `handleRegionError` (`errors.ts`): report once per error object (a `WeakSet`, so passing through several catch blocks cannot double report), then show the message in that region with Retry. Every callback (event handlers, timers, message handler, response handlers) is wrapped in `guard`, and every region has an error boundary for render errors. Cancelled and aborted requests are filtered out first. A late error for a region that no longer exists is dropped. A retry that fails creates a new error and a new report.

## Where this breaks

- **Unkeyed elements that are rebuilt.** On page 4, every other feed item has no `data-key`. If such an item (or anything inside it) is selected, the next re-render removes it from the selection, because there is no safe way to know which new node it became. The inspector then says "This element no longer exists". This is the deliberate trade against jumping.
- **Inside a keyed subtree** the element is found by position plus tag, class and `data-name`, so two identical siblings that swap places inside one keyed container could be confused. Verified in a browser.
- **Locator limits.** Inside one keyed subtree, a rebuilt element is found by child position plus tag, class and `data-name`, so if a page swaps two identical siblings inside a keyed subtree between two flushes (40ms), the wrong one could be matched.
- **Clipping.** Outline clipping accounts for scroll and overflow ancestors, but not for `position: fixed/absolute` elements that escape an ancestor's clipping, nor for `clip-path`.
- **Covered elements.** An element partly under the sticky header is outlined in full, over the header.
- **`pointer-events: none` elements** cannot be hovered, because hit testing skips them.
- **Dev-only `__silent=1`** is how the menu simulates a dead agent.
- **`postMessage` target origin** from the page is `*`, because the host origin is not known to the page. The messages carry no secrets.
- **Tested with headless Chromium**: hover, click, disabled buttons, Select/Interact, link navigation, keyboard moves, 30-level expansion, search, multi-select, feed re-renders, wheel and Ctrl+wheel zoom, and every Dev-menu failure (each reported once, contained to its region, Retry works). Not tested in Firefox or Safari.
- **Performance.** 24 live iframes plus a requestAnimationFrame loop only for previews that have a hover or selection. Each state message is a full snapshot of tracked elements; with hundreds of selected elements it would need diffing.
- **No virtualization** in the layers panel. Fine for these pages, not for a 50k node page.

## With another week

Virtualize the layers tree, diff `state` messages, load iframes lazily by viewport, add a real automated test run (Playwright) against the six pages, and add a content fingerprint to locators for unkeyed elements with a confidence threshold.