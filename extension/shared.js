// AI-generated — to be rewritten by me
// Pure helpers shared by background.js, popup.js and content.js.
// No DOM and no chrome.* APIs in this file, so tests/test_extension_js.py can run it
// with macOS JavaScriptCore (no browser, no Node needed).
//
// Recorder data model ("store"):
//   items:   { id: menu item }  (menu_map.json fields + _label_path for review)
//   chain:   [ids]  the current recorded click path; the next click becomes a child of its last id
//   history: [{created: [ids], chainPushed: bool}]  one entry per click/scan, used by undo
//
// Item ids are a hash of (site + the label path inside the page's menu), e.g. "sjpt.m1x9k2a".
// The same menu entry recorded again on another page gets the same id, so recordings merge.
//
// Guide state (newGuide, pickStep, advanceGuide, guideStatus): see "guide state" below.
(function (root) {
  "use strict";

  const SITES = ["portal", "sjpt", "ecampus", "library"];
  const SITE_BY_HOST = {
    "portal.sejong.ac.kr": "portal",
    "sjpt.sejong.ac.kr": "sjpt",
    "ecampus.sejong.ac.kr": "ecampus",
    "library.sejong.ac.kr": "library",
  };
  const ROOTS = {
    portal: { ko: "세종대학교 포털", en: "Sejong University Portal", url: "https://portal.sejong.ac.kr" },
    sjpt: { ko: "학사정보시스템", en: "Academic Information System (SJPT)", url: "https://sjpt.sejong.ac.kr" },
    ecampus: { ko: "e-Campus", en: "e-Campus", url: "https://ecampus.sejong.ac.kr" },
    library: { ko: "학술정보원", en: "Library", url: "https://library.sejong.ac.kr" },
  };

  // ------------------------------------------------------------------ sites and labels

  function siteForHost(host) {
    return SITE_BY_HOST[String(host || "").toLowerCase()] || null;
  }

  function rootId(site) {
    return site + ".root";
  }

  function isRootId(id) {
    return typeof id === "string" && /\.root$/.test(id);
  }

  function cleanLabel(text) {
    return String(text == null ? "" : text).replace(/\s+/g, " ").trim();
  }

  function hasHangul(text) {
    return /[가-힣ㄱ-ㆎ]/.test(text);
  }

  // Privacy filter. Menu labels are short, generic words. Anything that looks like
  // personal data is refused, and the whole click/path is then dropped.
  const MAX_LABEL_LENGTH = 40;
  function isSafeLabel(label) {
    if (!label || label.length > MAX_LABEL_LENGTH) return false;
    if (/\d{5,}/.test(label)) return false;               // student ids, phone numbers
    if (/[@＠]/.test(label)) return false;                 // e-mail addresses
    if (/님(\s|$|[!,.])/.test(label)) return false;        // "홍길동님 환영합니다" (greeting with a name)
    if (/^[\d\s.,:/()+\-%]+$/.test(label)) return false;   // only numbers: scores, dates, GPA
    if (/^[A-DF][+0-]?$/.test(label)) return false;        // a letter grade like "A+"
    return true;
  }

  // Keep scheme + host + path; drop the #hash, ;jsessionid and query parameters that can
  // identify a person. Returns null for javascript:, mailto:, relative or empty hrefs.
  const SENSITIVE_PARAM = /^(std|stu|student|user|usr|hakbun|sno|stdno|stuno|name|nm|email|mail|phone|tel|token|session|sid|jsessionid|auth|pw|pass)/i;
  function sanitizeUrl(href) {
    const m = /^(https?:\/\/[^/?#]+)([^?#]*)(?:\?([^#]*))?/i.exec(String(href || "").trim());
    if (!m) return null;
    const path = m[2].replace(/;jsessionid=[^/?#]*/gi, "");
    const kept = (m[3] || "").split("&").filter(Boolean).filter((pair) => {
      const eq = pair.indexOf("=");
      const key = eq < 0 ? pair : pair.slice(0, eq);
      const value = eq < 0 ? "" : pair.slice(eq + 1);
      let decoded = value;
      try { decoded = decodeURIComponent(value.replace(/\+/g, " ")); } catch (e) { /* keep raw */ }
      return !SENSITIVE_PARAM.test(key) && !/\d{7,}/.test(decoded) && !/@/.test(decoded);
    });
    return m[1].toLowerCase() + path + (kept.length ? "?" + kept.join("&") : "");
  }

  // ------------------------------------------------------------------ ids

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function stableId(site, labels) {
    return site + ".m" + fnv1a(site + "|" + labels.join(" > ")).toString(36);
  }

  // ------------------------------------------------------------------ store

  function newStore() {
    return { items: {}, chain: [], history: [] };
  }

  function makeRoot(site) {
    const r = ROOTS[site];
    return {
      id: rootId(site), site, name_ko: r.ko, name_en: r.en,
      parent_id: site === "portal" ? null : rootId("portal"),
      url: r.url, selector: null, description: "", keywords: [], _label_path: [],
    };
  }

  function ensureRoots(store, site, created) {
    for (const s of site === "portal" ? ["portal"] : ["portal", site]) {
      if (!store.items[rootId(s)]) {
        store.items[rootId(s)] = makeRoot(s);
        created.push(rootId(s));
      }
    }
  }

  function wouldCycle(store, id, newParent) {
    for (let p = newParent, guard = 0; p && guard < 1000; guard++) {
      if (p === id) return true;
      p = store.items[p] && store.items[p].parent_id;
    }
    return false;
  }

  // Add a new item, or fill the blanks of an existing one. A real parent replaces a
  // site-root parent (a scan only knows "top of this page's menu"; a click path knows more).
  function upsert(store, item, created) {
    const old = store.items[item.id];
    if (!old) {
      store.items[item.id] = item;
      created.push(item.id);
      return;
    }
    for (const field of ["name_ko", "name_en", "url", "selector"]) {
      if (!old[field] && item[field]) old[field] = item[field];
    }
    if (isRootId(old.parent_id) && item.parent_id && !isRootId(item.parent_id) &&
        !wouldCycle(store, old.id, item.parent_id)) {
      old.parent_id = item.parent_id;
    }
  }

  // steps: [{label, selector, url}] from the top of the page's menu down to one entry.
  function itemsFromSteps(site, steps, topParentId) {
    const labels = [];
    const out = [];
    let parent = topParentId;
    for (const step of steps) {
      const label = cleanLabel(step.label);
      labels.push(label);
      const id = stableId(site, labels);
      const korean = hasHangul(label);
      out.push({
        id, site,
        name_ko: korean ? label : "",
        name_en: korean ? "" : label,
        parent_id: parent,
        url: sanitizeUrl(step.url),
        selector: step.selector || null,
        description: "",
        keywords: [],
        _label_path: labels.slice(),
      });
      parent = id;
    }
    return out;
  }

  function stepsAreSafe(steps) {
    return Array.isArray(steps) && steps.length > 0 &&
      steps.every((s) => s && isSafeLabel(cleanLabel(s.label)));
  }

  // One recorded click. The top entry of the clicked menu becomes a child of the
  // previous click (or of the site root when the path is new). Returns {created, clickedId}.
  function applyClick(store, site, steps) {
    if (SITES.indexOf(site) < 0 || !stepsAreSafe(steps)) return { created: [], clickedId: null };
    const created = [];
    ensureRoots(store, site, created);
    const topId = stableId(site, [cleanLabel(steps[0].label)]);
    const last = store.chain[store.chain.length - 1];
    const topParent = store.chain.indexOf(topId) >= 0
      ? (store.items[topId] && store.items[topId].parent_id) || rootId(site)
      : last || rootId(site);
    const items = itemsFromSteps(site, steps, topParent);
    for (const item of items) upsert(store, item, created);
    const clickedId = items[items.length - 1].id;
    const chainPushed = last !== clickedId;
    if (chainPushed) store.chain.push(clickedId);
    store.history.push({ created, chainPushed });
    return { created, clickedId };
  }

  // A menu scan of one frame: every path hangs under the site root. Returns created ids.
  function applyScan(store, site, paths) {
    if (SITES.indexOf(site) < 0) return [];
    const created = [];
    ensureRoots(store, site, created);
    for (const steps of paths || []) {
      if (!stepsAreSafe(steps)) continue;
      for (const item of itemsFromSteps(site, steps, rootId(site))) upsert(store, item, created);
    }
    store.history.push({ created, chainPushed: false });
    return created;
  }

  function undo(store) {
    const last = store.history.pop();
    if (!last) return false;
    for (const id of last.created) delete store.items[id];
    if (last.chainPushed) store.chain.pop();
    store.chain = store.chain.filter((id) => store.items[id]);
    return true;
  }

  // Delete an item and everything below it (so no parent_id points to a missing item).
  function deleteItem(store, id) {
    const doomed = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const item of Object.values(store.items)) {
        if (!doomed.has(item.id) && doomed.has(item.parent_id)) {
          doomed.add(item.id);
          grew = true;
        }
      }
    }
    doomed.forEach((d) => delete store.items[d]);
    store.chain = store.chain.filter((c) => !doomed.has(c));
    return doomed.size;
  }

  function displayName(item) {
    return (item && (item.name_ko || item.name_en)) || "";
  }

  // Rows for the popup's review list (site roots left out).
  function listForReview(store) {
    return Object.values(store.items)
      .filter((item) => !isRootId(item.id))
      .map((item) => {
        const parent = store.items[item.parent_id];
        return {
          id: item.id, site: item.site,
          label: displayName(item),
          path: (item._label_path || []).join(" › ") || displayName(item),
          parent: parent ? displayName(parent) : "",
        };
      })
      .sort((a, b) => a.site.localeCompare(b.site) || a.path.localeCompare(b.path));
  }

  // ------------------------------------------------------------------ export / import

  const FIELDS = ["id", "site", "name_ko", "name_en", "parent_id", "url", "selector", "description", "keywords"];

  function toMenuMap(store) {
    const items = Object.values(store.items).map((item) => {
      const out = {};
      for (const f of FIELDS) out[f] = item[f] === undefined ? (f === "keywords" ? [] : null) : item[f];
      out.description = out.description || "";
      out.keywords = Array.isArray(out.keywords) ? out.keywords : [];
      out._label_path = item._label_path || [];
      return out;
    });
    const ids = new Set(items.map((i) => i.id));
    if (items.some((i) => i.parent_id === rootId("portal")) && !ids.has(rootId("portal"))) {
      items.push(Object.assign(makeRoot("portal"), { _label_path: [] }));
      ids.add(rootId("portal"));
    }
    for (const item of items) {  // never export a dangling parent: fall back to the site root
      if (item.parent_id && !ids.has(item.parent_id)) {
        const siteRoot = rootId(item.site);
        item.parent_id = item.id !== siteRoot && ids.has(siteRoot) ? siteRoot : null;
      }
    }
    const order = (i) => (isRootId(i.id) ? (i.site === "portal" ? 0 : 1) : 2);
    items.sort((a, b) => order(a) - order(b) ||
      SITES.indexOf(a.site) - SITES.indexOf(b.site) ||
      a._label_path.join(" > ").localeCompare(b._label_path.join(" > ")));
    return {
      _comment: "Recorded with the Sejong Navigator extension. Fill in name_ko/name_en where empty, " +
        "description and keywords. _label_path is only for review; the loader ignores it.",
      version: 1,
      items,
    };
  }

  // Merge an exported (or hand-written) menu map back into the store. Returns created ids.
  function mergeMenuMap(store, json) {
    const list = Array.isArray(json) ? json : (json && json.items) || [];
    const created = [];
    for (const raw of list) {
      if (!raw || typeof raw.id !== "string" || SITES.indexOf(raw.site) < 0) continue;
      const item = {};
      for (const f of FIELDS) item[f] = raw[f] === undefined ? null : raw[f];
      item.description = item.description || "";
      item.keywords = Array.isArray(raw.keywords) ? raw.keywords : [];
      item._label_path = Array.isArray(raw._label_path) ? raw._label_path : [];
      upsert(store, item, created);
    }
    store.history.push({ created, chainPushed: false });
    return created;
  }

  // ------------------------------------------------------------------ guide state

  // The active guide, kept in chrome.storage.session ("activeGuide") by background.js.
  // There is ONE guide for the whole browser, so it survives page loads and SSO redirects
  // that open SJPT in a new tab (Chrome does not always tell us which tab opened which).
  //   { route: [items], step, targetId, startedAt }
  // route[0] is the site root and is never highlighted; step is the index the user must click next.
  function newGuide(route, targetId, now) {
    const list = Array.isArray(route) ? route : [];
    const last = list[list.length - 1];
    return {
      route: list,
      step: Math.min(1, Math.max(0, list.length - 1)),
      targetId: targetId || (last && last.id) || null,
      startedAt: now,
    };
  }

  function isGuide(guide) {
    return !!guide && Array.isArray(guide.route) && guide.route.length > 1 && Number.isInteger(guide.step);
  }

  // visible: step indices found on a tab (any frame). Highlight the deepest one; the saved
  // step only moves forward (the user may have gone ahead by themselves), never back.
  //   → { show: index to highlight or -1, step: new saved step }
  function pickStep(guide, visible) {
    const last = guide.route.length - 1;
    const seen = (visible || []).filter((i) => Number.isInteger(i) && i >= 1 && i <= last);
    if (!seen.length) return { show: -1, step: guide.step };
    const deepest = Math.max.apply(null, seen);
    return { show: deepest, step: Math.max(guide.step, deepest) };
  }

  // The user clicked highlighted step `index`. → { guide: updated guide, finished }
  // Clicking the final step finishes the guide. Clicking an earlier one (a parent shown as a
  // hint) never moves the saved step back.
  function advanceGuide(guide, index) {
    const last = guide.route.length - 1;
    if (!Number.isInteger(index) || index < 1 || index > last) return { guide, finished: false };
    if (index === last) return { guide, finished: true };
    const step = Math.min(last, Math.max(guide.step, index + 1));
    return { guide: Object.assign({}, guide, { step }), finished: false };
  }

  // What the side panel says for one tab. view = that tab's "guideView:<tabId>" or null.
  //   → { kind, index }  kind: pending | other-tab | missing | hint | next | here
  function guideStatus(guide, view) {
    const last = guide.route.length - 1;
    if (!view || view.startedAt !== guide.startedAt) return { kind: "pending", index: guide.step };
    if (!view.sejong) return { kind: "other-tab", index: guide.step };
    if (view.shown < 0) return { kind: "missing", index: guide.step };
    if (view.shown === last) return { kind: "here", index: last };
    if (view.shown < guide.step) return { kind: "hint", index: view.shown };
    return { kind: "next", index: view.shown };
  }

  root.SejongShared = Object.freeze({
    SITES, siteForHost, rootId, isRootId, cleanLabel, hasHangul, isSafeLabel, sanitizeUrl,
    stableId, newStore, applyClick, applyScan, undo, deleteItem, displayName, listForReview,
    toMenuMap, mergeMenuMap,
    newGuide, isGuide, pickStep, advanceGuide, guideStatus,
  });
})(globalThis);
