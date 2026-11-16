// AI-generated — to be rewritten by me
// Popup UI. Talks only to background.js (which talks to the backend and the pages).
//   Search tab: live suggestions → top-3 results with scores → click path as ko/en breadcrumbs
//               → "Show me on this page" starts the on-page guide.
//   Record tab: controls for the menu recorder, review list, export/import.

const { BACKEND_URL, ROOT_ID, SEARCH_K } = window.SEJONG_CONFIG;
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

let currentPath = [];

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

function renderCrumbs(ol, path, highlightIndex = -1) {
  ol.replaceChildren(...path.map((item, i) => el("li", { class: i === highlightIndex ? "current" : "" },
    el("span", { class: "crumb" },
      el("span", {}, item.name_ko || item.name_en || item.id),
      item.name_ko && item.name_en ? el("span", { class: "en" }, item.name_en) : null))));
}

async function showRoute(item) {
  try {
    // route() returns the full items: names for the breadcrumbs, selector/names for the guide
    currentPath = await send({ type: "api:route", from: ROOT_ID, to: item.id });
    $("route").hidden = false;
    $("guide-open").hidden = true;
    $("guide-status").textContent = currentPath.length ? "" : "No click path to this item.";
    renderCrumbs($("crumbs"), currentPath);
  } catch (e) {
    showBackendError(e);
  }
}

$("guide-start").addEventListener("click", async () => {
  if (!currentPath.length) return;
  const status = $("guide-status");
  try {
    const result = await send({ type: "guide:start", tabId: await activeTabId(), path: currentPath });
    renderCrumbs($("crumbs"), currentPath, result.index);
    if (result.index >= 0) {
      const step = currentPath[result.index];
      status.textContent = result.index === currentPath.length - 1
        ? `You are there: ${step.name_ko || step.name_en} is highlighted.`
        : `Step ${result.index} of ${currentPath.length - 1}: click the highlighted “${step.name_ko || step.name_en}”.`;
      $("guide-open").hidden = true;
    } else {
      // Nothing from the path is visible here: offer the deepest step that has a URL.
      const withUrl = [...currentPath].reverse().find((s) => s.url);
      status.textContent = "No step of this path is visible on the current page.";
      if (withUrl) {
        $("guide-open").hidden = false;
        $("guide-open").textContent = `Open ${withUrl.name_ko || withUrl.name_en}`;
        $("guide-open").onclick = async () => {
          await chrome.tabs.update(await activeTabId(), { url: withUrl.url });
          window.close(); // the guide continues on the new page
        };
      }
    }
  } catch (e) {
    status.textContent = `Cannot guide on this tab (${e.message}). Open a Sejong page first.`;
  }
});

$("guide-stop").addEventListener("click", async () => {
  await send({ type: "guide:stop", tabId: await activeTabId() }).catch(() => {});
  $("guide-status").textContent = "Guide stopped.";
  renderCrumbs($("crumbs"), currentPath);
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
    : "Recording. Close this popup and click through the menu, from the top level down to the page you want.";
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

// ---------------------------------------------------------------- start

let startTab = "search";
try { startTab = localStorage.getItem("tab") || "search"; } catch (e) { /* ignore */ }
showTab(startTab);
send({ type: "api:health" }).catch(showBackendError);
