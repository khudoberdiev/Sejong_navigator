// AI-generated — to be rewritten by me
// Side panel UI (popup.html, shown in Chrome's side panel). Talks only to background.js
// (which talks to the backend and the pages).
//   Search tab: live suggestions → top-3 results with scores → click path as ko/en breadcrumbs
//               → "Show me on this page" starts the on-page guide. The running guide (in
//               chrome.storage.session) is restored when the panel opens and re-rendered on
//               every change and tab switch.
//   Record tab: controls for the menu recorder, review list, export/import.

const { BACKEND_URL, ROOT_ID, SEARCH_K } = window.SEJONG_CONFIG;
const S = window.SejongShared;
const $ = (id) => document.getElementById(id);

async function send(message) {
  const answer = await chrome.runtime.sendMessage(message);
  if (!answer || !answer.ok) throw new Error(answer ? answer.error : "No answer from the extension");
  return answer.data;
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  node.append(...children.filter((c) => c !== null && c !== undefined));
  return node;
}

function showBackendError(error) {
  $("backend-error").hidden = false;
  $("backend-error").textContent =
    `${error.message} Start it with: .venv/bin/uvicorn api.main:app --port 8000 (or change BACKEND_URL in config.js; now ${BACKEND_URL}).`;
}

// ---------------------------------------------------------------- tabs

function showTab(name) {
  for (const button of document.querySelectorAll(".tab")) {
    button.setAttribute("aria-selected", String(button.dataset.tab === name));
  }
  $("tab-search").hidden = name !== "search";
  $("tab-record").hidden = name !== "record";
  try { localStorage.setItem("tab", name); } catch (e) { /* storage blocked: fine */ }
  if (name === "record") refreshRecorder();
  else $("q").focus();
}

for (const button of document.querySelectorAll(".tab")) {
  button.addEventListener("click", () => showTab(button.dataset.tab));
}

// ---------------------------------------------------------------- search: suggestions

let suggestTimer = null;
let suggestToken = 0;
let activeSuggestion = -1;

function hideSuggestions() {
  $("suggestions").hidden = true;
  activeSuggestion = -1;
}

async function updateSuggestions() {
  const prefix = $("q").value.trim();
  const token = ++suggestToken;
  if (!prefix) return hideSuggestions();
  try {
    const list = await send({ type: "api:suggest", prefix });
    if (token !== suggestToken) return; // a newer keystroke already answered
    const ul = $("suggestions");
    ul.replaceChildren(...list.map((text) => {
      const li = el("li", {}, text);
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        $("q").value = text;
        hideSuggestions();
        runSearch(text);
      });
      return li;
    }));
    ul.hidden = list.length === 0;
    activeSuggestion = -1;
  } catch (e) {
    showBackendError(e);
  }
}

$("q").addEventListener("input", () => {
  clearTimeout(suggestTimer);
  suggestTimer = setTimeout(updateSuggestions, 150);
});

$("q").addEventListener("keydown", (e) => {
  const items = [...$("suggestions").children];
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !$("suggestions").hidden && items.length) {
    e.preventDefault();
    activeSuggestion = (activeSuggestion + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
    items.forEach((li, i) => li.classList.toggle("active", i === activeSuggestion));
    return;
  }
  if (e.key === "Enter") {
    e.preventDefault();
    if (activeSuggestion >= 0 && items[activeSuggestion]) $("q").value = items[activeSuggestion].textContent;
    hideSuggestions();
    runSearch($("q").value);
  }
  if (e.key === "Escape") hideSuggestions();
});

$("q").addEventListener("blur", () => setTimeout(hideSuggestions, 100));

// ---------------------------------------------------------------- search: results and route

let currentPath = [];     // the click path shown in the panel
let currentTarget = null;  // id of the item it leads to

async function runSearch(text) {
  if (!text.trim()) return;
  $("route").hidden = true;
  const ol = $("results");
  ol.replaceChildren(el("li", { class: "muted" }, "Searching…"));
  try {
    const results = await send({ type: "api:search", query: text, k: SEARCH_K });
    if (!results.length) {
      ol.replaceChildren(el("li", { class: "muted" }, "No match."));
      return;
    }
    ol.replaceChildren(...results.map((item) => {
      const li = el("li", {},
        el("div", { class: "ko" }, item.name_ko || item.name_en),
        item.name_en && item.name_ko ? el("div", {}, item.name_en) : null,
        el("div", { class: "meta" }, el("span", { class: "site" }, item.site), el("span", {}, `score ${item.score.toFixed(2)}`)));
      li.addEventListener("click", () => {
        for (const other of ol.children) other.classList.remove("chosen");
        li.classList.add("chosen");
        showRoute(item);
      });
      return li;
    }));
    ol.firstElementChild.click(); // show the path of the best result right away
  } catch (e) {
    ol.replaceChildren();
    showBackendError(e);
  }
}

