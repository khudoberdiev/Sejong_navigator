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
// Finding items on a page (decodeEntities, labelKey, siteNames, selectorsFor, englishName) and
// guide state (newGuide, pickStep, advanceGuide, korOnlyStep, guideStatus): see below.
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

  // ------------------------------------------------------------------ finding a menu item on the page

  // name_en_site is stored exactly as recorded and may contain entities ("Q&#38;A").
  const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
  function decodeEntities(text) {
    return String(text == null ? "" : text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code) => {
      if (code[0] === "#") {
        const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
      }
      const named = NAMED_ENTITIES[code.toLowerCase()];
      return named === undefined ? whole : named;
    });
  }

  // How labels are compared: entities decoded, whitespace trimmed and collapsed, case ignored.
  function labelKey(text) {
    return cleanLabel(decodeEntities(text)).toLowerCase();
  }

  // Labels the site itself shows for this item: Korean mode and English mode.
  function siteNames(item) {
    const keys = [item && item.name_ko, item && item.name_en_site].map(labelKey).filter(Boolean);
    return keys.filter((k, i) => keys.indexOf(k) === i);
  }

  // CSS selectors to try, in order: desktop layout, then mobile layout. "selector" is the
  // older single-selector format (recorded items). [] means: find the element by its text.
  function selectorsFor(item) {
    return [item && item.selector_desktop, item && item.selector_mobile, item && item.selector]
      .filter((s) => typeof s === "string" && s.trim());
  }

  // Is an element (its own text, its title attribute) labelled as this item, in KOR or ENG mode?
  // Compared with labelKey against name_ko and name_en_site; one may contain the other, because
  // the site sometimes shortens a label ("Academic Information System" for
  // "Academic Information System (SJPT)", title "학사정보시스템" for "학사정보시스템 (SJPT)").
  function labelMatches(item, text, title) {
    const shown = [labelKey(text), labelKey(title)].filter((s) => s.length >= 2);
    return siteNames(item).some((n) => n.length >= 2 &&
      shown.some((s) => s === n || s.indexOf(n) >= 0 || n.indexOf(s) >= 0));
  }

  // A selector matched these elements (DOM order): [{text, title, visible}]. Which one is the item?
  //   1. Elements whose label matches the item (labelMatches); a visible one first. This is what
  //      separates two links that share a selector, e.g. 학사정보시스템 and 일반행정정보시스템
  //      (both #gnb a[href*="doSsoLogin.do"]), in Korean and in English mode alike.
  //   2. No label matches: the matches are kept only if they are all the same entry (same text),
  //      because the site may show a label we did not record. Different labels: ambiguous.
  //   → index into candidates, or -1 (never guess between two different links)
  function pickCandidate(item, candidates) {
    const list = candidates || [];
    const all = list.map((_, i) => i);
    let pool = all.filter((i) => labelMatches(item, list[i].text, list[i].title));
    if (!pool.length) {
      const texts = list.map((c) => labelKey(c.text));
      pool = texts.every((t) => t === texts[0]) ? all : [];
    }
    const visible = pool.filter((i) => list[i].visible);
    return visible.length ? visible[0] : pool.length ? pool[0] : -1;
  }

  // Is a box really on the page? rect: the element's getBoundingClientRect(); clips: the boxes
  // it must stay inside (ancestors that clip overflow, the top/left edge of the document). Each
  // clip may leave a side open (±Infinity). Hidden if what is left is smaller than 1×1 px.
  function boxIsShown(rect, clips) {
    if (!rect || !(rect.width >= 1) || !(rect.height >= 1)) return false;
    let left = rect.left, top = rect.top, right = rect.right, bottom = rect.bottom;
    for (const c of clips || []) {
      left = Math.max(left, c.left); top = Math.max(top, c.top);
      right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
      if (right - left < 1 || bottom - top < 1) return false;
    }
    return true;
  }

  // The highlight frame (content.js draws it as an overlay, content.css styles it) around the
  // target's box, in viewport px: the box grown by `pad` (room between text and frame) plus the
  // `border` width on every side. Nothing is drawn outside this rectangle.
  // glow: scale of the inward glow, 0.35..1. Full size (10 px / 18 px blur) when the inside is
  // at least 60 px on its short side; smaller for a one-line menu link, so the glow from the
  // top and bottom edges never reaches the text in the middle.
  const FRAME_PAD = 4;
  const FRAME_BORDER = 3;
  function frameGeometry(rect, pad, border) {
    const p = pad === undefined ? FRAME_PAD : pad;
    const b = border === undefined ? FRAME_BORDER : border;
    const inside = Math.min(rect.width, rect.height) + 2 * p;
    const glow = Math.max(0.35, Math.min(1, inside / 60));
    return {
      left: rect.left - p - b, top: rect.top - p - b,
      width: rect.width + 2 * (p + b), height: rect.height + 2 * (p + b),
      glow: Math.round(glow * 100) / 100,
    };
  }

  // A tab whose URL is a Sejong site but where no frame answered: the content script is not
  // running there (the extension was reloaded after the page loaded). background.js injects it.
  function contentScriptMissing(url, framesAnswered) {
    const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || "")); // no URL(): keeps this runnable in JSC
    return !!m && !!siteForHost(m[1]) && !framesAnswered;
  }

  // English label users see (breadcrumbs, results, status): label_en from the menu map (the
  // site's own English label, else name_en without a note like "(home)" that only tells our
  // items apart; scripts/build_menu_map.py), else the raw names (recorded items).
  function englishName(item) {
    return cleanLabel(decodeEntities((item && (item.label_en || item.name_en_site || item.name_en)) || ""));
  }

  // ------------------------------------------------------------------ keep-English labels

  // Several menu items can share a Korean label ("예약", "더보기"). entries: [{en, selectors}]
  // for one Korean label; matches(selector) → does the element holding the text match it?
  // An entry with selectors applies only where one of them matches (so "더보기" becomes
  // "More seat status" only on that link); an entry without selectors applies anywhere.
  //   → the English label, or null (leave the site's text alone)
  function pickEnglish(entries, matches) {
    for (const entry of entries || []) {
      const selectors = entry.selectors || [];
      if (!selectors.length) return entry.en;
      if (selectors.some((sel) => { try { return matches(sel); } catch (e) { return false; } })) return entry.en;
    }
    return null;
  }

  // One text node of a clickable element may stand for the whole label when the rest of the
  // element's text is only a badge ("N", "new", a count): "학사정보" in "학사정보 N". Not when
  // the rest is a word: "예약" in "S-Lounge 예약" is half a label (replacing it gave
  // "S-Lounge S-Lounge booking").
  function nodeIsWholeLabel(nodeLabel, ownerLabel) {
    const node = labelKey(nodeLabel);
    const owner = labelKey(ownerLabel);
    if (!node || owner.indexOf(node) < 0) return false;
    const rest = owner.replace(node, "").replace(/\s+/g, "");
    return rest.length <= 3 && !hasHangul(rest);
  }

  // Replace a label's WHOLE text, also when the site split it over several text nodes
  // ("<b>스터디룸</b> 예약"): the first non-empty node gets the English label (its surrounding
  // spaces kept), the others become empty. Never prepends or appends to the site's text.
  //   values: the nodes' current texts → the new texts, same length
  function replaceLabelText(values, english) {
    let placed = false;
    return (values || []).map((v) => {
      const text = String(v == null ? "" : v);
      if (!text.trim()) return text;
      if (placed) return "";
      placed = true;
      return text.replace(/\S[\s\S]*\S|\S/, () => english);
    });
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

  // Sites whose English-mode menu was recorded, so name_en_site null really means "not in the
  // ENG menu". (The library data has no English labels at all: null there means "not recorded".)
  const KOR_ONLY_SITES = ["sjpt"];

  // The step to click next is not on the page at all (not even hidden in a collapsed menu),
  // the page is in English mode, and the item has no English label on the site: it exists only
  // in Korean mode. probes: one per frame, {site, lang: "en"|"ko"|null, visible: [i], hidden: [i]}.
  //   → that step's index, or -1
  function korOnlyStep(guide, probes, shown) {
    const index = guide.step;
    const item = guide.route[index];
    if (!item || item.name_en_site || shown >= index || KOR_ONLY_SITES.indexOf(item.site) < 0) return -1;
    const list = probes || [];
    if (list.some((p) => (p.visible || []).indexOf(index) >= 0 || (p.hidden || []).indexOf(index) >= 0)) return -1;
    return list.some((p) => p.site === item.site && p.lang === "en") ? index : -1;
  }

  // What the side panel says for one tab. view = that tab's "guideView:<tabId>" or null.
  //   → { kind, index }  kind: pending | reload | other-tab | kor-only | other-site | missing | hint | next | here
  //   other-site: the step is on another Sejong site than this tab (view.site)
  //   reload: a Sejong page where the content script could not be injected (view.injectFailed)
  function guideStatus(guide, view) {
    const last = guide.route.length - 1;
    if (!view || view.startedAt !== guide.startedAt) return { kind: "pending", index: guide.step };
    if (view.injectFailed) return { kind: "reload", index: guide.step };
    if (!view.sejong) return { kind: "other-tab", index: guide.step };
    if (Number.isInteger(view.korOnly) && view.korOnly >= 0) return { kind: "kor-only", index: view.korOnly };
    // The step to click is on another Sejong site than this tab (and nothing from here on is
    // visible): say so and offer to open that site; never "not visible on this page".
    const next = guide.route[guide.step];
    if (view.site && next && next.site && next.site !== view.site && view.shown < guide.step) {
      return { kind: "other-site", index: guide.step };
    }
    if (view.shown < 0) return { kind: "missing", index: guide.step };
    if (view.shown === last) return { kind: "here", index: last };
    if (view.shown < guide.step) return { kind: "hint", index: view.shown };
    return { kind: "next", index: view.shown };
  }



  // ------------------------------------------------------------------ same-page steps

  // A URL reduced to what decides "the same page": host + path, with a trailing "/" and a
  // trailing index.do/index.html/... removed, ";jsessionid" dropped, #hash ignored; the query
  // as {name: value}. → {host, path, query} or null (no http(s) URL)
  function pageKey(url) {
    const m = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/i.exec(String(url || "").trim());
    if (!m) return null;
    const path = m[2].replace(/;jsessionid=[^/?#]*/gi, "")
      .replace(/\/index\.(?:do|html?|jsp|php|aspx?)$/i, "/").replace(/\/+$/, "");
    const query = {};
    for (const pair of (m[3] || "").split("&").filter(Boolean)) {
      const eq = pair.indexOf("=");
      query[eq < 0 ? pair : pair.slice(0, eq)] = eq < 0 ? "" : pair.slice(eq + 1);
    }
    return { host: m[1].toLowerCase().replace(/:(?:80|443)$/, ""), path, query };
  }

  // Is the page at pageUrl the page that stepUrl opens? Same host and path (see pageKey). The
  // page's query is ignored (logins add ?token=..., sites add paging), except that parameters
  // the STEP's url names must be there with the same value: board ?id=1 is not board ?id=2.
  function samePage(stepUrl, pageUrl) {
    const a = pageKey(stepUrl);
    const b = pageKey(pageUrl);
    if (!a || !b || a.host !== b.host || a.path !== b.path) return false;
    return Object.keys(a.query).every((k) => b.query[k] === a.query[k]);
  }

  // A link's href attribute that really leads somewhere ("#", "#top", "javascript:..." and an
  // empty href only toggle menus: they never count as "this page").
  function isRealLink(rawHref) {
    const href = String(rawHref || "").trim();
    return !!href && href[0] !== "#" && !/^javascript:/i.test(href);
  }

  // Route steps (index >= 1) whose url is the page the tab is on.
  function stepsOnPage(route, pageUrl) {
    const out = [];
    (route || []).forEach((item, i) => { if (i >= 1 && item && item.url && samePage(item.url, pageUrl)) out.push(i); });
    return out;
  }

  // Steps the student has already done because they are ON that step's page (here: indices
  // from stepsOnPage plus the frames' "highlighted link points here" answers). Everything up to
  // the deepest one is done; the saved step only moves forward.
  //   → { step, finished: true when the target page itself is open, done: deepest index or -1 }
  function skipDoneSteps(guide, here) {
    const last = guide.route.length - 1;
    const seen = (here || []).filter((i) => Number.isInteger(i) && i >= 1 && i <= last);
    const done = seen.length ? Math.max.apply(null, seen) : -1;
    if (done === last) return { step: guide.step, finished: true, done };
    return { step: Math.max(guide.step, done + 1), finished: false, done };
  }

  // ------------------------------------------------------------------ off-screen target

  // The target is outside the part of the page the student sees (above or below the window,
  // or scrolled away inside a scrolling box such as the SJPT menu tree): an orange arrow sits
  // at that edge, at the target's x (clamped), until the target is in view.
  //   rect: the target's highlight-frame box; view: the visible area (the window, cut down to
  //   the scrolling boxes around the target), both in viewport px; size: the arrow's {width, height}.
  //   → null when the target is in view (the frame shows), else {dir: "up"|"down", x, y}
  const ARROW_MARGIN = 8;
  const MIN_SHOWN = 16; // px of the target that must be visible to count as "in view"
  function offscreenArrow(rect, view, size, margin) {
    const m = margin === undefined ? ARROW_MARGIN : margin;
    const shown = Math.min(rect.bottom, view.bottom) - Math.max(rect.top, view.top);
    if (shown >= Math.min(rect.bottom - rect.top, MIN_SHOWN)) return null;
    const dir = rect.top + rect.bottom < view.top + view.bottom ? "up" : "down";
    const center = (rect.left + rect.right) / 2;
    const minX = view.left + m;
    const maxX = Math.max(minX, view.right - size.width - m);
    const x = Math.round(Math.min(Math.max(center - size.width / 2, minX), maxX));
    const y = Math.round(dir === "up" ? view.top + m : Math.max(view.top + m, view.bottom - size.height - m));
    return { dir, x, y };
  }

  // The visible area: the window cut down to each box (the scrolling ancestors' rects). If
  // nothing is left (the scrolling box itself is off screen), the window: scroll the page first.
  function visibleArea(viewport, boxes) {
    const win = { left: 0, top: 0, right: viewport.width, bottom: viewport.height };
    let r = win;
    for (const b of boxes || []) {
      r = { left: Math.max(r.left, b.left), top: Math.max(r.top, b.top), right: Math.min(r.right, b.right), bottom: Math.min(r.bottom, b.bottom) };
    }
    return r.right - r.left >= 1 && r.bottom - r.top >= 1 ? r : win;
  }

  // ------------------------------------------------------------------ answer cards (data/answers.json)

  // Same rules as core/answers.py (tests/test_answers.py runs both on the same questions).
  const ANSWER_STOPWORDS = ["a", "an", "the", "my", "i", "to"];
  function answerTokens(text) {
    return String(text == null ? "" : text).toLowerCase().replace(/['ʻʼ‘’`]/g, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => w && ANSWER_STOPWORDS.indexOf(w) < 0);
  }
  function triggerMatches(trigger, question) {
    const want = answerTokens(trigger);
    const have = answerTokens(question);
    if (want.length && want.every((w) => have.indexOf(w) >= 0)) return true;
    return want.length > 0 && hasHangul(trigger) && have.join("").indexOf(want.join("")) >= 0;
  }
  // rules: the parsed answers.json → the first matching answer, or null
  function answerFor(rules, question) {
    for (const answer of (rules && rules.answers) || []) {
      if ((answer.triggers || []).some((t) => triggerMatches(t, question))) return answer;
    }
    return null;
  }
  // The message key shown when a guide to targetId finishes, or null.
  function doneHint(rules, targetId) {
    return (rules && rules.done_hints && rules.done_hints[targetId]) || null;
  }

  // ------------------------------------------------------------------ sites in the guide

  // A site's name for users (never the internal code). inSentence: the form that follows
  // "is on" / "already in" ("the Portal"); otherwise the bare label ("Portal": buttons, results).
  function siteName(site, t, inSentence) {
    switch (site) {
      case "portal": return inSentence ? t("site_in_portal") : t("site_portal");
      case "sjpt": return inSentence ? t("site_in_sjpt") : t("site_sjpt");
      case "ecampus": return inSentence ? t("site_in_ecampus") : t("site_ecampus");
      case "library": return inSentence ? t("site_in_library") : t("site_library");
      default: return inSentence ? t("site_in_other") : t("site_other");
    }
  }

  // The page a site starts on ("Open Portal" when no tab of it is open).
  function siteHome(site) {
    return ROOTS[site] ? ROOTS[site].url : null;
  }

  function siteOfUrl(url) {
    const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || ""));
    return m ? siteForHost(m[1]) : null;
  }

  // Start where the student IS. route comes from the backend starting at portal.root. If the
  // current site appears later in it, drop the earlier steps on other sites: the step before the
  // first one on this site becomes route[0] (never highlighted), e.g. on the library site
  //   portal → 학생서비스 → 기타 서비스 → 학술정보원 → 세종대학교 학술정보원 → …
  // becomes 학술정보원 → 세종대학교 학술정보원 → …  Unchanged when the route starts on this
  // site or never visits it (then the first step says which site it is on).
  function trimRouteForSite(route, site) {
    const list = Array.isArray(route) ? route : [];
    if (!site || !list.length || list[0].site === site) return list;
    let first = -1;
    for (let i = 1; i < list.length; i++) {
      if (list[i].site === site) { first = i; break; }
    }
    return first > 1 ? list.slice(first - 1) : list;
  }

  // The result is an entry link INTO the site the student is already on (portal.library while
  // on library.sejong.ac.kr): following it would only open the site again.
  function entryOnSite(item, site) {
    return !!item && !!site && item.kind === "entry" && item.entry_for === site;
  }

  // The highlighted step opens another Sejong site in a new tab → that site, else null.
  function newTabSite(route, index) {
    const item = (route || [])[index];
    const next = (route || [])[index + 1];
    return item && next && item.opens_new_tab && next.site && next.site !== item.site ? next.site : null;
  }

  // An open tab on `site` to reuse instead of opening another one: the most recently used,
  // never `excludeTabId` (the tab the click came from). tabs: chrome.tabs.Tab[] → tab or null
  function pickTabForSite(tabs, site, excludeTabId) {
    const candidates = (tabs || []).filter((tab) => tab && tab.id !== excludeTabId && siteOfUrl(tab.url) === site);
    candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    return candidates[0] || null;
  }

  // ------------------------------------------------------------------ UI text (i18n)

  // All UI text lives in _locales/<lang>/messages.json (Chrome's format). i18n.js uses
  // chrome.i18n.getMessage for "Auto", or this formatter over a loaded messages.json when the
  // user picked a language. Same rules as Chrome: "$name$" is replaced by that placeholder's
  // "content", in which "$1".."$9" are the substitutions; "$$" is a literal "$".
  function formatMessage(entry, subs) {
    if (!entry || typeof entry.message !== "string") return "";
    const list = Array.isArray(subs) ? subs : subs === undefined ? [] : [subs];
    const sub = (text) => String(text).replace(/\$(\d)/g, (m, n) => (list[n - 1] === undefined ? "" : String(list[n - 1])));
    const placeholders = {};
    for (const [name, p] of Object.entries(entry.placeholders || {})) placeholders[name.toLowerCase()] = sub(p.content || "");
    return entry.message.replace(/\$\$|\$([a-z0-9_@]+)\$/gi, (m, name) =>
      m === "$$" ? "$" : placeholders[name.toLowerCase()] !== undefined ? placeholders[name.toLowerCase()] : m);
  }

  // → t(key, subs). A key missing from `messages` uses `fallback` (e.g. chrome.i18n, i.e. English);
  // with no fallback it throws, which is what the tests want.
  function makeTranslator(messages, fallback) {
    return (key, subs) => {
      if (messages && messages[key]) return formatMessage(messages[key], subs);
      if (fallback) return fallback(key, subs);
      throw new Error(`missing UI message: ${key}`);
    };
  }

  // ------------------------------------------------------------------ guide text (panel + widget)

  // Menu names stay Korean + English, whatever the UI language.
  function nameOf(item) {
    return (item && (item.name_ko || englishName(item) || item.id)) || "";
  }
  // "학사정보시스템 (SJPT) / Academic Information System (SJPT)": what the page shows in either mode.
  function bothNames(item) {
    return [nameOf(item), englishName(item)].filter((n, i, all) => n && all.indexOf(n) === i).join(" / ");
  }

  // The breadcrumbs: one row per route step. state: "current" (the step to click now, orange),
  // "done" (struck through) or "".
  function crumbsModel(route, highlightIndex, doneBefore) {
    const current = highlightIndex === undefined ? -1 : highlightIndex;
    const done = doneBefore || 0;
    return (route || []).map((item, i) => {
      const english = englishName(item);
      return {
        id: item.id,
        ko: item.name_ko || english || item.id,
        en: item.name_ko && english ? english : "",
        state: i === current ? "current" : i > 0 && i < done ? "done" : "",
      };
    });
  }

  // The status line while a guide runs. info = guideStatus(guide, view). t = translator.
  function guideMessage(guide, info, t) {
    const last = guide.route.length - 1;
    const step = guide.route[guide.step];
    const shown = guide.route[info.index];
    const of = t("step_of", [guide.step, last]);
    // A new tab on a Sejong site: the guide continues there. Elsewhere (libseat): it does not.
    const newTab = (item) => (!item || !item.opens_new_tab ? ""
      : " " + (item.url && !siteOfUrl(item.url) ? t("hint_new_tab_external") : t("hint_new_tab")));
    switch (info.kind) {
      case "here": return t("status_here", [bothNames(shown)]);
      case "next": return t("status_next", [info.index, last, bothNames(shown)]) + newTab(shown);
      case "hint": return t("status_hint", [of, bothNames(shown), bothNames(step)]) + newTab(shown);
      case "kor-only": return t("status_kor_only", [t("kor_only"), nameOf(guide.route[info.index])]);
      // Only plain messages: never mobile_path_note, selectors or other internal fields.
      case "other-site": return t("status_other_site", [of, bothNames(step), siteName(step.site, t, true)]);
      case "missing": return t("status_missing", [of, bothNames(step)]);
      case "reload": return t("status_reload", [t("reload_page"), of, bothNames(step)]);
      case "other-tab": return t("status_other_tab", [of, bothNames(step)]);
      default: return t("status_pending", [of, bothNames(step)]);
    }
  }

  // How the last guide ended (guideLast from background.js), or "" if it did not finish.
  //   already: it was started on the target page itself; hint: a message key for what to do
  //   next where the guide cannot follow (data/answers.json done_hints, e.g. on libseat).
  function finishedMessage(last, t) {
    if (!last || last.outcome !== "finished") return "";
    const done = last.already ? t("already_here", [last.name]) : t("guide_done", [last.name]);
    return last.hint ? done + " " + t(last.hint) : done;
  }

  // The status line when the shown path is NOT the running guide.
  function idleMessage(path, targetId, guide, last, t) {
    if ((path || []).length < 2) return t("no_click_path");
    if (guide) return t("other_guide_running", [nameOf(guide.route[guide.route.length - 1])]);
    if (last && last.targetId === targetId) {
      return last.outcome === "finished" ? finishedMessage(last, t) : t("guide_stopped");
    }
    return "";
  }

  // ------------------------------------------------------------------ floating widget (widget.js)

  // Like Zoom's views: mini (a small pill) → compact (only the click path) → full (everything).
  const WIDGET_MODES = ["mini", "compact", "full"];
  const DEFAULT_WIDGET_MODE = "full";
  //   action: "expand" | "collapse" | "toggle" (toolbar icon: full ↔ mini) | one of WIDGET_MODES
  function widgetMode(mode, action) {
    const i = WIDGET_MODES.indexOf(mode);
    const now = i < 0 ? DEFAULT_WIDGET_MODE : mode;
    const at = WIDGET_MODES.indexOf(now);
    if (WIDGET_MODES.indexOf(action) >= 0) return action;
    if (action === "expand") return WIDGET_MODES[Math.min(at + 1, WIDGET_MODES.length - 1)];
    if (action === "collapse") return WIDGET_MODES[Math.max(at - 1, 0)];
    if (action === "toggle") return now === "full" ? "mini" : "full";
    return now;
  }

  const WIDGET_MARGIN = 8;

  // Keep the widget (top-left pos, size) fully inside the viewport, `margin` px from the edges.
  // A widget bigger than the viewport sticks to the top-left margin.
  function clampWidget(pos, size, viewport, margin) {
    const m = margin === undefined ? WIDGET_MARGIN : margin;
    const maxX = Math.max(m, viewport.width - size.width - m);
    const maxY = Math.max(m, viewport.height - size.height - m);
    const x = Number.isFinite(pos && pos.x) ? pos.x : maxX; // no saved position: bottom-right
    const y = Number.isFinite(pos && pos.y) ? pos.y : maxY;
    return { x: Math.round(Math.min(Math.max(x, m), maxX)), y: Math.round(Math.min(Math.max(y, m), maxY)) };
  }

  function overlapArea(a, b) {
    const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    return w > 0 && h > 0 ? w * h : 0;
  }

  // Where to draw the widget so it never covers the highlighted element.
  //   home: the position the user chose (dragged, saved); target: the highlight frame's box
  //   (viewport px) or null. → { x, y, avoided }
  // If the widget at home overlaps the target (with `margin` to spare), it moves to the corner
  // diagonally opposite the one it is nearest to; if that overlaps too, to the next free corner
  // (horizontal mirror, vertical mirror, its own corner); if all overlap, the least covered one.
  // When the target moves away, it goes back home (home itself is never changed here).
  function placeWidget(home, size, target, viewport, margin) {
    const m = margin === undefined ? WIDGET_MARGIN : margin;
    const at = clampWidget(home, size, viewport, m);
    const box = (p) => ({ left: p.x, top: p.y, right: p.x + size.width, bottom: p.y + size.height });
    if (!target) return { x: at.x, y: at.y, avoided: false };
    const grown = { left: target.left - m, top: target.top - m, right: target.right + m, bottom: target.bottom + m };
    if (!overlapArea(box(at), grown)) return { x: at.x, y: at.y, avoided: false };

    const right = at.x + size.width / 2 > viewport.width / 2;
    const bottom = at.y + size.height / 2 > viewport.height / 2;
    const far = clampWidget({ x: viewport.width, y: viewport.height }, size, viewport, m); // bottom-right
    const corner = (r, b) => ({ x: r ? far.x : m, y: b ? far.y : m });
    const candidates = [corner(!right, !bottom), corner(!right, bottom), corner(right, !bottom), corner(right, bottom)];
    let best = null;
    for (const c of candidates) {
      const area = overlapArea(box(c), grown);
      if (!area) return { x: c.x, y: c.y, avoided: true };
      if (!best || area < best.area) best = { x: c.x, y: c.y, area };
    }
    return { x: best.x, y: best.y, avoided: true };
  }

  root.SejongShared = Object.freeze({
    SITES, siteForHost, rootId, isRootId, cleanLabel, hasHangul, isSafeLabel, sanitizeUrl,
    stableId, newStore, applyClick, applyScan, undo, deleteItem, displayName, listForReview,
    toMenuMap, mergeMenuMap,
    decodeEntities, labelKey, siteNames, selectorsFor, labelMatches, pickCandidate, boxIsShown, englishName,
    pickEnglish, replaceLabelText,
    pageKey, samePage, isRealLink, stepsOnPage, skipDoneSteps,
    ARROW_MARGIN, MIN_SHOWN, offscreenArrow, visibleArea, nodeIsWholeLabel,
    answerTokens, triggerMatches, answerFor, doneHint, finishedMessage,
    FRAME_PAD, FRAME_BORDER, frameGeometry, contentScriptMissing,
    newGuide, isGuide, pickStep, advanceGuide, korOnlyStep, guideStatus,
    formatMessage, makeTranslator, nameOf, bothNames, crumbsModel, guideMessage, idleMessage,
    siteName, siteHome, siteOfUrl, trimRouteForSite, entryOnSite, newTabSite, pickTabForSite,
    WIDGET_MODES, DEFAULT_WIDGET_MODE, WIDGET_MARGIN, widgetMode, clampWidget, placeWidget,
  });
})(globalThis);
