// AI-generated — to be rewritten by me
// Runs in every frame (all_frames) of the four Sejong sites. Two features:
//
// RECORDER: reads ONLY navigation menu entries: their label, a CSS selector, the link,
//   and their nesting (parent → child). It never reads page content, form values,
//   tables/grids or anything outside the clicked/scanned menu element, and every label
//   goes through SejongShared.isSafeLabel (no ids, names, e-mails, scores).
//     * scan  – on request: walk the page's menu containers (nav, [role=menu], *menu*, gnb/lnb ...)
//     * click – while recording: each click on a menu-like element is one step of a path
//
// GUIDE: reports which steps of the active route are in this frame, visible or hidden
//   (by selector_desktop / selector_mobile, else by the exact Korean / English site label), and
//   whether the page is in English or Korean mode. Highlights the step background.js picks with
//   an orange frame drawn as an overlay (no label on the page; the step text is in the panel).
//   On every page load it asks background.js for the active guide (kept in
//   chrome.storage.session), so the highlight comes back after navigation and in new tabs.
//   A click on the highlighted element advances the guide to the next step.
//   SJPT (WebSquare): the left menu is a collapsible tree in the main document (its "wframes"
//   are not iframes). Its nodes are found by treenodevalue codes, the same in KOR and ENG mode.
//
// KEEP-ENGLISH: after every page load (and whenever the menu changes) replaces Korean menu
//   labels that are in the menu map with their English name. Hover shows the Korean original.
//   Paused while recording, so recordings keep the real Korean labels.
//
// POP-UP TRANSLATION: a MutationObserver (in every frame) notices modal pop-ups; page_hook.js
//   reports alert()/confirm() texts. The top frame translates Korean → English ON THIS
//   COMPUTER (Chrome's built-in Translator API, or a self-hosted LibreTranslate) and shows
//   an overlay. Nothing is sent to a third-party service.
(() => {
  // One live copy per frame. Injected twice (about:blank frames, or background.js injecting
  // while the manifest's copy is running): the second one stops here. After the extension is
  // reloaded, the copy in an already-open tab is orphaned (its chrome.runtime is gone) and
  // background.js injects a fresh one: the fresh one takes over and stops the orphan.
  const previous = window.__sejongNavigator;
  if (previous && typeof previous.alive === "function" && previous.alive()) return;
  if (previous && typeof previous.shutdown === "function") {
    try { previous.shutdown(); } catch (e) { /* orphan already half gone */ }
  }
  let dead = false;
  const instance = {
    alive: () => { try { return !dead && !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; } },
    shutdown: () => { dead = true; }, // replaced below, once everything it stops exists
  };
  window.__sejongNavigator = instance;

  const S = globalThis.SejongShared;
  const hostname = location.hostname || (self.origin && self.origin !== "null" ? new URL(self.origin).hostname : "");
  const SITE = S.siteForHost(hostname);
  if (!SITE) return;

  // Leftovers in the page from an earlier copy: its highlight frame, and the old design's
  // label bubble and the class it put on the site's element.
  for (const old of document.querySelectorAll("sejong-nav-frame, #sejong-nav-pointer")) old.remove();
  for (const old of document.querySelectorAll(".sejong-nav-highlight")) old.classList.remove("sejong-nav-highlight");

  const ITEM = "li, [role=treeitem], [role=menuitem]";
  const STRONG_CLICKABLE = "a, button, [role=menuitem], [role=treeitem], [role=tab], [role=link], [onclick]";
  const MENU_CONTAINERS = [
    "nav", "[role=navigation]", "[role=menubar]", "[role=menu]", "[role=tree]",
    "[id*=menu i]", "[class*=menu i]", "[id*=nav i]", "[class*=nav i]",
    "[id*=gnb i]", "[class*=gnb i]", "[id*=lnb i]", "[class*=lnb i]", "[id*=snb i]", "[class*=snb i]",
  ].join(",");
  // Never record from these, even when clicked while recording.
  const NEVER = "input, textarea, select, [contenteditable=''], [contenteditable=true], [role=grid], [role=table], [class*=grid i]";
  // Header boxes that show the logged-in user. Skipped by the scan.
  const USER_AREA = "[id*=user i], [class*=user i], [id*=login i], [class*=login i], [id*=profile i], [class*=profile i], [id*=member i], [class*=member i]";
  const MAX_SCAN_PATHS = 600;

  // ---------------------------------------------------------------- menu structure

  // The label of a menu entry. For an <li> it is the li's own text, not its submenu's.
  function labelOf(el) {
    if (!el.matches(ITEM)) return { label: S.cleanLabel(el.textContent), el };
    for (const child of el.children) {
      if (child.matches("ul, ol") || child.querySelector(ITEM)) continue;
      const label = S.cleanLabel(child.textContent);
      if (label) {
        const link = child.matches("a, button") ? child : child.querySelector("a, button") || child;
        return { label, el: link };
      }
    }
    const ownText = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(" ");
    return { label: S.cleanLabel(ownText), el };
  }

  function linkOf(el) {
    const a = el.closest("a[href]") || (el.querySelector && el.querySelector("a[href]"));
    return a ? S.sanitizeUrl(a.href) : null;
  }

  function isStableId(id) {
    return id && !/\d{3,}/.test(id); // ids like "mf_gen_1234" change between page loads
  }

  function cssSelector(el) {
    const esc = CSS.escape;
    const unique = (sel) => {
      try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
    };
    if (isStableId(el.id) && unique("#" + esc(el.id))) return "#" + esc(el.id);
    for (const attr of ["data-menu-id", "data-menuid", "data-menu", "data-id", "menuid", "menu_id", "data-menu-cd", "data-pgm-id"]) {
      const value = el.getAttribute(attr);
      const sel = value && `${el.localName}[${attr}="${esc(value)}"]`;
      if (sel && unique(sel)) return sel;
    }
    const href = el.localName === "a" && el.getAttribute("href");
    // only when the link carries nothing personal (sanitizing would not change it)
    if (href && href !== "#" && !/^javascript:/i.test(href) && S.sanitizeUrl(el.href) === el.href.split("#")[0]) {
      const sel = `a[href="${esc(href)}"]`;
      if (unique(sel)) return sel;
    }
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.documentElement && parts.length < 8; node = node.parentElement) {
      if (isStableId(node.id) && unique("#" + esc(node.id))) {
        parts.unshift("#" + esc(node.id));
        break;
      }
      let part = node.localName;
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.localName === node.localName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
    }
    return parts.join(" > ");
  }

  // [{label, selector, url}] from the top of the menu down to el, following nested li/treeitems.
  function domSteps(el) {
    const own = labelOf(el);
    const steps = [{ label: own.label, selector: cssSelector(own.el), url: linkOf(own.el) }];
    let item = el.closest(ITEM);
    for (let depth = 0; item && depth < 10; depth++) {
      const parentItem = item.parentElement && item.parentElement.closest(ITEM);
      if (!parentItem) break;
      const parentLabel = labelOf(parentItem);
      if (!parentLabel.label) break;
      steps.unshift({ label: parentLabel.label, selector: cssSelector(parentLabel.el), url: linkOf(parentLabel.el) });
      item = parentItem;
    }
    return steps;
  }

  function safe(steps) {
    return steps.length > 0 && steps.every((s) => S.isSafeLabel(s.label));
  }

  // ---------------------------------------------------------------- recorder: scan

  function scanMenus() {
    const containers = [...document.querySelectorAll(MENU_CONTAINERS)]
      .filter((c) => !c.closest(USER_AREA) && !c.closest(NEVER));
    const outermost = containers.filter((c) => !containers.some((o) => o !== c && o.contains(c)));
    const paths = [];
    const seen = new Set();
    for (const container of outermost) {
      for (const el of container.querySelectorAll("a, [role=menuitem], [role=treeitem], li")) {
        if (paths.length >= MAX_SCAN_PATHS) break;
        if (el.closest(NEVER) || el.closest(USER_AREA) || el.closest("td, th")) continue;
        const steps = domSteps(el);
        const key = steps.map((s) => s.label).join(" > ");
        if (!safe(steps) || seen.has(key)) continue;
        seen.add(key);
        paths.push(steps);
      }
    }
    return { site: SITE, paths };
  }

  // ---------------------------------------------------------------- recorder: clicks

  let recording = false;
  const settings = { keepEnglish: true, translatePopups: true }; // both on unless switched off in the popup
  chrome.storage.local.get(["recording", "keepEnglish", "translatePopups"]).then((r) => {
    recording = !!r.recording;
    settings.keepEnglish = r.keepEnglish !== false;
    settings.translatePopups = r.translatePopups !== false;
    updateEnglish();
    startPopupWatch();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.recording) recording = !!changes.recording.newValue;
    if (changes.keepEnglish) settings.keepEnglish = changes.keepEnglish.newValue !== false;
    if (changes.translatePopups) settings.translatePopups = changes.translatePopups.newValue !== false;
    if (changes.recording || changes.keepEnglish) updateEnglish();
  });

  function flash(el, ok) {
    const cls = ok ? "sejong-rec-ok" : "sejong-rec-skip";
    el.classList.add(cls);
    setTimeout(() => el.classList.remove(cls), 700);
  }

  function recordClick(target) {
    if (!(target instanceof Element) || target.closest(NEVER)) return;
    if (target.closest("td, th") && !target.closest(MENU_CONTAINERS)) return; // data tables (grades!)
    const el = target.closest(STRONG_CLICKABLE) || target.closest("li");
    if (!el) return;
    const steps = domSteps(el);
    if (!safe(steps)) {
      flash(el, false);
      return;
    }
    chrome.runtime.sendMessage({ type: "rec:click", site: SITE, steps }).catch(() => {});
    flash(el, true);
  }

  // ---------------------------------------------------------------- guide

  const FRAME_TAG = "sejong-nav-frame"; // the overlay (an unknown tag, so site CSS leaves it alone)
  let guiding = false;
  let current = null; // {el, frame, index, startedAt}

  // Really visible to the user, judged on the element itself, not on its parent's state:
  //   * checkVisibility(): display:none anywhere up the tree, visibility:hidden, opacity:0,
  //     content-visibility (Chrome 105+; the extension needs 116)
  //   * its own box (getBoundingClientRect) is at least 1×1 px
  //   * that box is not cut away by an ancestor with overflow:hidden/clip/auto (a closed
  //     height:0 dropdown) or pushed off the top/left of the document (left:-9999px menus).
  //     CSS rules: position:absolute escapes clipping ancestors below its containing block,
  //     position:fixed escapes all of them.
  function isVisible(el) {
    if (typeof el.checkVisibility === "function" &&
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return false;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility !== "visible" || parseFloat(style.opacity) === 0) return false;
    const clips = [{ left: -scrollX, top: -scrollY, right: Infinity, bottom: Infinity }];
    let position = style.position;
    for (let node = el.parentElement; node && node !== document.documentElement && position !== "fixed"; node = node.parentElement) {
      const s = getComputedStyle(node);
      const containsAbsolute = s.position !== "static" || s.transform !== "none";
      if (position !== "absolute" || containsAbsolute) {
        const clipX = s.overflowX !== "visible";
        const clipY = s.overflowY !== "visible";
        if (clipX || clipY) {
          const r = node.getBoundingClientRect();
          clips.push({
            left: clipX ? r.left : -Infinity, right: clipX ? r.right : Infinity,
            top: clipY ? r.top : -Infinity, bottom: clipY ? r.bottom : Infinity,
          });
        }
        position = s.position; // this box is now what the next ancestors must contain
      }
    }
    return S.boxIsShown(el.getBoundingClientRect(), clips);
  }

  // The element's text as the SITE wrote it: Keep-English may have replaced Korean labels.
  function originalText(el) {
    if (!replaced.size) return el.textContent;
    let text = "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      text += replaced.has(node) ? replaced.get(node) : node.nodeValue;
    }
    return text;
  }

  // Where is this menu item in this frame?  → { el, visible } or null
  //   1. selector_desktop, then selector_mobile: the first VISIBLE match wins, so the layout
  //      decides (the desktop menu is hidden in the mobile layout and the other way round).
  //      When a selector matches several elements, the one labelled name_ko or name_en_site
  //      (its text or title) is picked: S.pickCandidate. Two different links that share a
  //      selector are never confused, in KOR or ENG mode.
  //      A match that exists but is hidden (e.g. a node inside a collapsed SJPT tree branch)
  //      is returned with visible: false: the guide then highlights the nearest visible
  //      parent step instead.
  //   2. Only when the item has no selector at all: an element whose whole text is name_ko
  //      or name_en_site (entities decoded, case and spacing ignored).
  // Items of another site are never looked for (a portal label must not match on SJPT).
  function findElement(item) {
    if (!item || item.site !== SITE) return null;
    const selectors = S.selectorsFor(item);
    if (selectors.length) {
      let hidden = null;
      for (const selector of selectors) {
        let matches = [];
        try { matches = document.querySelectorAll(selector); } catch (e) { continue; } // invalid selector
        const candidates = [...matches].map((el) => ({
          el, text: originalText(el), title: el.getAttribute("title") || "", visible: isVisible(el),
        }));
        const pick = S.pickCandidate(item, candidates);
        if (pick < 0) continue;
        if (candidates[pick].visible) return { el: candidates[pick].el, visible: true };
        hidden = hidden || candidates[pick].el;
      }
      return hidden ? { el: hidden, visible: false } : null;
    }
    const names = S.siteNames(item);
    if (!names.length) return null;
    let best = null;
    let hidden = null;
    for (const el of document.querySelectorAll("a, button, [role=menuitem], [role=treeitem], [role=tab], li, span, div, td")) {
      if (el.textContent.length > 200) continue; // a container, not a label: skip the subtree walk
      if (el.closest(FRAME_TAG) || !names.includes(S.labelKey(originalText(el)))) continue;
      if (!isVisible(el)) {
        hidden = hidden || el;
        continue;
      }
      if (!best || best.contains(el)) best = el; // keep the innermost match
    }
    if (best) return { el: best.closest(STRONG_CLICKABLE) || best, visible: true };
    return hidden ? { el: hidden, visible: false } : null;
  }

  // Is this frame showing the site in English or Korean? Judged from route steps found here
  // whose Korean and English site labels differ: Hangul in the shown label means Korean mode.
  //   → "en" | "ko" | null (unknown)
  function pageLanguage(found) {
    let en = 0;
    let ko = 0;
    for (const { item, el } of found) {
      const english = S.labelKey(item.name_en_site);
      if (!english || S.hasHangul(english) || !S.hasHangul(item.name_ko || "")) continue;
      if (S.hasHangul(originalText(el))) ko++;
      else en++;
    }
    if (en !== ko) return en > ko ? "en" : "ko";
    const lang = (document.documentElement.lang || "").toLowerCase();
    return lang.startsWith("en") ? "en" : lang.startsWith("ko") ? "ko" : null;
  }

  // Which path steps are in this frame. Step 0 (the site root) is skipped.
  //   → { site, lang, visible: [indices on screen], hidden: [indices in the DOM but hidden] }
  function probeSteps(path) {
    const visible = [];
    const hidden = [];
    const found = [];
    for (let i = 1; i < path.length; i++) {
      const hit = findElement(path[i]);
      if (!hit) continue;
      (hit.visible ? visible : hidden).push(i);
      if (hit.visible) found.push({ item: path[i], el: hit.el });
    }
    return { site: SITE, lang: pageLanguage(found), visible, hidden };
  }

  // The highlight is an overlay: a fixed-position <sejong-nav-frame> drawn over the target's
  // box (S.frameGeometry: the box + 4 px padding + the 3 px orange border). The site's own
  // elements and styles are never touched, and nothing is drawn outside the frame, so
  // neighbouring menu items stay uncovered. Look: content.css. The step text is only in the panel.
  // A requestAnimationFrame loop keeps the frame on the element through scrolling, resizing,
  // menus opening and other layout changes; it runs only while a frame is shown.
  const VISIBILITY_EVERY = 15; // frames between isVisible() checks (it reads computed styles)

  function setImportant(node, props) {
    for (const [name, value] of Object.entries(props)) node.style.setProperty(name, value, "important");
  }

  function clearPointer() {
    if (!current) return;
    cancelAnimationFrame(current.raf);
    current.frame.remove();
    current = null;
  }

  function track() {
    if (!current) return;
    const { el, frame } = current;
    if (!el.isConnected) { // the site rebuilt its menu: find the step again
      clearPointer();
      if (!dead) chrome.runtime.sendMessage({ type: "guide:refresh" }).catch(() => {});
      return;
    }
    if (current.tick++ % VISIBILITY_EVERY === 0) current.shown = isVisible(el);
    const g = S.frameGeometry(el.getBoundingClientRect());
    const key = current.shown ? `${g.left}|${g.top}|${g.width}|${g.height}` : "hidden";
    if (key !== current.key) { // write styles only when something moved
      current.key = key;
      setImportant(frame, current.shown ? {
        display: "block", left: `${g.left}px`, top: `${g.top}px`, width: `${g.width}px`, height: `${g.height}px`,
        "--sejong-glow": String(g.glow),
      } : { display: "none" });
    }
    current.raf = requestAnimationFrame(track);
  }

  function showPointer(path, index, startedAt) {
    const item = path[index];
    const hit = item && findElement(item);
    const el = hit && hit.visible ? hit.el : null;
    if (current && current.el === el && current.index === index && current.startedAt === startedAt) {
      return; // already shown: don't scroll the page again on every refresh
    }
    clearPointer();
    if (!el) return;
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    const frame = document.createElement(FRAME_TAG);
    frame.setAttribute("aria-hidden", "true");
    frame.dataset.step = `${index}/${path.length - 1}`;
    document.documentElement.append(frame);
    current = { el, frame, index, startedAt, tick: 0, shown: true, key: "", raf: 0 };
    track();
  }

  // ---------------------------------------------------------------- keep English

  const MENU_LIKE = `${STRONG_CLICKABLE}, li, ${MENU_CONTAINERS}`;
  let labelMap = null;          // Korean label -> English label (bundled menu map + recordings)
  const replaced = new Map();   // text node -> its original Korean text
  let englishTimer = null;
  const englishObserver = new MutationObserver(() => {
    clearTimeout(englishTimer);
    englishTimer = setTimeout(applyEnglish, 300);
  });

  function englishWanted() {
    return settings.keepEnglish && !recording;
  }

  async function updateEnglish() {
    if (!englishWanted()) {
      englishObserver.disconnect();
      restoreEnglish();
      return;
    }
    if (!labelMap) {
      const answer = await chrome.runtime.sendMessage({ type: "labels:get" }).catch(() => null);
      labelMap = new Map(answer && answer.ok ? answer.data : []);
    }
    applyEnglish();
    if (document.body) englishObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  // Only whole text nodes that ARE a known Korean label, and only inside menu-like elements.
  function applyEnglish() {
    if (!englishWanted() || !labelMap || !labelMap.size || !document.body) return;
    for (const node of replaced.keys()) if (!node.isConnected) replaced.delete(node);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const label = S.cleanLabel(node.nodeValue);
      const english = label && labelMap.get(label);
      const parent = node.parentElement;
      if (!english || !parent || parent.closest(`script, style, textarea, ${FRAME_TAG}`) || !parent.closest(MENU_LIKE)) continue;
      if (!replaced.has(node)) replaced.set(node, node.nodeValue);
      node.nodeValue = node.nodeValue.replace(/\S[\s\S]*\S|\S/, english); // keep surrounding spaces
      if (!parent.hasAttribute("title")) {
        parent.setAttribute("title", label);
        parent.dataset.sejongTitle = "1";
      }
    }
    englishObserver.takeRecords(); // our own edits must not trigger another round
  }

  function restoreEnglish() {
    for (const [node, original] of replaced) {
      if (!node.isConnected) continue;
      node.nodeValue = original;
      const parent = node.parentElement;
      if (parent && parent.dataset.sejongTitle) {
        parent.removeAttribute("title");
        delete parent.dataset.sejongTitle;
      }
    }
    replaced.clear();
    englishObserver.takeRecords();
  }

  // ---------------------------------------------------------------- pop-up translation

  const MODAL = "dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true], " +
    "[id*=popup i], [class*=popup i], [id*=modal i], [class*=modal i], [id*=layer i], [class*=layer i]";
  const OVERLAY_ID = "sejong-nav-translation";
  const reported = new WeakMap(); // element -> text already reported
  let popupTimer = null;
  const popupObserver = new MutationObserver(() => {
    clearTimeout(popupTimer);
    popupTimer = setTimeout(scanPopups, 400);
  });

  function startPopupWatch() {
    popupObserver.observe(document.documentElement, {
      childList: true, subtree: true, attributes: true,
      attributeFilter: ["style", "class", "open", "hidden", "aria-hidden"],
    });
    scanPopups();
  }

  function looksLikeModal(el) {
    if (el.id === OVERLAY_ID || el.closest(FRAME_TAG)) return false;
    if (el.matches(MENU_CONTAINERS) || el.closest("nav, [role=navigation], [role=menu], [role=menubar]")) return false;
    if (!isVisible(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width * r.height < 4000) return false;
    if (el.matches("dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]")) return true;
    const position = getComputedStyle(el).position;
    return position === "fixed" || position === "absolute";
  }

  function reportPopup(text, kind) {
    chrome.runtime.sendMessage({ type: "popup:found", text: text.slice(0, 3000), kind }).catch(() => {});
  }

  function scanPopups() {
    if (!settings.translatePopups) return;
    const candidates = [...document.querySelectorAll(MODAL)].filter(looksLikeModal);
    for (const el of candidates.filter((c) => !candidates.some((o) => o !== c && o.contains(c)))) {
      const text = (el.innerText || "").trim();
      if (!S.hasHangul(text) || reported.get(el) === text) continue;
      reported.set(el, text);
      reportPopup(text, "pop-up");
    }
  }

  document.addEventListener("sejong-nav-dialog", (event) => { // from page_hook.js
    if (!settings.translatePopups) return;
    try {
      const { kind, message } = JSON.parse(event.detail);
      if (S.hasHangul(message)) reportPopup(message, kind);
    } catch (e) { /* not ours */ }
  });

  // --- top frame only: translate and show the overlay

  const LANGS = { sourceLanguage: "ko", targetLanguage: "en" };
  let translator = null;

  // Returns {text, engine} | {needsDownload: true} | null
  async function translateKo(text) {
    let downloadable = false;
    if (typeof Translator !== "undefined") {
      try {
        const availability = await Translator.availability(LANGS);
        if (availability === "available") {
          translator = translator || await Translator.create(LANGS);
          return { text: await translator.translate(text), engine: "Chrome on-device translator" };
        }
        downloadable = availability === "downloadable" || availability === "downloading";
      } catch (e) { /* API present but blocked here: try the next option */ }
    }
    const answer = await chrome.runtime.sendMessage({ type: "translate:libre", text }).catch(() => null);
    if (answer && answer.ok && answer.data) return { text: answer.data, engine: "LibreTranslate (self-hosted)" };
    return downloadable ? { needsDownload: true } : null;
  }

  function overlayRoot() {
    let host = document.getElementById(OVERLAY_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = OVERLAY_ID;
      host.attachShadow({ mode: "open" }); // the site's CSS cannot reach inside
      document.documentElement.append(host);
    }
    return host.shadowRoot;
  }

  const OVERLAY_CSS = `
    .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: min(380px, calc(100vw - 32px));
           max-height: 50vh; overflow: auto; background: #fff; color: #1f2328; border: 2px solid #c3002f;
           border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.25);
           font: 14px/1.45 system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif; }
    header { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px;
             background: #c3002f; color: #fff; font-weight: 600; font-size: 13px; }
    header button { background: none; border: 0; color: #fff; font-size: 16px; cursor: pointer; }
    .body { padding: 10px; white-space: pre-wrap; }
    .muted { color: #656d76; font-size: 12px; }
    details { padding: 0 10px 10px; } summary { cursor: pointer; color: #656d76; font-size: 12px; }
    .orig { white-space: pre-wrap; margin-top: 6px; color: #656d76; }
    .action { margin: 0 10px 10px; padding: 5px 10px; border: 1px solid #c3002f; background: #fff;
              color: #c3002f; border-radius: 6px; cursor: pointer; font: inherit; }
    @media (prefers-color-scheme: dark) {
      .box { background: #1c1f24; color: #e6edf3; } .action { background: #1c1f24; }
    }`;

  function renderOverlay({ title, message, original, action }) {
    const root = overlayRoot();
    const make = (tag, cls, text) => {
      const node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text; // textContent only: page text is never parsed as HTML
      return node;
    };
    const style = make("style", null, OVERLAY_CSS);
    const box = make("div", "box");
    const header = make("header");
    const close = make("button", null, "✕");
    close.title = "Close";
    close.addEventListener("click", () => document.getElementById(OVERLAY_ID).remove());
    header.append(make("span", null, title), close);
    box.append(header, make("div", "body", message));
    if (action) {
      const button = make("button", "action", action.label);
      button.addEventListener("click", action.run);
      box.append(button);
    }
    const details = make("details");
    details.append(make("summary", null, "Original (한국어)"), make("div", "orig", original));
    box.append(details);
    root.replaceChildren(style, box);
  }

  async function showTranslation(original, kind) {
    const title = `English · ${kind === "alert" || kind === "confirm" || kind === "prompt" ? `last ${kind}()` : "pop-up"}`;
    renderOverlay({ title, message: "Translating…", original });
    const result = await translateKo(original);
    if (result && result.text) {
      renderOverlay({ title: `${title} · ${result.engine}`, message: result.text, original });
    } else if (result && result.needsDownload) {
      renderOverlay({
        title, original,
        message: "Chrome can translate Korean on this computer, but needs a one-time download (~ tens of MB). Nothing is sent to a server.",
        action: {
          label: "Download translator",
          run: async () => { // a click = the user gesture Chrome requires for the download
            try {
              translator = await Translator.create({
                ...LANGS,
                monitor(m) {
                  m.addEventListener("downloadprogress", (e) => renderOverlay({ title, original, message: `Downloading… ${Math.round(e.loaded * 100)}%` }));
                },
              });
              showTranslation(original, kind);
            } catch (e) {
              renderOverlay({ title, original, message: `Download failed: ${e.message}` });
            }
          },
        },
      });
    } else {
      renderOverlay({
        title, original,
        message: "No translator available. Use Chrome 138+ (built-in on-device translator) or start a self-hosted LibreTranslate and set TRANSLATE_URL in config.js.",
      });
    }
  }

  // ---------------------------------------------------------------- events

  document.addEventListener("click", (event) => {
    if (dead) return; // an orphan from before an extension reload: a fresh copy took over
    if (recording) recordClick(event.target);
    // The user clicked the highlighted step: save the next step (before the page navigates away).
    if (current && event.target instanceof Node && current.el.contains(event.target)) {
      chrome.runtime.sendMessage({ type: "guide:clicked", index: current.index, startedAt: current.startedAt })
        .catch(() => {});
    }
    // After a click the menu may open or the page may change: look for the next step.
    if (guiding) setTimeout(() => chrome.runtime.sendMessage({ type: "guide:refresh" }).catch(() => {}), 500);
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg && msg.type) {
      case "rec:scanFrame": {
        const hadEnglish = replaced.size > 0;
        if (hadEnglish) restoreEnglish(); // record the real Korean labels
        sendResponse(scanMenus());
        if (hadEnglish) updateEnglish();
        break;
      }
      case "popup:show":
        if (window === window.top) showTranslation(msg.text, msg.kind);
        sendResponse({ ok: true });
        break;
      case "guide:probe":
        sendResponse(probeSteps(msg.path));
        break;
      case "guide:show":
        guiding = true;
        showPointer(msg.path, msg.index, msg.startedAt);
        sendResponse({ ok: true });
        break;
      case "guide:clear":
        guiding = !!msg.guiding;
        clearPointer();
        sendResponse({ ok: true });
        break;
      default:
        return false;
    }
    return false;
  });

  // Called by a fresh copy (injected after an extension reload) on this orphaned one: remove
  // what it shows and stop what it watches.
  instance.shutdown = () => {
    dead = true;
    guiding = false;
    clearPointer();
    englishObserver.disconnect();
    popupObserver.disconnect();
  };

  // A new page (or frame) loaded, also a new tab opened by SSO, or background.js injected this
  // copy into an open tab: if a guide is active, continue it.
  chrome.runtime.sendMessage({ type: "guide:refresh" }).catch(() => {});
})();
