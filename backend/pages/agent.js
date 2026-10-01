// Preview agent. Loaded by every preview page with one <script src="agent.js"> tag.
// It runs inside the page, owns everything that needs the page's DOM, and talks to the
// host only through postMessage. The host never sees a DOM node, only numeric element ids.
(function () {
  "use strict";
  if (window.__figrAgent || window.parent === window) return;
  if (location.search.indexOf("__silent=1") !== -1) return; // dev menu: simulate a dead agent
  window.__figrAgent = true;

  var docId = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var HOST = window.parent;
  var mode = "select";
  var stallNext = false;

  function post(m) {
    m.figr = 1;
    m.docId = docId;
    try { HOST.postMessage(m, "*"); } catch (e) { /* host gone */ }
  }
  function safe(fn) {
    try { return fn(); } catch (e) { post({ t: "pageError", message: "Preview agent: " + (e && e.message ? e.message : String(e)) }); }
  }
  function msgOf(x) { return x && x.message ? x.message : String(x); }

  // ---- page errors (shown as a badge on the preview) ----
  window.addEventListener("error", function (e) { post({ t: "pageError", message: (e.error && e.error.message) || e.message || "Script error" }); });
  window.addEventListener("unhandledrejection", function (e) { post({ t: "pageError", message: msgOf(e.reason) }); });

  // ---- element registry: numeric id <-> node, plus a locator used to re-find a rebuilt node ----
  var nextId = 1;
  var byNode = new WeakMap();
  var byId = new Map(); // id -> { el, loc }
  var loadedParents = new Set(); // parents whose children the host has asked for
  var lastKids = new Map(); // parent id -> signature of the last list sent

  function isRoot(el) { return el === document.body || el === document.documentElement; }
  function unique(attr, val) {
    try { return document.querySelectorAll("[" + attr + '="' + CSS.escape(val) + '"]').length === 1; } catch (e) { return false; }
  }
  function indexOf(el) { return Array.prototype.indexOf.call(el.parentElement.children, el); }
  // Locator: how to find a node again after the page rebuilt it.
  //  - the element's own unique data-key or id: found by that alone;
  //  - a unique data-key on an ancestor: found by key + child-index steps, and the result must have the same
  //    tag, class and data-name as before;
  //  - anything else (an id on an ancestor is NOT enough, a list under it may have gained items): no locator.
  // An element with no locator that is removed is reported as gone. We never match by position alone, so a
  // selection can not jump to a different element.
  function fingerprint(el) { return el.tagName + "|" + (el.getAttribute("class") || "") + "|" + (el.getAttribute("data-name") || ""); }
  function locate(el) {
    var steps = [];
    for (var n = el; n && !isRoot(n); n = n.parentElement) {
      var k = n.getAttribute("data-key");
      if (k && unique("data-key", k)) return { attr: "data-key", val: k, steps: steps.reverse(), fp: fingerprint(el) };
      if (n === el && n.id && unique("id", n.id)) return { attr: "id", val: n.id, steps: [], fp: fingerprint(el) };
      steps.push({ tag: n.tagName, idx: indexOf(n) });
    }
    return null;
  }
  function resolve(loc) {
    if (!loc) return null;
    var list;
    try { list = document.querySelectorAll("[" + loc.attr + '="' + CSS.escape(loc.val) + '"]'); } catch (e) { return null; }
    if (list.length !== 1) return null;
    var cur = list[0];
    for (var i = 0; i < loc.steps.length; i++) {
      var c = cur.children[loc.steps[i].idx];
      if (!c || c.tagName !== loc.steps[i].tag) return null;
      cur = c;
    }
    return fingerprint(cur) === loc.fp ? cur : null;
  }
  function idOf(el) {
    var id = byNode.get(el);
    if (!id) {
      id = nextId++;
      byNode.set(el, id);
      byId.set(id, { el: el, loc: locate(el) });
    }
    return id;
  }
  function elOf(id) {
    if (id === 0) return document.body;
    var r = byId.get(id);
    return r && r.el.isConnected ? r.el : null;
  }

  function nameOf(el) {
    var dn = el.getAttribute("data-name");
    if (dn) return dn;
    var tag = el.tagName.toLowerCase();
    if (el.classList && el.classList.length) return tag + "." + el.classList[0];
    if (el.id) return tag + "#" + el.id;
    return tag;
  }
  function nodeInfo(el) {
    return { eid: idOf(el), name: nameOf(el), tag: el.tagName.toLowerCase(), hasChildren: el.children.length > 0 };
  }
  function describe(el) {
    var d = nodeInfo(el);
    var chain = [];
    for (var p = el.parentElement; p && !isRoot(p); p = p.parentElement) chain.unshift(idOf(p));
    d.chain = chain;
    return d;
  }

  // ---- measuring ----
  function intersect(a, b) {
    return { l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) };
  }
  function measure(el) {
    var r = el.getBoundingClientRect();
    var de = document.documentElement;
    var clip = { l: 0, t: 0, r: de.clientWidth, b: de.clientHeight };
    for (var a = el.parentElement; a && !isRoot(a); a = a.parentElement) {
      var cs = getComputedStyle(a);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        var ar = a.getBoundingClientRect();
        clip = intersect(clip, { l: ar.left + a.clientLeft, t: ar.top + a.clientTop, r: ar.left + a.clientLeft + a.clientWidth, b: ar.top + a.clientTop + a.clientHeight });
      }
    }
    var vis = intersect(clip, { l: r.left, t: r.top, r: r.right, b: r.bottom });
    var empty = (r.width === 0 && r.height === 0) || vis.r <= vis.l || vis.b <= vis.t;
    return { rect: empty ? null : { l: r.left, t: r.top, w: r.width, h: r.height }, clip: empty ? null : clip };
  }
  // A short CSS selector for the element, for the inspector's "Copy selector".
  function selectorOf(el) {
    if (el.id && unique("id", el.id)) return "#" + CSS.escape(el.id);
    var parts = [];
    for (var n = el; n && !isRoot(n); n = n.parentElement) {
      if (n !== el && n.id && unique("id", n.id)) { parts.unshift("#" + CSS.escape(n.id)); break; }
      var s = n.tagName.toLowerCase();
      if (n.classList && n.classList[0]) s += "." + CSS.escape(n.classList[0]);
      var same = n.parentElement ? Array.prototype.filter.call(n.parentElement.children, function (c) { return c.tagName === n.tagName; }) : [];
      if (same.length > 1) s += ":nth-of-type(" + (same.indexOf(n) + 1) + ")";
      parts.unshift(s);
    }
    return parts.join(" > ");
  }
  function live(el, withSelector) {
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    return {
      name: nameOf(el), tag: el.tagName.toLowerCase(), id: el.id || null, classes: Array.prototype.slice.call(el.classList || []),
      w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left + window.scrollX), y: Math.round(r.top + window.scrollY),
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120), key: el.getAttribute("data-key"),
      color: cs.color, bg: cs.backgroundColor, fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight,
      selector: withSelector ? selectorOf(el) : undefined,
    };
  }
  function itemOf(id, withLive) {
    var el = elOf(id);
    if (!el) return null;
    var m = measure(el);
    var it = { eid: id, name: nameOf(el), rect: m.rect, clip: m.clip };
    if (withLive) it.live = live(el, selected.length <= 3);
    return it;
  }

  // ---- tracking loop: reports rects (and live values for selected elements) whenever they change ----
  var hoverEid = null;
  var selected = [];
  var rafOn = false;
  var lastSig = "";
  function tick() {
    rafOn = false;
    if (hoverEid === null && selected.length === 0) { lastSig = ""; return; }
    var items = [];
    var seen = {};
    selected.forEach(function (id) { var it = itemOf(id, true); if (it) { items.push(it); seen[id] = 1; } });
    if (hoverEid !== null && !seen[hoverEid]) { var h = itemOf(hoverEid, false); if (h) items.push(h); }
    var sig = JSON.stringify(items);
    if (sig !== lastSig) { lastSig = sig; post({ t: "state", items: items }); }
    startLoop();
  }
  function startLoop() {
    if (!rafOn) { rafOn = true; requestAnimationFrame(function () { safe(tick); }); }
  }

  // ---- DOM mutations: re-bind rebuilt nodes, report removals and changed child lists ----
  var flushTimer = 0;
  var mo = new MutationObserver(function () {
    if (!flushTimer) flushTimer = setTimeout(function () { flushTimer = 0; safe(flush); }, 40);
  });
  function startObserving() {
    if (document.documentElement) mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-name", "data-key", "class", "id"] });
  }
  function flush() {
    var removed = [];
    byId.forEach(function (rec, id) {
      if (rec.el.isConnected) { rec.loc = locate(rec.el); return; }
      var found = resolve(rec.loc);
      var owner = found ? byNode.get(found) : null;
      if (found && (!owner || owner === id)) { rec.el = found; byNode.set(found, id); rec.loc = locate(found); }
      else removed.push(id);
    });
    removed.forEach(function (id) { byId.delete(id); loadedParents.delete(id); lastKids.delete(id); });
    if (removed.indexOf(hoverEid) !== -1) hoverEid = null;
    selected = selected.filter(function (id) { return removed.indexOf(id) === -1; });
    var updates = [];
    loadedParents.forEach(function (pid) {
      var p = elOf(pid);
      if (!p) return;
      var kids = Array.prototype.map.call(p.children, nodeInfo);
      var sig = JSON.stringify(kids);
      if (lastKids.get(pid) !== sig) { lastKids.set(pid, sig); updates.push({ parent: pid, children: kids }); }
    });
    post({ t: "mutated", removed: removed, updates: updates });
    startLoop();
  }

  // ---- requests from the host ----
  function reply(req, data) { post({ t: "reply", req: req, data: data }); }
  function at(x, y) {
    var el = document.elementFromPoint(x, y);
    return !el || isRoot(el) ? null : el;
  }
  function scrollers(el) {
    var out = [];
    for (var p = el.parentElement; p && !isRoot(p); p = p.parentElement) {
      var cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (p.scrollHeight > p.clientHeight || p.scrollWidth > p.clientWidth)) out.push(p);
    }
    out.push(document.scrollingElement || document.documentElement);
    return out;
  }
  // Bring an element into view by scrolling only scroll containers inside this page.
  function reveal(el) {
    scrollers(el).forEach(function (sc) {
      var r = el.getBoundingClientRect();
      var root = sc === document.scrollingElement || sc === document.documentElement;
      var v;
      if (root) v = { l: 0, t: 0, r: document.documentElement.clientWidth, b: document.documentElement.clientHeight };
      else { var s = sc.getBoundingClientRect(); v = { l: s.left + sc.clientLeft, t: s.top + sc.clientTop, r: s.left + sc.clientLeft + sc.clientWidth, b: s.top + sc.clientTop + sc.clientHeight }; }
      var dy = 0, dx = 0;
      if (r.top < v.t || r.bottom > v.b) dy = r.height <= v.b - v.t ? (r.top + r.bottom) / 2 - (v.t + v.b) / 2 : r.top - v.t;
      if (r.left < v.l || r.right > v.r) dx = r.width <= v.r - v.l ? (r.left + r.right) / 2 - (v.l + v.r) / 2 : r.left - v.l;
      if (dy) sc.scrollTop += dy;
      if (dx) sc.scrollLeft += dx;
    });
  }
  function scrollAt(x, y, dx, dy) {
    var el = document.elementFromPoint(x, y) || document.documentElement;
    var cands = scrollers(el);
    var chain = [el].concat(cands).filter(function (n, i, a) { return a.indexOf(n) === i; });
    for (var i = 0; i < chain.length; i++) {
      var sc = chain[i];
      if (sc !== document.scrollingElement && sc !== document.documentElement) {
        var cs = getComputedStyle(sc);
        if (!/(auto|scroll)/.test(cs.overflowY + cs.overflowX)) continue;
      } else sc = document.scrollingElement || document.documentElement;
      var canY = dy < 0 ? sc.scrollTop > 0 : dy > 0 ? sc.scrollTop + sc.clientHeight < sc.scrollHeight - 1 : false;
      var canX = dx < 0 ? sc.scrollLeft > 0 : dx > 0 ? sc.scrollLeft + sc.clientWidth < sc.scrollWidth - 1 : false;
      if (canY || canX) { sc.scrollTop += dy; sc.scrollLeft += dx; return; }
    }
  }
  function isEditable(t) {
    return !!t && t.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  }

  function handle(m) {
    switch (m.t) {
      case "ping": post({ t: "hello" }); break;
      case "init": case "mode":
        mode = m.mode;
        if (mode === "select" && document.activeElement && document.activeElement.blur) document.activeElement.blur();
        break;
      case "blur": if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); break;
      case "track":
        hoverEid = m.hover;
        selected = m.selected.filter(function (id) { return !!elOf(id); });
        lastSig = "";
        startLoop();
        break;
      case "probe": case "pick": {
        var el = at(m.x, m.y);
        if (!el) return reply(m.req, null);
        var d = describe(el);
        reply(m.req, { desc: d, item: itemOf(d.eid, false) });
        break;
      }
      case "children": {
        if (stallNext) { stallNext = false; return; } // dev menu: never answer
        var p = elOf(m.eid);
        if (!p) return reply(m.req, []);
        loadedParents.add(m.eid);
        var kids = Array.prototype.map.call(p.children, nodeInfo);
        lastKids.set(m.eid, JSON.stringify(kids));
        reply(m.req, kids);
        break;
      }
      case "search": {
        var q = String(m.q).toLowerCase();
        var out = [];
        var keep = new Set();
        var all = document.body.querySelectorAll("*");
        var i, n;
        var matches = [];
        for (i = 0; i < all.length; i++) if (nameOf(all[i]).toLowerCase().indexOf(q) !== -1) matches.push(all[i]);
        matches.forEach(function (mt) { for (n = mt; n && n !== document.body; n = n.parentElement) keep.add(n); });
        var matchSet = new Set(matches);
        for (i = 0; i < all.length && out.length < 5000; i++) {
          if (!keep.has(all[i])) continue;
          var info = nodeInfo(all[i]);
          info.parent = all[i].parentElement === document.body ? 0 : idOf(all[i].parentElement);
          info.match = matchSet.has(all[i]);
          out.push(info);
        }
        reply(m.req, out);
        break;
      }
      case "nav": {
        var cur = elOf(m.eid);
        var res = null;
        if (cur) {
          var par = cur.parentElement;
          if (m.op === "first") res = cur.firstElementChild;
          else if (m.op === "parent") res = par && !isRoot(par) ? par : null;
          else if (par) {
            var sibs = par.children;
            var at0 = Array.prototype.indexOf.call(sibs, cur);
            res = sibs[(at0 + (m.op === "next" ? 1 : sibs.length - 1)) % sibs.length];
          }
        }
        if (!res) return reply(m.req, null);
        var dd = describe(res);
        reply(m.req, { desc: dd, item: itemOf(dd.eid, false) });
        break;
      }
      case "reveal": { var t = elOf(m.eid); if (t) reveal(t); break; }
      case "scroll": scrollAt(m.x, m.y, m.dx, m.dy); break;
      case "debug":
        if (m.cmd === "stallChildren") stallNext = true;
        else if (m.cmd === "throw") setTimeout(function () { throw new Error("Dev menu: simulated error inside the page"); }, 0);
        break;
    }
  }

  window.addEventListener("message", function (ev) {
    if (ev.source !== HOST) return;
    var m = ev.data;
    if (!m || m.figr !== 1) return;
    if (m.docId && m.docId !== docId) return; // addressed to a previous document
    safe(function () { handle(m); });
  });

  // ---- input: keys and Ctrl/Cmd+wheel must reach the host even when this page has focus ----
  window.addEventListener("keydown", function (e) {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    var plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    if (mode === "select") {
      if (plain) { e.preventDefault(); e.stopImmediatePropagation(); }
    } else if (!(plain && !isEditable(e.target) && /^(v|V|i|I|Escape)$/.test(e.key))) return;
    post({ t: "key", key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey });
  }, true);
  window.addEventListener("wheel", function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    post({ t: "wheelZoom", x: e.clientX, y: e.clientY, deltaY: e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY });
  }, { capture: true, passive: false });
  window.addEventListener("pagehide", function () { post({ t: "bye" }); });

  startObserving();
  post({ t: "hello" });
})();