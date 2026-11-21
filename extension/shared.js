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

  // English label for breadcrumbs and the pointer: the site's own English label if it has one.
  function englishName(item) {
    return cleanLabel(decodeEntities((item && (item.name_en_site || item.name_en)) || ""));
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
  //   → { kind, index }  kind: pending | reload | other-tab | kor-only | missing | hint | next | here
  //   reload: a Sejong page where the content script could not be injected (view.injectFailed)
  function guideStatus(guide, view) {
    const last = guide.route.length - 1;
    if (!view || view.startedAt !== guide.startedAt) return { kind: "pending", index: guide.step };
    if (view.injectFailed) return { kind: "reload", index: guide.step };
    if (!view.sejong) return { kind: "other-tab", index: guide.step };
    if (Number.isInteger(view.korOnly) && view.korOnly >= 0) return { kind: "kor-only", index: view.korOnly };
    if (view.shown < 0) return { kind: "missing", index: guide.step };
    if (view.shown === last) return { kind: "here", index: last };
    if (view.shown < guide.step) return { kind: "hint", index: view.shown };
    return { kind: "next", index: view.shown };
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
    const newTab = (item) => (item && item.opens_new_tab ? " " + t("hint_new_tab") : "");
    switch (info.kind) {
      case "here": return t("status_here", [bothNames(shown)]);
      case "next": return t("status_next", [info.index, last, bothNames(shown)]) + newTab(shown);
      case "hint": return t("status_hint", [of, bothNames(shown), bothNames(step)]) + newTab(shown);
      case "kor-only": return t("status_kor_only", [t("kor_only"), nameOf(guide.route[info.index])]);
      case "missing": {
        const note = step && step.mobile_path_note ? " " + t("hint_path_note", [step.mobile_path_note]) : "";
        return t("status_missing", [of, bothNames(step)]) + note;
      }
      case "reload": return t("status_reload", [t("reload_page"), of, bothNames(step)]);
      case "other-tab": return t("status_other_tab", [of, bothNames(step)]);
      default: return t("status_pending", [of, bothNames(step)]);
    }
  }

  // The status line when the shown path is NOT the running guide.
  function idleMessage(path, targetId, guide, last, t) {
    if ((path || []).length < 2) return t("no_click_path");
    if (guide) return t("other_guide_running", [nameOf(guide.route[guide.route.length - 1])]);
    if (last && last.targetId === targetId) {
      return last.outcome === "finished" ? t("guide_done", [last.name]) : t("guide_stopped");
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
    FRAME_PAD, FRAME_BORDER, frameGeometry, contentScriptMissing,
    newGuide, isGuide, pickStep, advanceGuide, korOnlyStep, guideStatus,
    formatMessage, makeTranslator, nameOf, bothNames, crumbsModel, guideMessage, idleMessage,
    WIDGET_MODES, DEFAULT_WIDGET_MODE, WIDGET_MARGIN, widgetMode, clampWidget, placeWidget,
  });
})(globalThis);