function renderCrumbs(ol, path, highlightIndex = -1, doneBefore = 0) {
  ol.replaceChildren(...path.map((item, i) => el("li", {
    class: i === highlightIndex ? "current" : (i > 0 && i < doneBefore ? "done" : ""),
  },
    el("span", { class: "crumb" },
      el("span", {}, item.name_ko || item.name_en || item.id),
      item.name_ko && item.name_en ? el("span", { class: "en" }, item.name_en) : null))));
}

async function showRoute(item) {
  try {
    // route() returns the full items: names for the breadcrumbs, selector/names for the guide
    currentPath = await send({ type: "api:route", from: ROOT_ID, to: item.id });
    currentTarget = item.id;
    renderGuide();
  } catch (e) {
    showBackendError(e);
  }
}

// ---------------------------------------------------------------- guide (state lives in storage)

// background.js owns the guide and writes it to chrome.storage.session; the panel only
// renders it: on open, on every storage change, and when the active tab changes.
let panelWindowId = null;
const nameOf = (item) => (item && (item.name_ko || item.name_en || item.id)) || "";

async function guideState() {
  const tabId = await activeTabId();
  const viewKey = tabId === undefined ? null : `guideView:${tabId}`;
  const s = await chrome.storage.session.get(["activeGuide", "guideLast"].concat(viewKey ? [viewKey] : []));
  return { guide: S.isGuide(s.activeGuide) ? s.activeGuide : null, last: s.guideLast || null, view: viewKey ? s[viewKey] : null };
}

function offerOpen(route) {
  // Nothing from the path is visible here: offer the deepest step that has a URL.
  const withUrl = [...route].reverse().find((s) => s.url);
  if (!withUrl) return;
  $("guide-open").hidden = false;
  $("guide-open").textContent = `Open ${nameOf(withUrl)}`;
  $("guide-open").onclick = async () => {
    // The panel stays open; the guide continues on the new page by itself.
    await chrome.tabs.update(await activeTabId(), { url: withUrl.url });
    $("guide-open").hidden = true;
  };
}

function guideText(guide, info) {
  const last = guide.route.length - 1;
  const step = guide.route[guide.step];
  const shown = guide.route[info.index];
  const of = `Step ${guide.step} of ${last}`;
  switch (info.kind) {
    case "here": return `You are there: “${nameOf(shown)}” is highlighted. Click it to finish.`;
    case "next": return `Step ${info.index} of ${last}: click the highlighted “${nameOf(shown)}”.`;
    case "hint": return `${of}: open “${nameOf(shown)}” first (highlighted), then click “${nameOf(step)}”.`;
    case "missing": return `${of}: “${nameOf(step)}” is not visible on this page yet.`;
    case "other-tab": return `${of}: “${nameOf(step)}”. This tab is not a Sejong page; switch to the Sejong tab.`;
    default: return `${of}: “${nameOf(step)}”. Checking this tab…`;
  }
}

let renderToken = 0;
async function renderGuide() {
  const token = ++renderToken;
  let state;
  try { state = await guideState(); } catch (e) { return; }
  if (token !== renderToken) return; // a newer render is on its way
  const { guide, last, view } = state;
  if (guide && !currentTarget) { // panel just opened: restore the running guide
    currentPath = guide.route;
    currentTarget = guide.targetId;
  }
  $("guide-open").hidden = true;
  if (!currentPath.length) { $("route").hidden = true; return; }
  $("route").hidden = false;

  const following = !!guide && guide.targetId === currentTarget;
  $("guide-start").hidden = following;
  $("guide-stop").hidden = !following;
  const status = $("guide-status");
  if (following) {
    const info = S.guideStatus(guide, view);
    renderCrumbs($("crumbs"), guide.route, info.index, guide.step);
    status.textContent = guideText(guide, info);
    if (info.kind === "missing" || info.kind === "other-tab") offerOpen(guide.route);
    return;
  }
  renderCrumbs($("crumbs"), currentPath);
  if (currentPath.length < 2) status.textContent = "No click path to this item.";
  else if (guide) status.textContent = `A guide to “${nameOf(guide.route[guide.route.length - 1])}” is running. “Show me” replaces it.`;
  else if (last && last.targetId === currentTarget) {
    status.textContent = last.outcome === "finished" ? `Done: you reached “${last.name}”.` : "Guide stopped.";
  } else status.textContent = "";
}

