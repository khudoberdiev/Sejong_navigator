// AI-generated — to be rewritten by me
// The guide UI: search box with suggestions → top results → click path (breadcrumbs, Korean +
// English) → "Show me on this page" / Stop / Open → status line → Settings.
// ONE implementation, mounted in two places:
//   * the side panel (popup.html / popup.js)
//   * the floating widget's FULL view (widget.js, inside a closed Shadow DOM on Sejong pages)
// It never reads the page. It only renders the guide state that background.js (the single
// writer of chrome.storage.session) keeps, and sends messages; the adapter says how:
//   adapter = {
//     send(msg)      → answer data (throws on {ok:false})
//     getState()     → {guide, last, view} for the tab this UI is about
//     tabId()        → that tab's id (undefined: background uses the sender's tab)
//     site()         → the Sejong site that tab is on ("portal", "library", ...) or null
//     openUrl(url)   → navigate that tab
//     onGuideStarted() optional: the widget switches to its compact view
//   }
// All text comes from SejongI18n (_locales/*/messages.json); menu names stay Korean + English.
// Internal fields (selectors, mobile_path_note, ids, site codes) are never shown.
// The click path starts where the student is (S.trimRouteForSite): on the library site, a guide
// to a library page does not send them back to the portal first.
// Answer card: some questions need a short explanation before any result ("seat reservation":
// reading-room seats are issued at the kiosks, not booked online). background.js matches the
// question against data/answers.json; the card shows above the results with one button per
// item that does exist (free seats, room booking). Its text is in messages.json.
(function (root) {
  "use strict";

  const S = root.SejongShared;
  const I = root.SejongI18n;
  const CONFIG = root.SEJONG_CONFIG;
  const t = (key, subs) => I.t(key, subs);

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
    return node;
  }

  function renderCrumbs(ol, route, highlightIndex, doneBefore) {
    ol.replaceChildren(...S.crumbsModel(route, highlightIndex, doneBefore).map((c) =>
      el("li", { class: c.state },
        el("span", { class: "crumb" }, el("span", { text: c.ko }), c.en ? el("span", { class: "en", text: c.en }) : null))));
  }

  function mount(container, adapter) {
    // ---- model: survives a rebuild (UI language change)
    // path: the full route from the backend (from portal.root); shown and started trimmed to the
    // tab's site. notice: "You are already in the Library" + the better result it offers.
    const model = { query: "", results: null, chosen: -1, searching: false, path: [], targetId: null, error: "", notice: null, answer: null };
    const settings = { keepEnglish: true, translatePopups: true, display: "widget", uiLanguage: "auto" };
    let languages = [];
    let parts = null;
    let destroyed = false;

    function showError(error) {
      model.error = t("backend_error", [error.message, CONFIG.BACKEND_URL]);
      parts.error.hidden = false;
      parts.error.textContent = model.error;
    }

    // ---------------------------------------------------------------- build (all text here)

    function build() {
      const q = el("input", { class: "q", type: "search", autocomplete: "off", placeholder: t("search_placeholder"),
        "aria-label": t("search_label") });
      q.value = model.query;
      const suggestions = el("ul", { class: "suggestions", hidden: true });
      const results = el("ol", { class: "results" });
      const crumbs = el("ol", { class: "crumbs" });
      const start = el("button", { class: "primary", text: t("show_me") });
      const open = el("button", { hidden: true });
      const stop = el("button", { text: t("stop") });
      const status = el("p", { class: "muted status", "aria-live": "polite" });
      const noticeText = el("span");
      const noticeButton = el("button", { class: "primary" });
      const notice = el("div", { class: "banner notice", hidden: true }, noticeText, el("div", { class: "row" }, noticeButton));
      const answerText = el("p");
      const answerButtons = el("div", { class: "row" });
      const answer = el("div", { class: "banner notice answer", hidden: true }, answerText, answerButtons);
      const route = el("div", { class: "route", hidden: true },
        el("h3", { text: t("click_path") }), crumbs, el("div", { class: "row" }, start, open, stop), status);
      const error = el("p", { class: "banner", hidden: !model.error, text: model.error });

      const checkbox = (key, label) => {
        const input = el("input", { type: "checkbox" });
        input.checked = settings[key] !== false;
        input.addEventListener("change", () => chrome.storage.local.set({ [key]: input.checked }));
        return el("label", {}, input, " " + label);
      };
      const select = (key, options, label) => {
        const input = el("select", { "aria-label": label },
          ...options.map(([value, text]) => el("option", { value, text, selected: settings[key] === value })));
        input.addEventListener("change", () => chrome.storage.local.set({ [key]: input.value }));
        return el("label", {}, label + " ", input);
      };
      const displayHint = el("p", { class: "muted", text: settings.display === "panel" ? t("display_panel_hint") : t("display_widget_hint") });
      const settingsBox = el("details", { class: "settings" },
        el("summary", { text: t("settings") }),
        checkbox("keepEnglish", t("setting_keep_english")),
        checkbox("translatePopups", t("setting_translate_popups")),
        el("p", { class: "muted", text: t("settings_reload_note") }),
        select("display", [["widget", t("display_widget")], ["panel", t("display_panel")]], t("setting_display")),
        displayHint,
        select("uiLanguage", [["auto", t("ui_language_auto")], ...languages.map((l) => [l.code, l.name])], t("setting_ui_language")));

      container.replaceChildren(error, el("div", { class: "search-box" }, q, suggestions), answer, results, notice, route, settingsBox);
      parts = { q, suggestions, results, route, crumbs, start, open, stop, status, error, notice, noticeText, noticeButton, answer, answerText, answerButtons };
      wire();
      renderAnswer();
      renderResults();
      renderNotice();
      renderGuide();
    }

    // ---------------------------------------------------------------- suggestions

    let suggestTimer = null;
    let suggestToken = 0;
    let active = -1;
    function hideSuggestions() { parts.suggestions.hidden = true; active = -1; }

    async function updateSuggestions() {
      const prefix = parts.q.value.trim();
      const token = ++suggestToken;
      if (!prefix) return hideSuggestions();
      try {
        const list = await adapter.send({ type: "api:suggest", prefix });
        if (token !== suggestToken || destroyed) return; // a newer keystroke already answered
        parts.suggestions.replaceChildren(...list.map((text) => {
          const li = el("li", { text });
          li.addEventListener("mousedown", (e) => {
            e.preventDefault();
            parts.q.value = text;
            hideSuggestions();
            runSearch(text);
          });
          return li;
        }));
        parts.suggestions.hidden = list.length === 0;
        active = -1;
      } catch (e) {
        showError(e);
      }
    }

    function wire() {
      const { q } = parts;
      q.addEventListener("input", () => {
        model.query = q.value;
        clearTimeout(suggestTimer);
        suggestTimer = setTimeout(updateSuggestions, 150);
      });
      q.addEventListener("keydown", (e) => {
        const items = [...parts.suggestions.children];
        if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !parts.suggestions.hidden && items.length) {
          e.preventDefault();
          active = (active + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
          items.forEach((li, i) => li.classList.toggle("active", i === active));
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          if (active >= 0 && items[active]) q.value = items[active].textContent;
          hideSuggestions();
          runSearch(q.value);
        }
        if (e.key === "Escape") hideSuggestions();
      });
      q.addEventListener("blur", () => setTimeout(() => !destroyed && hideSuggestions(), 100));

      parts.start.addEventListener("click", async () => {
        if (model.path.length < 2) return;
        const path = S.trimRouteForSite(model.path, await adapter.site()); // start where the student is
        try {
          await adapter.send({ type: "guide:start", tabId: await adapter.tabId(), path, targetId: model.targetId });
        } catch (e) {
          parts.status.textContent = t("cannot_guide", [e.message]);
          return;
        }
        if (adapter.onGuideStarted) adapter.onGuideStarted();
        renderGuide();
      });
      parts.stop.addEventListener("click", async () => {
        await adapter.send({ type: "guide:stop" }).catch(() => {});
        renderGuide();
      });
    }

    // ---------------------------------------------------------------- results and route

    async function runSearch(text) {
      if (!text.trim()) return;
      model.query = text;
      model.searching = true;
      model.results = null;
      model.answer = null;
      parts.route.hidden = true;
      renderAnswer();
      renderResults();
      const answer = adapter.send({ type: "ui:answer", query: text }).catch(() => null);
      try {
        model.results = await adapter.send({ type: "api:search", query: text, k: CONFIG.SEARCH_K });
        model.error = "";
        parts.error.hidden = true;
      } catch (e) {
        model.results = [];
        showError(e);
      }
      model.answer = await answer;
      model.searching = false;
      if (destroyed) return;
      renderAnswer();
      renderResults();
      // Show the path of the best result right away, unless an answer card explains first.
      if (model.results.length && !model.answer) choose(0);
    }

    function renderAnswer() {
      const a = model.answer;
      parts.answer.hidden = !a;
      if (!a) return;
      parts.answerText.textContent = t(a.message);
      parts.answerButtons.replaceChildren(...a.actions.map((action) => {
        const button = el("button", { text: t(action.label) });
        button.addEventListener("click", () => {
          model.chosen = model.results ? model.results.findIndex((r) => r.id === action.item.id) : -1;
          renderResults();
          showItem(action.item);
        });
        return button;
      }));
    }

    function renderResults() {
      const ol = parts.results;
      if (model.searching) return ol.replaceChildren(el("li", { class: "muted", text: t("searching") }));
      if (model.results === null) return ol.replaceChildren();
      if (!model.results.length) return ol.replaceChildren(model.error ? "" : el("li", { class: "muted", text: t("no_match") }));
      ol.replaceChildren(...model.results.map((item, i) => {
        const english = S.englishName(item);
        const li = el("li", { class: i === model.chosen ? "chosen" : "" },
          el("div", { class: "ko", text: item.name_ko || english }),
          english && item.name_ko ? el("div", { text: english }) : null,
          el("div", { class: "meta" }, el("span", { class: "site", text: S.siteName(item.site, t) }),
            el("span", { text: t("score", [item.score.toFixed(2)]) })));
        li.addEventListener("click", () => choose(i));
        return li;
      }));
    }

    async function choose(i) {
      model.chosen = i;
      renderResults();
      await showItem(model.results[i]);
    }

    // An entry link into the site the student is already on (portal.library while on the
    // library site): say so, and offer the best result that is ON this site instead.
    async function offerInsteadOfEntry(item, site) {
      let better = null;
      try {
        const wider = await adapter.send({ type: "api:search", query: model.query, k: 20 });
        better = wider.find((r) => r.site === site && r.kind !== "entry") || null;
      } catch (e) { /* keep the message without an offer */ }
      if (destroyed) return;
      model.notice = { text: t("already_on_site", [S.siteName(site, t, true)]), better };
      renderNotice();
    }

    function renderNotice() {
      const n = model.notice;
      parts.notice.hidden = !n;
      if (!n) return;
      parts.noticeText.textContent = n.text;
      parts.noticeButton.hidden = !n.better;
      if (n.better) {
        parts.noticeButton.textContent = t("show_instead", [S.bothNames(n.better)]);
        parts.noticeButton.onclick = () => {
          model.notice = null;
          renderNotice();
          if (!model.results.some((r) => r.id === n.better.id)) model.results = [n.better, ...model.results];
          model.chosen = model.results.findIndex((r) => r.id === n.better.id);
          renderResults();
          showItem(n.better);
        };
      }
    }

    async function showItem(item) {
      model.notice = null;
      renderNotice();
      const site = await adapter.site();
      if (S.entryOnSite(item, site)) {
        model.path = [];
        model.targetId = null;
        parts.route.hidden = true;
        return offerInsteadOfEntry(item, site);
      }
      try {
        // route() returns the full items: names for the breadcrumbs, selectors/names for the guide
        model.path = await adapter.send({ type: "api:route", from: CONFIG.ROOT_ID, to: item.id });
        model.targetId = item.id;
        renderGuide();
      } catch (e) {
        showError(e);
      }
    }

    // The step is on another Sejong site: "Open Portal" (background reuses an open tab of it).
    function offerSite(site) {
      parts.open.hidden = false;
      parts.open.textContent = t("open_site", [S.siteName(site, t)]);
      parts.open.onclick = async () => {
        try { await adapter.send({ type: "tab:openSite", site, tabId: await adapter.tabId() }); } catch (e) { showError(e); }
      };
    }

    function offerOpen(route) {
      // Nothing from the path is visible here: offer the deepest step that has a URL.
      const withUrl = [...route].reverse().find((s) => s.url);
      if (!withUrl) return;
      parts.open.hidden = false;
      parts.open.textContent = t("open_item", [S.nameOf(withUrl)]);
      parts.open.onclick = async () => {
        await adapter.openUrl(withUrl.url); // the guide continues on the new page by itself
        parts.open.hidden = true;
      };
    }

    // ---------------------------------------------------------------- guide (state lives in storage)

    let renderToken = 0;
    async function renderGuide() {
      const token = ++renderToken;
      let state;
      try { state = await adapter.getState(); } catch (e) { return; }
      if (token !== renderToken || destroyed || !parts) return; // a newer render is on its way
      const { guide, last, view } = state || {};
      if (guide && !model.targetId) { // just opened: restore the running guide
        model.path = guide.route;
        model.targetId = guide.targetId;
      }
      parts.open.hidden = true;
      if (!model.path.length) { parts.route.hidden = true; return; }
      parts.route.hidden = false;

      const following = !!guide && guide.targetId === model.targetId;
      parts.start.hidden = following;
      parts.stop.hidden = !following;
      if (following) {
        const info = S.guideStatus(guide, view);
        renderCrumbs(parts.crumbs, guide.route, info.index, guide.step);
        parts.status.textContent = S.guideMessage(guide, info, t);
        if (info.kind === "other-site") offerSite(guide.route[info.index].site);
        else if (info.kind === "missing" || info.kind === "other-tab") offerOpen(guide.route);
        return;
      }
      const site = await adapter.site();
      if (token !== renderToken || destroyed) return; // a newer render started while we asked
      renderCrumbs(parts.crumbs, S.trimRouteForSite(model.path, site));
      parts.status.textContent = S.idleMessage(model.path, model.targetId, guide, last, t);
    }

    // ---------------------------------------------------------------- settings and language

    const onSettings = (changes, area) => {
      if (area !== "local" || destroyed) return;
      let rebuild = false;
      for (const key of Object.keys(settings)) {
        if (changes[key] && key !== "uiLanguage") { settings[key] = changes[key].newValue; rebuild = true; }
      }
      if (rebuild) build();
    };
    chrome.storage.onChanged.addListener(onSettings);
    I.onChange(() => { if (!destroyed) { settings.uiLanguage = I.language(); build(); } });

    (async () => {
      const stored = await chrome.storage.local.get(Object.keys(settings)).catch(() => ({}));
      settings.keepEnglish = stored.keepEnglish !== false;
      settings.translatePopups = stored.translatePopups !== false;
      settings.display = stored.display === "panel" ? "panel" : "widget";
      settings.uiLanguage = stored.uiLanguage || "auto";
      languages = await I.listLanguages().catch(() => []);
      if (!destroyed) build();
    })();

    build();
    adapter.send({ type: "api:health" }).catch((e) => !destroyed && showError(e));

    return {
      refresh: () => renderGuide(),
      focus: () => parts && parts.q.focus(),
      destroy: () => {
        destroyed = true;
        chrome.storage.onChanged.removeListener(onSettings);
        container.replaceChildren();
      },
    };
  }

  root.SejongUI = Object.freeze({ mount, renderCrumbs, el });
})(globalThis);
