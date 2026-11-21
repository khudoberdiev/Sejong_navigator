// AI-generated — to be rewritten by me
// Side panel (popup.html, in Chrome's side panel): the fallback UI when Settings → Display is
// "Side panel"; the default is the floating widget on Sejong pages (widget.js).
//   Search tab: ui.js (the same guide UI as the widget's full view), about the ACTIVE tab.
//   Record tab: controls for the menu recorder, review list, export/import (panel only).
// Talks only to background.js. All text: _locales/*/messages.json via SejongI18n.

const S = window.SejongShared;
const I = window.SejongI18n;
const t = (key, subs) => I.t(key, subs);
const $ = (id) => document.getElementById(id);

async function send(message) {
  const answer = await chrome.runtime.sendMessage(message);
  if (!answer || !answer.ok) throw new Error(answer ? answer.error : t("no_answer"));
  return answer.data;
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id;
}

const el = (tag, attrs, ...children) => window.SejongUI.el(tag, attrs, ...children);

// ---------------------------------------------------------------- tabs

function showTab(name) {
  for (const button of document.querySelectorAll(".tab")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  $("tab-search").hidden = name !== "search";
  $("tab-record").hidden = name !== "record";
  try { localStorage.setItem("tab", name); } catch (e) { /* storage blocked: fine */ }
  if (name === "record") refreshRecorder();
  else if (guideUI) guideUI.focus();
}

for (const button of document.querySelectorAll(".tab")) {
  button.addEventListener("click", () => showTab(button.dataset.tab));
}

// ---------------------------------------------------------------- search tab: ui.js

// background.js owns the guide (chrome.storage.session); the panel renders it for whichever
// tab is active in its window: on open, on every storage change, and when the tab changes.
let guideUI = null;
let panelWindowId = null;

async function panelState() {
  const tabId = await activeTabId();
  const viewKey = tabId === undefined ? null : `guideView:${tabId}`;
  const s = await chrome.storage.session.get(["activeGuide", "guideLast"].concat(viewKey ? [viewKey] : []));
  return { guide: S.isGuide(s.activeGuide) ? s.activeGuide : null, last: s.guideLast || null, view: viewKey ? s[viewKey] : null };
}

function mountGuideUI() {
  guideUI = window.SejongUI.mount($("tab-search"), {
    send,
    getState: panelState,
    tabId: activeTabId,
    openUrl: async (url) => chrome.tabs.update(await activeTabId(), { url }),
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !guideUI) return;
  if (Object.keys(changes).some((k) => k === "activeGuide" || k === "guideLast" || k.startsWith("guideView:"))) guideUI.refresh();
});
chrome.windows.getCurrent().then((w) => { panelWindowId = w.id; }).catch(() => {});
chrome.tabs.onActivated.addListener(({ windowId }) => {
  if (windowId === panelWindowId && guideUI) guideUI.refresh(); // background.js re-checks the tab too
});
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (tab.active && tab.windowId === panelWindowId && info.status === "complete" && guideUI) guideUI.refresh();
});

// ---------------------------------------------------------------- recorder

async function refreshRecorder() {
  try {
    const state = await send({ type: "rec:state" });
    $("rec-toggle").textContent = state.recording ? t("rec_stop") : t("rec_start");
    $("rec-undo").disabled = !state.canUndo;
    $("rec-count").textContent = t("rec_count", [state.count]);
    $("rec-chain").replaceChildren(...(state.chain.length
      ? state.chain.map((c) => el("li", { text: c.label || c.id }))
      : [el("li", { class: "muted", text: t("rec_site_root") })]));
    $("rec-list").replaceChildren(...(state.items.length ? state.items.map((row) => {
      const remove = el("button", { title: t("rec_delete_item"), "aria-label": t("rec_delete_item"), text: "✕" });
      remove.addEventListener("click", async () => {
        await send({ type: "rec:delete", id: row.id });
        refreshRecorder();
      });
      return el("li", {}, el("span", { class: "path" }, el("span", { class: "site", text: row.site + " " }), row.path), remove);
    }) : [el("li", { class: "empty", text: t("rec_empty") })]));
  } catch (e) {
    $("rec-status").textContent = e.message;
  }
}

$("rec-toggle").addEventListener("click", async () => {
  const state = await send({ type: "rec:state" });
  await send({ type: "rec:setRecording", on: !state.recording });
  $("rec-status").textContent = state.recording ? t("rec_stopped") : t("rec_recording");
  refreshRecorder();
});

$("rec-scan").addEventListener("click", async () => {
  $("rec-status").textContent = t("rec_scanning");
  try {
    const result = await send({ type: "rec:scan", tabId: await activeTabId() });
    $("rec-status").textContent = result.frames
      ? t("rec_scanned", [result.frames, result.created])
      : t("rec_no_sejong_page");
  } catch (e) {
    $("rec-status").textContent = e.message;
  }
  refreshRecorder();
});

$("rec-newpath").addEventListener("click", async () => {
  await send({ type: "rec:newPath" });
  $("rec-status").textContent = t("rec_new_path_done");
  refreshRecorder();
});

$("rec-undo").addEventListener("click", async () => {
  await send({ type: "rec:undo" });
  refreshRecorder();
});

$("rec-export").addEventListener("click", async () => {
  const menuMap = await send({ type: "rec:export" });
  const blob = new Blob([JSON.stringify(menuMap, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  el("a", { href: url, download: `menu_map.recorded.${date}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $("rec-status").textContent = t("rec_exported", [menuMap.items.length]);
});

$("rec-import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const created = await send({ type: "rec:import", json: JSON.parse(await file.text()) });
    $("rec-status").textContent = t("rec_imported", [file.name, created]);
  } catch (err) {
    $("rec-status").textContent = t("rec_import_failed", [err.message]);
  }
  e.target.value = "";
  refreshRecorder();
});

$("rec-clear").addEventListener("click", async () => {
  if (!confirm(t("rec_clear_confirm"))) return;
  await send({ type: "rec:clear" });
  refreshRecorder();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.recStore || changes.recording) && !$("tab-record").hidden) refreshRecorder();
});

// ---------------------------------------------------------------- close button

// chrome.sidePanel.close() exists only from Chrome 141. Older Chrome: closing the
// panel's own page with window.close() closes the panel.
$("panel-close").addEventListener("click", async () => {
  try {
    if (chrome.sidePanel && chrome.sidePanel.close) {
      const win = await chrome.windows.getCurrent();
      await chrome.sidePanel.close({ windowId: win.id });
      return;
    }
  } catch (e) { /* fall through */ }
  window.close();
});

// ---------------------------------------------------------------- start

(async () => {
  await I.init();
  I.apply(document);
  document.documentElement.lang = I.language() === "auto" ? chrome.i18n.getUILanguage() : I.language().replace("_", "-");
  I.onChange(() => {
    I.apply(document);
    if (!$("tab-record").hidden) refreshRecorder();
  });
  mountGuideUI();
  let startTab = "search";
  try { startTab = localStorage.getItem("tab") || "search"; } catch (e) { /* ignore */ }
  showTab(startTab);
  activeTabId().then((tabId) => send({ type: "guide:refresh", tabId })).catch(() => {});
})();
