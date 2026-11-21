// AI-generated — to be rewritten by me
// The floating in-page widget: the default UI (Settings → Display → "Side panel" switches back).
// content.js creates it in the TOP frame of Sejong pages only. Three views, like Zoom:
//   mini     a small "—" pill; click it to expand
//   compact  only the click path (current step orange, done steps struck through) + Stop
//   full     everything the side panel's Search tab has (ui.js): search, results, path, status, Settings
// Rules:
//   * a CLOSED Shadow DOM: the site's CSS cannot reach in, ours cannot leak out. The host is
//     position:fixed, so the page never resizes or shifts. z-index one below the highlight frame.
//   * draggable by its header (the pill: by itself); position and view are saved in
//     chrome.storage.local (widgetPos, widgetMode), shared by all tabs; kept inside the viewport.
//   * never covers the highlighted element: content.js reports the frame's box (setTarget) and
//     the widget moves to another corner while they would overlap (S.placeWidget).
//   * renders guide state only (background.js is the single writer of chrome.storage.session)
//     and sends messages. It never reads page content.
(function (root) {
  "use strict";

  const S = root.SejongShared;
  const I = root.SejongI18n;
  const UI = root.SejongUI;
  const t = (key, subs) => I.t(key, subs);
  const HOST_TAG = "sejong-nav-widget";
  const Z_INDEX = "2147483646"; // the highlight frame (content.css) is 2147483647: always on top
  const DRAG_THRESHOLD = 4;     // px: less is a click

  async function send(message) {
    const answer = await chrome.runtime.sendMessage(message);
    if (!answer || !answer.ok) throw new Error(answer ? answer.error : t("no_answer"));
    return answer.data;
  }

  function setImportant(node, props) {
    for (const [name, value] of Object.entries(props)) node.style.setProperty(name, value, "important");
  }

  // site: the Sejong site this page is on (content.js knows it from the host name).
  function create(site) {
    const host = document.createElement(HOST_TAG);
    setImportant(host, {
      all: "initial", position: "fixed", "z-index": Z_INDEX, left: "0px", top: "0px",
      display: "block", visibility: "hidden", // shown once the styles are in
    });
    const shadow = host.attachShadow({ mode: "closed" });
    // Keep our clicks and keys to ourselves: site handlers on document (close-menu-on-click,
    // keyboard shortcuts) must not react to typing in the search box or clicking a button.
    for (const type of ["click", "mousedown", "mouseup", "pointerdown", "pointerup", "keydown", "keyup", "keypress", "input"]) {
      host.addEventListener(type, (e) => e.stopPropagation());
    }

    const style = document.createElement("style");
    const pill = UI.el("button", { class: "sn-pill", text: "—" });
    const title = UI.el("span", { class: "sn-title" });
    const collapse = UI.el("button", { class: "icon sn-collapse", text: "–" });
    const expand = UI.el("button", { class: "icon sn-expand", text: "+" });
    const head = UI.el("header", { class: "sn-head" }, title, UI.el("span", { class: "sn-buttons" }, collapse, expand));
    const compactCrumbs = UI.el("ol", { class: "crumbs" });
    const compactEmpty = UI.el("p", { class: "muted" });
    const compactStop = UI.el("button", {});
    const compact = UI.el("div", { class: "sn-compact" }, compactCrumbs, compactEmpty, UI.el("div", { class: "row" }, compactStop));
    const full = UI.el("div", { class: "sn-full" });
    const card = UI.el("div", { class: "sn-card" }, head, compact, full);
    const box = UI.el("div", { class: "sn-widget" }, pill, card);
    shadow.append(style, box);
    document.documentElement.append(host);

    let mode = S.DEFAULT_WIDGET_MODE;
    let home = null;     // {x, y} chosen by the user
    let target = null;   // the highlight frame's box, or null
    let dragging = null;
    let destroyed = false;

    const tabIdPromise = send({ type: "ui:tabId" }).catch(() => undefined);
    const adapter = {
      send,
      getState: () => send({ type: "ui:state" }),
      tabId: () => tabIdPromise,
      site: async () => site || null,
      openUrl: (url) => send({ type: "tab:open", url }),
      onGuideStarted: () => setMode("compact"),
    };
    const ui = UI.mount(full, adapter);

    // ---------------------------------------------------------------- text

    function applyText() {
      title.textContent = t("ext_name");
      pill.title = t("widget_expand");
      pill.setAttribute("aria-label", t("widget_expand"));
      collapse.title = mode === "full" ? t("widget_to_compact") : t("widget_to_mini");
      collapse.setAttribute("aria-label", collapse.title);
      expand.title = t("widget_to_full");
      expand.setAttribute("aria-label", expand.title);
      head.title = t("widget_drag");
      compactStop.textContent = t("stop");
      compactEmpty.textContent = t("no_guide_running");
    }

    // ---------------------------------------------------------------- compact view

    async function renderCompact() {
      let state = null;
      try { state = await adapter.getState(); } catch (e) { /* worker asleep or reloading */ }
      if (destroyed) return;
      const guide = state && S.isGuide(state.guide) ? state.guide : null;
      compactEmpty.hidden = !!guide;
      // After a guide ends: "Done: …" plus what to do next where the guide cannot follow (libseat).
      compactEmpty.textContent = (state && S.finishedMessage(state.last, t)) || t("no_guide_running");
      compactStop.hidden = !guide;
      compactCrumbs.hidden = !guide;
      if (guide) {
        const info = S.guideStatus(guide, state.view);
        UI.renderCrumbs(compactCrumbs, guide.route, info.index, guide.step);
      }
      place();
    }
    compactStop.addEventListener("click", () => send({ type: "guide:stop" }).catch(() => {}));

    // ---------------------------------------------------------------- mode and position

    function setMode(next, save = true) {
      mode = S.widgetMode(mode, next);
      box.dataset.mode = mode;
      expand.hidden = mode === "full";
      applyText();
      if (save) chrome.storage.local.set({ widgetMode: mode }).catch(() => {});
      place();
    }

    const viewport = () => ({ width: document.documentElement.clientWidth || innerWidth, height: innerHeight });
    const size = () => {
      const r = (mode === "mini" ? pill : card).getBoundingClientRect();
      return { width: Math.ceil(r.width), height: Math.ceil(r.height) };
    };

    function place() {
      if (destroyed || dragging) return;
      const p = S.placeWidget(home, size(), target, viewport());
      setImportant(host, { left: `${p.x}px`, top: `${p.y}px` });
      box.dataset.avoiding = p.avoided ? "true" : "false";
    }

    // Drag by the header (or the pill). A move under DRAG_THRESHOLD px is a click.
    function startDrag(e, handle) {
      if (e.button !== 0 || (handle === head && e.target.closest("button"))) return;
      const r = host.getBoundingClientRect();
      dragging = { handle, id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, x0: e.clientX, y0: e.clientY, moved: false };
      handle.setPointerCapture(e.pointerId);
    }
    function moveDrag(e) {
      if (!dragging || e.pointerId !== dragging.id) return;
      if (!dragging.moved && Math.hypot(e.clientX - dragging.x0, e.clientY - dragging.y0) < DRAG_THRESHOLD) return;
      dragging.moved = true;
      const p = S.clampWidget({ x: e.clientX - dragging.dx, y: e.clientY - dragging.dy }, size(), viewport());
      setImportant(host, { left: `${p.x}px`, top: `${p.y}px` });
    }
    function endDrag(e) {
      if (!dragging || e.pointerId !== dragging.id) return;
      const { moved, handle } = dragging;
      dragging = null;
      if (moved) {
        const r = host.getBoundingClientRect();
        home = S.clampWidget({ x: r.left, y: r.top }, size(), viewport());
        chrome.storage.local.set({ widgetPos: home }).catch(() => {});
        place(); // dropped onto the highlight: step aside again
      } else if (handle === pill) {
        setMode("expand");
      }
    }
    for (const handle of [head, pill]) {
      handle.addEventListener("pointerdown", (e) => startDrag(e, handle));
      handle.addEventListener("pointermove", moveDrag);
      handle.addEventListener("pointerup", endDrag);
      handle.addEventListener("pointercancel", endDrag);
    }
    collapse.addEventListener("click", () => setMode("collapse"));
    expand.addEventListener("click", () => setMode("expand"));

    const onResize = () => requestAnimationFrame(place);
    addEventListener("resize", onResize, { passive: true });
    const sizeWatcher = new ResizeObserver(() => place()); // view switches, results appearing
    sizeWatcher.observe(card);
    sizeWatcher.observe(pill);

    // ---------------------------------------------------------------- state from storage

    const onStorage = (changes, area) => {
      if (destroyed) return;
      if (area === "session" && Object.keys(changes).some((k) => k === "activeGuide" || k === "guideLast" || k.startsWith("guideView:"))) {
        renderCompact();
        ui.refresh();
      }
      if (area === "local" && changes.widgetMode && changes.widgetMode.newValue !== mode) setMode(changes.widgetMode.newValue, false);
      if (area === "local" && changes.widgetPos && !dragging) { home = changes.widgetPos.newValue || null; place(); }
    };
    chrome.storage.onChanged.addListener(onStorage);
    I.onChange(() => { if (!destroyed) { applyText(); place(); } });

    (async () => {
      const [{ css }, stored] = await Promise.all([
        send({ type: "ui:css" }).catch(() => ({ css: "" })),
        chrome.storage.local.get(["widgetMode", "widgetPos"]).catch(() => ({})),
      ]);
      if (destroyed) return;
      style.textContent = css;
      home = stored.widgetPos || null;
      setMode(stored.widgetMode || S.DEFAULT_WIDGET_MODE, false);
      await renderCompact();
      setImportant(host, { visibility: "visible" });
    })();
    applyText();

    return {
      // The highlight frame's box in viewport px ({left, top, right, bottom}), or null.
      setTarget(rect) {
        target = rect;
        place();
      },
      toggle() { setMode("toggle"); },
      destroy() {
        destroyed = true;
        removeEventListener("resize", onResize);
        sizeWatcher.disconnect();
        chrome.storage.onChanged.removeListener(onStorage);
        ui.destroy();
        host.remove();
      },
    };
  }

  root.SejongWidget = Object.freeze({ create, HOST_TAG, Z_INDEX });
})(globalThis);