$("guide-start").addEventListener("click", async () => {
  if (currentPath.length < 2) return;
  try {
    await send({ type: "guide:start", tabId: await activeTabId(), path: currentPath, targetId: currentTarget });
  } catch (e) {
    $("guide-status").textContent = `Cannot guide on this tab (${e.message}). Open a Sejong page first.`;
    return;
  }
  renderGuide();
});

$("guide-stop").addEventListener("click", async () => {
  await send({ type: "guide:stop" }).catch(() => {});
  renderGuide();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session") return;
  if (Object.keys(changes).some((k) => k === "activeGuide" || k === "guideLast" || k.startsWith("guideView:"))) renderGuide();
});

// The panel's window: show the guide status of whichever tab is active there.
chrome.windows.getCurrent().then((w) => { panelWindowId = w.id; }).catch(() => {});
chrome.tabs.onActivated.addListener(({ windowId }) => {
  if (windowId === panelWindowId) renderGuide(); // background.js re-checks the tab and updates its view
});
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (tab.active && tab.windowId === panelWindowId && info.status === "complete") renderGuide();
});

// ---------------------------------------------------------------- recorder

async function refreshRecorder() {
  try {
    const state = await send({ type: "rec:state" });
    $("rec-toggle").textContent = state.recording ? "Stop recording clicks" : "Start recording clicks";
    $("rec-undo").disabled = !state.canUndo;
    $("rec-count").textContent = state.count;
    $("rec-chain").replaceChildren(...(state.chain.length
      ? state.chain.map((c) => el("li", {}, c.label || c.id))
      : [el("li", { class: "muted" }, "site root (new path)")]));
    $("rec-list").replaceChildren(...(state.items.length ? state.items.map((row) => {
      const remove = el("button", { title: "Delete this item and everything below it" }, "✕");
      remove.addEventListener("click", async () => {
        await send({ type: "rec:delete", id: row.id });
        refreshRecorder();
      });
      return el("li", {}, el("span", { class: "path" }, el("span", { class: "site" }, row.site + " "), row.path), remove);
    }) : [el("li", { class: "empty" }, "Nothing recorded yet.")]));
  } catch (e) {
    $("rec-status").textContent = e.message;
  }
}

$("rec-toggle").addEventListener("click", async () => {
  const state = await send({ type: "rec:state" });
  await send({ type: "rec:setRecording", on: !state.recording });
  $("rec-status").textContent = state.recording
    ? "Recording stopped."
    : "Recording. Click through the menu on the page, from the top level down to the page you want.";
  refreshRecorder();
});

$("rec-scan").addEventListener("click", async () => {
  $("rec-status").textContent = "Scanning…";
  try {
    const result = await send({ type: "rec:scan", tabId: await activeTabId() });
    $("rec-status").textContent = result.frames
      ? `Scanned ${result.frames} frame(s): ${result.created} new item(s).`
      : "No Sejong page in this tab (or reload the page once after installing the extension).";
  } catch (e) {
    $("rec-status").textContent = e.message;
  }
  refreshRecorder();
});

$("rec-newpath").addEventListener("click", async () => {
  await send({ type: "rec:newPath" });
  $("rec-status").textContent = "New path: the next click hangs under the site root.";
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
  $("rec-status").textContent = `Exported ${menuMap.items.length} items (site roots included).`;
});

$("rec-import").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const created = await send({ type: "rec:import", json: JSON.parse(await file.text()) });
    $("rec-status").textContent = `Imported ${file.name}: ${created} new item(s) merged.`;
  } catch (err) {
    $("rec-status").textContent = `Import failed: ${err.message}`;
  }
  e.target.value = "";
  refreshRecorder();
});

$("rec-clear").addEventListener("click", async () => {
  if (!confirm("Delete ALL recorded items? Export first if you want to keep them.")) return;
  await send({ type: "rec:clear" });
  refreshRecorder();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.recStore || changes.recording) && !$("tab-record").hidden) refreshRecorder();
});

// ---------------------------------------------------------------- settings (both on by default)

for (const [id, key] of [["opt-english", "keepEnglish"], ["opt-translate", "translatePopups"]]) {
  chrome.storage.local.get(key).then((r) => { $(id).checked = r[key] !== false; });
  $(id).addEventListener("change", () => chrome.storage.local.set({ [key]: $(id).checked }));
}

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

let startTab = "search";
try { startTab = localStorage.getItem("tab") || "search"; } catch (e) { /* ignore */ }
showTab(startTab);
renderGuide(); // restore a running guide
activeTabId().then((tabId) => send({ type: "guide:refresh", tabId })).catch(() => {});
send({ type: "api:health" }).catch(showBackendError);
