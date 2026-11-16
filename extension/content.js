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
// GUIDE: finds the deepest step of the current route that is visible in this frame
//   (by selector, else by exact Korean/English text) and highlights it with an outline + pointer.
(() => {
  if (window.__sejongNavigator) return; // injected twice (about:blank frames)
  window.__sejongNavigator = true;

  const S = globalThis.SejongShared;
  const hostname = location.hostname || (self.origin && self.origin !== "null" ? new URL(self.origin).hostname : "");
  const SITE = S.siteForHost(hostname);
  if (!SITE) return;

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
  chrome.storage.local.get("recording").then((r) => { recording = !!r.recording; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.recording) recording = !!changes.recording.newValue;
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

  const HIGHLIGHT = "sejong-nav-highlight";
  let guiding = false;
  let current = null; // {el, tip}

  function isVisible(el) {
    const rects = el.getClientRects();
    if (!rects.length || rects[0].width === 0 || rects[0].height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  }

  function namesOf(item) {
    return [item.name_ko, item.name_en].map(S.cleanLabel).filter(Boolean).map((n) => n.toLowerCase());
  }

  function findElement(item) {
    const names = namesOf(item);
    if (item.selector) {
      try {
        for (const el of document.querySelectorAll(item.selector)) {
          const text = S.cleanLabel(el.textContent).toLowerCase();
          if (isVisible(el) && (!names.length || names.some((n) => text.includes(n)))) return el;
        }
      } catch (e) { /* invalid selector: fall back to text */ }
    }
    if (!names.length) return null;
    let best = null;
    for (const el of document.querySelectorAll("a, button, [role=menuitem], [role=treeitem], [role=tab], li, span, div, td")) {
      if (el.id === "sejong-nav-pointer" || !names.includes(S.cleanLabel(el.textContent).toLowerCase())) continue;
      if (!isVisible(el)) continue;
      if (!best || best.contains(el)) best = el; // keep the innermost match
    }
    return best ? best.closest(STRONG_CLICKABLE) || best : null;
  }

  // Index of the deepest path step visible in this frame, or -1. Step 0 (the portal root) is skipped.
  function deepestVisible(path) {
    for (let i = path.length - 1; i >= 1; i--) {
      if (findElement(path[i])) return i;
    }
    return -1;
  }

  function clearPointer() {
    if (!current) return;
    current.el.classList.remove(HIGHLIGHT);
    current.tip.remove();
    current = null;
  }

  function place() {
    if (!current) return;
    const r = current.el.getBoundingClientRect();
    const tip = current.tip;
    const above = r.top - tip.offsetHeight - 8;
    tip.style.top = `${above >= 4 ? above : r.bottom + 8}px`;
    tip.style.left = `${Math.max(4, Math.min(r.left, innerWidth - tip.offsetWidth - 4))}px`;
  }

  function showPointer(path, index) {
    clearPointer();
    const item = path[index];
    const el = item && findElement(item);
    if (!el) return;
    el.classList.add(HIGHLIGHT);
    el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    const tip = document.createElement("div");
    tip.id = "sejong-nav-pointer";
    const last = index === path.length - 1;
    tip.textContent = `${last ? "✓" : "👉"} ${[item.name_ko, item.name_en].filter(Boolean).join(" / ")}`;
    const step = document.createElement("small");
    step.textContent = `  ${index}/${path.length - 1}`;
    tip.append(step);
    document.documentElement.append(tip);
    current = { el, tip };
    place();
  }

  addEventListener("scroll", () => requestAnimationFrame(place), { capture: true, passive: true });
  addEventListener("resize", () => requestAnimationFrame(place), { passive: true });

  // ---------------------------------------------------------------- events

  document.addEventListener("click", (event) => {
    if (recording) recordClick(event.target);
    // After a click the menu may open or the page may change: look for the next step.
    if (guiding) setTimeout(() => chrome.runtime.sendMessage({ type: "guide:refresh" }).catch(() => {}), 500);
  }, true);

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg && msg.type) {
      case "rec:scanFrame":
        sendResponse(scanMenus());
        break;
      case "guide:probe":
        sendResponse({ index: deepestVisible(msg.path) });
        break;
      case "guide:show":
        guiding = true;
        showPointer(msg.path, msg.index);
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

  // A new page (or frame) loaded: if a guide is running in this tab, continue it.
  chrome.runtime.sendMessage({ type: "guide:refresh" }).catch(() => {});
})();
