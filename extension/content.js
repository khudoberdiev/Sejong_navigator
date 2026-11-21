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
//   whether the page is in English or Korean mode, and which steps link to the page this frame
//   shows (those are done). Highlights the step background.js picks with an orange frame drawn
//   as an overlay (no label on the page; the step text is in the panel). A target above or below
//   what the student sees (the window, or a scrolling box like the SJPT tree) gets an orange
//   arrow at that edge instead; clicking it scrolls there. The page never scrolls by itself.
//   On every page load it asks background.js for the active guide (kept in
//   chrome.storage.session), so the highlight comes back after navigation and in new tabs.
//   A click on the highlighted element advances the guide to the next step.
//   SJPT (WebSquare): the left menu is a collapsible tree in the main document (its "wframes"
//   are not iframes). Its nodes are found by treenodevalue codes, the same in KOR and ENG mode.
//
// KEEP-ENGLISH: after every page load (and whenever the menu changes) replaces Korean menu
//   labels that are in the menu map with their English display label (label_en: never a note
//   like "(home)"). The label's whole text is replaced, only where the item's selector matches
//   (generic labels like "더보기" stay alone elsewhere). Hover shows the Korean original.
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
  const I = globalThis.SejongI18n;
  const t = (key, subs) => I.t(key, subs);
  const hostname = location.hostname || (self.origin && self.origin !== "null" ? new URL(self.origin).hostname : "");
  const SITE = S.siteForHost(hostname);
  if (!SITE) return;

  // Leftovers in the page from an earlier copy: its highlight frame, and the old design's
  // label bubble and the class it put on the site's element.
  for (const old of document.querySelectorAll("sejong-nav-frame, sejong-nav-arrow, sejong-nav-widget, #sejong-nav-pointer")) old.remove();
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
  const ARROW_TAG = "sejong-nav-arrow"; // the off-screen pointer (content.css)
  const ARROW_SIZE = { width: 44, height: 44 }; // = its CSS size
  const WIDGET_TAG = globalThis.SejongWidget.HOST_TAG; // the floating widget (top frame)
  let widget = null;
  let guiding = false;
  let current = null; // {el, frame, index, startedAt}

  // Really visible to the user, judged on the element itself, not on its parent's state:
  //   * checkVisibility(): display:none anywhere up the tree, visibility:hidden, opacity:0,
  //     content-visibility (Chrome 105+; the extension needs 116)
  //   * its own box (getBoundingClientRect) is at least 1×1 px
  //   * that box is not cut away by an ancestor with overflow:hidden/clip (a closed height:0
  //     dropdown) or pushed off the top/left of the document (left:-9999px menus).
  //     CSS rules: position:absolute escapes clipping ancestors below its containing block,
  //     position:fixed escapes all of them.
  //   A box the student can SCROLL (overflow auto/scroll, content taller or wider than it, e.g.
  //   the SJPT menu tree) does not hide what is inside it: that is only scrolled away, like the
  //   page below the window. Those boxes are returned as `scrollers` (the off-screen arrow).
  //   → { shown, scrollers: [elements] }
  function isScroller(node, s) {
    const y = /auto|scroll/.test(s.overflowY) && node.clientHeight >= 1 && node.scrollHeight > node.clientHeight + 1;
    const x = /auto|scroll/.test(s.overflowX) && node.clientWidth >= 1 && node.scrollWidth > node.clientWidth + 1;
    return x || y;
  }

  function visibility(el) {
    const scrollers = [];
    if (typeof el.checkVisibility === "function" &&
        !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true, contentVisibilityAuto: true })) return { shown: false, scrollers };
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility !== "visible" || parseFloat(style.opacity) === 0) return { shown: false, scrollers };
    const clips = [{ left: -scrollX, top: -scrollY, right: Infinity, bottom: Infinity }];
    let position = style.position;
    for (let node = el.parentElement; node && node !== document.documentElement && position !== "fixed"; node = node.parentElement) {
      const s = getComputedStyle(node);
      const containsAbsolute = s.position !== "static" || s.transform !== "none";
      if (position !== "absolute" || containsAbsolute) {
        const clipX = s.overflowX !== "visible";
        const clipY = s.overflowY !== "visible";
        if ((clipX || clipY) && node !== document.body && isScroller(node, s)) {
          scrollers.push(node);
        } else if (clipX || clipY) {
          const r = node.getBoundingClientRect();
          clips.push({
            left: clipX ? r.left : -Infinity, right: clipX ? r.right : Infinity,
            top: clipY ? r.top : -Infinity, bottom: clipY ? r.bottom : Infinity,
          });
        }
        position = s.position; // this box is now what the next ancestors must contain
      }
    }
    return { shown: S.boxIsShown(el.getBoundingClientRect(), clips), scrollers };
  }

  function isVisible(el) {
    return visibility(el).shown;
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

  // Does the step's link (on this page) lead to the page this frame shows? Then clicking it would
  // only reload the page: the step is done. "#", "javascript:" and empty hrefs never count.
  function linksHere(el) {
    const a = el.closest("a[href]");
    return !!a && S.isRealLink(a.getAttribute("href")) && S.samePage(a.href, location.href);
  }

  // Which path steps are in this frame. Step 0 (the site root) is skipped.
  //   → { site, lang, visible: [indices on screen], hidden: [indices in the DOM but hidden],
  //       here: [indices whose link points to this very page] }
  function probeSteps(path) {
    const visible = [];
    const hidden = [];
    const here = [];
    const found = [];
    for (let i = 1; i < path.length; i++) {
      const hit = findElement(path[i]);
      if (!hit) continue;
      (hit.visible ? visible : hidden).push(i);
      if (hit.visible) found.push({ item: path[i], el: hit.el });
      if (linksHere(hit.el)) here.push(i);
    }
    return { site: SITE, lang: pageLanguage(found), visible, hidden, here };
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
    current.arrow.remove();
    current = null;
    if (widget) widget.setTarget(null);
  }

  const viewportSize = () => ({ width: document.documentElement.clientWidth || innerWidth, height: document.documentElement.clientHeight || innerHeight });

  // Every animation frame: the frame on the target, or (target scrolled away) the arrow at the
  // edge it is behind. Styles are written only when something changed.
  function track() {
    if (!current) return;
    const { el, frame, arrow } = current;
    if (!el.isConnected) { // the site rebuilt its menu: find the step again
      clearPointer();
      if (!dead) chrome.runtime.sendMessage({ type: "guide:refresh" }).catch(() => {});
      return;
    }
    if (current.tick++ % VISIBILITY_EVERY === 0) ({ shown: current.shown, scrollers: current.scrollers } = visibility(el));
    const g = S.frameGeometry(el.getBoundingClientRect());
    const box = { left: g.left, top: g.top, right: g.left + g.width, bottom: g.top + g.height };
    const view = S.visibleArea(viewportSize(), current.scrollers.map((n) => n.getBoundingClientRect()));
    const off = current.shown ? S.offscreenArrow(box, view, ARROW_SIZE) : null;
    const key = !current.shown ? "hidden" : off ? `arrow|${off.dir}|${off.x}|${off.y}` : `${g.left}|${g.top}|${g.width}|${g.height}`;
    if (key !== current.key) {
      current.key = key;
      current.target = !current.shown ? null : off
        ? { left: off.x, top: off.y, right: off.x + ARROW_SIZE.width, bottom: off.y + ARROW_SIZE.height }
        : box;
      if (widget) widget.setTarget(current.target); // the widget keeps clear of the frame or the arrow
      setImportant(frame, current.shown && !off ? {
        display: "block", left: `${g.left}px`, top: `${g.top}px`, width: `${g.width}px`, height: `${g.height}px`,
        "--sejong-glow": String(g.glow),
      } : { display: "none" });
      if (off) {
        if (arrow.dataset.dir !== off.dir) {
          arrow.dataset.dir = off.dir;
          arrow.textContent = off.dir === "up" ? "↑" : "↓";
          arrow.title = off.dir === "up" ? t("arrow_up") : t("arrow_down");
          arrow.setAttribute("aria-label", arrow.title);
        }
        setImportant(arrow, { display: "block", left: `${off.x}px`, top: `${off.y}px` });
      } else {
        setImportant(arrow, { display: "none" });
      }
    }
    current.raf = requestAnimationFrame(track);
  }

  // The arrow: the only part of the guide that takes clicks (pointer-events only on itself).
  // A click scrolls the page, and any scrolling box around the target, to the target.
  function makeArrow() {
    const arrow = document.createElement(ARROW_TAG);
    arrow.setAttribute("role", "button");
    arrow.setAttribute("tabindex", "0");
    setImportant(arrow, { display: "none" });
    const go = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (current && current.arrow === arrow) current.el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    };
    arrow.addEventListener("click", go);
    arrow.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") go(e); });
    for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup"]) arrow.addEventListener(type, (e) => e.stopPropagation());
    return arrow;
  }

  // reuse: this step opens another Sejong site in a new tab and a tab of it is already open
  // (background.js knows); a click then focuses that tab instead of opening another one.
  // Never scrolls the page: a target out of view gets the arrow (track).
  function showPointer(path, index, startedAt, reuse) {
    const item = path[index];
    const hit = item && findElement(item);
    const el = hit && hit.visible ? hit.el : null;
    if (current && current.el === el && current.index === index && current.startedAt === startedAt) {
      current.reuse = !!reuse;
      return; // already shown
    }
    clearPointer();
    if (!el) return;
    const frame = document.createElement(FRAME_TAG);
    frame.setAttribute("aria-hidden", "true");
    frame.dataset.step = `${index}/${path.length - 1}`;
    const arrow = makeArrow();
    document.documentElement.append(frame, arrow);
    current = { el, frame, arrow, index, startedAt, reuse: !!reuse, tick: 0, shown: true, scrollers: [], key: "", target: null, raf: 0 };
    track();
  }

  // ---------------------------------------------------------------- keep English

  const MENU_LIKE = `${STRONG_CLICKABLE}, li, ${MENU_CONTAINERS}`;
  let labelMap = null;          // Korean label -> English label (bundled menu map + recordings)
  const replaced = new Map();   // text node -> its original Korean text
  const titled = new Set();     // elements we gave a title (the Korean original, on hover)
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
      // Korean label (S.labelKey) -> [{en, selectors}] (background.js labelPairs)
      labelMap = new Map((answer && answer.ok ? answer.data : []).map(([ko, entries]) => [S.labelKey(ko), entries]));
    }
    applyEnglish();
    if (document.body) englishObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  const MAX_OWNER_LABEL = 60; // longer text: a container, not one menu label

  function textNodesOf(el) {
    const nodes = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    return nodes;
  }

  function replaceWith(nodes, english, owner, label) {
    const values = S.replaceLabelText(nodes.map((n) => n.nodeValue), english);
    nodes.forEach((n, i) => {
      if (n.nodeValue === values[i]) return;
      replaced.set(n, n.nodeValue);
      n.nodeValue = values[i];
    });
    if (!owner.hasAttribute("title")) {
      owner.setAttribute("title", label);
      owner.dataset.sejongTitle = "1";
      titled.add(owner);
    }
  }

  // Only inside menu-like elements, only a known Korean label, and only its WHOLE text: the
  // label of a clickable element (all its text nodes: the first gets the English label, the
  // rest become empty), or one text node that is the whole label apart from a badge. Labels
  // shared by several items are replaced only where that item's selector matches.
  function applyEnglish() {
    if (!englishWanted() || !labelMap || !labelMap.size || !document.body) return;
    for (const node of replaced.keys()) if (!node.isConnected) replaced.delete(node);
    const done = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const pending = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) pending.push(node);
    for (const node of pending) {
      const parent = node.parentElement;
      if (replaced.has(node) || !node.nodeValue.trim() || !parent) continue;
      if (parent.closest(`script, style, textarea, ${FRAME_TAG}, ${ARROW_TAG}, ${WIDGET_TAG}`) || !parent.closest(MENU_LIKE)) continue;
      const clickable = parent.closest(STRONG_CLICKABLE);
      const owner = clickable && S.cleanLabel(clickable.textContent).length <= MAX_OWNER_LABEL ? clickable : parent;
      if (done.has(owner)) continue; // each element once per round
      done.add(owner);
      const nodes = textNodesOf(owner);
      if (nodes.some((n) => replaced.has(n))) continue; // already English
      const ownerLabel = S.cleanLabel(owner.textContent);
      const whole = labelMap.get(S.labelKey(ownerLabel));
      const english = whole && S.pickEnglish(whole, (sel) => owner.matches(sel) || !!owner.closest(sel));
      if (english) { // the element's whole label
        replaceWith(nodes, english, owner, ownerLabel);
        continue;
      }
      for (const n of nodes) { // one node that is the whole label apart from a badge
        const nodeLabel = S.cleanLabel(n.nodeValue);
        const single = nodeLabel && labelMap.get(S.labelKey(nodeLabel));
        const el = n.parentElement;
        const one = single && el && S.nodeIsWholeLabel(nodeLabel, ownerLabel) &&
          S.pickEnglish(single, (sel) => owner.matches(sel) || !!el.closest(sel));
        if (one) replaceWith([n], one, el, nodeLabel);
      }
    }
    englishObserver.takeRecords(); // our own edits must not trigger another round
  }

  function restoreEnglish() {
    for (const [node, original] of replaced) {
      if (node.isConnected) node.nodeValue = original;
    }
    for (const el of titled) {
      if (el.dataset.sejongTitle) {
        el.removeAttribute("title");
        delete el.dataset.sejongTitle;
      }
    }
    titled.clear();
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
          return { text: await translator.translate(text), engine: t("engine_chrome") };
        }
        downloadable = availability === "downloadable" || availability === "downloading";
      } catch (e) { /* API present but blocked here: try the next option */ }
    }
    const answer = await chrome.runtime.sendMessage({ type: "translate:libre", text }).catch(() => null);
    if (answer && answer.ok && answer.data) return { text: answer.data, engine: t("engine_libre") };
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
    close.title = t("close");
    close.setAttribute("aria-label", t("close"));
    close.addEventListener("click", () => document.getElementById(OVERLAY_ID).remove());
    header.append(make("span", null, title), close);
    box.append(header, make("div", "body", message));
    if (action) {
      const button = make("button", "action", action.label);
      button.addEventListener("click", action.run);
      box.append(button);
    }
    const details = make("details");
    details.append(make("summary", null, t("popup_original")), make("div", "orig", original));
    box.append(details);
    root.replaceChildren(style, box);
  }

  async function showTranslation(original, kind) {
    const title = kind === "alert" || kind === "confirm" || kind === "prompt"
      ? t("popup_title_dialog", [kind]) : t("popup_title_popup");
    renderOverlay({ title, message: t("translating"), original });
    const result = await translateKo(original);
    if (result && result.text) {
      renderOverlay({ title: t("popup_title_engine", [title, result.engine]), message: result.text, original });
    } else if (result && result.needsDownload) {
      renderOverlay({
        title, original,
        message: t("translator_needs_download"),
        action: {
          label: t("download_translator"),
          run: async () => { // a click = the user gesture Chrome requires for the download
            try {
              translator = await Translator.create({
                ...LANGS,
                monitor(m) {
                  m.addEventListener("downloadprogress", (e) => renderOverlay({ title, original, message: t("downloading", [Math.round(e.loaded * 100)]) }));
                },
              });
              showTranslation(original, kind);
            } catch (e) {
              renderOverlay({ title, original, message: t("download_failed", [e.message]) });
            }
          },
        },
      });
    } else {
      renderOverlay({
        title, original,
        message: t("no_translator"),
      });
    }
  }

  // ---------------------------------------------------------------- events

  document.addEventListener("click", (event) => {
    if (dead) return; // an orphan from before an extension reload: a fresh copy took over
    if (event.target instanceof Element && event.target.closest(`${WIDGET_TAG}, ${ARROW_TAG}`)) return; // our own UI
    if (recording) recordClick(event.target);
    // The user clicked the highlighted step: save the next step (before the page navigates away).
    if (current && event.target instanceof Node && current.el.contains(event.target)) {
      if (current.reuse) {
        // Do not open yet another tab of that site: background.js focuses the open one.
        event.preventDefault();
        event.stopPropagation();
      }
      chrome.runtime.sendMessage({ type: "guide:clicked", index: current.index, startedAt: current.startedAt, reuse: current.reuse })
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
        showPointer(msg.path, msg.index, msg.startedAt, msg.reuse);
        sendResponse({ ok: true });
        break;
      case "widget:toggle": // toolbar icon in widget mode (top frame only)
        if (window !== window.top) return false;
        if (widget) widget.toggle();
        sendResponse({ ok: !!widget });
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
    if (widget) { widget.destroy(); widget = null; }
    englishObserver.disconnect();
    popupObserver.disconnect();
  };

  // ---------------------------------------------------------------- floating widget

  // The default UI (widget.js), in the TOP frame of Sejong pages only, unless Settings →
  // Display is "Side panel". It only renders guide state and sends messages.
  async function updateWidget() {
    if (dead || window !== window.top) return;
    const { display } = await chrome.storage.local.get("display").catch(() => ({}));
    const wanted = display !== "panel";
    if (wanted && !widget) {
      widget = globalThis.SejongWidget.create(SITE);
      if (current && current.target) widget.setTarget(current.target);
    } else if (!wanted && widget) {
      widget.destroy();
      widget = null;
    }
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.display) updateWidget();
  });
  I.init().then(updateWidget, updateWidget);

  // A new page (or frame) loaded, also a new tab opened by SSO, or background.js injected this
  // copy into an open tab: if a guide is active, continue it.
  chrome.runtime.sendMessage({ type: "guide:refresh" }).catch(() => {});
})();
