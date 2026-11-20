// AI-generated — to be rewritten by me
// Service worker. Five jobs:
//   1. The only code that talks to the backend (BACKEND_URL in config.js).
//   2. Keeps the menu recorder's data in chrome.storage.local and merges what content scripts send.
//   3. Runs the on-page guide: keeps the active guide in chrome.storage.session, asks every
//      frame of a tab which path steps it can see, tells one frame to highlight the step,
//      and advances the step when the user clicks the highlight.
//   4. Serves the Korean → English label pairs for Keep-English.
//   5. Relays pop-ups found in any frame to the top frame; optional self-hosted translation.
importScripts("config.js", "shared.js");

const { BACKEND_URL } = self.SEJONG_CONFIG;
const S = self.SejongShared;

// The UI (popup.html) lives in Chrome's side panel, so it stays open while you click the page.
// The toolbar icon opens/closes it. Calling this again on every worker start is harmless.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// ------------------------------------------------------------------ 1. backend

async function apiGet(path, params) {
  const url = `${BACKEND_URL}${path}?${new URLSearchParams(params)}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error(`Backend not reachable at ${BACKEND_URL}. Is the server running?`);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body && body.detail) || `HTTP ${res.status}`);
  return body;
}

// ------------------------------------------------------------------ 2. recorder

// Every change goes through this queue, so clicks arriving from several frames
// at the same moment never overwrite each other.
let queue = Promise.resolve();
function withStore(change) {
  const run = queue.then(async () => {
    const { recStore = S.newStore() } = await chrome.storage.local.get("recStore");
    const result = change(recStore);
    await chrome.storage.local.set({ recStore });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

async function isRecording() {
  const { recording = false } = await chrome.storage.local.get("recording");
  return recording;
}

function showBadge(on) {
  chrome.action.setBadgeText({ text: on ? "REC" : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#c3002f" });
}
isRecording().then(showBadge);

function recorderState(store, recording) {
  return {
    recording,
    count: S.listForReview(store).length,
    chain: store.chain.map((id) => ({ id, label: S.displayName(store.items[id]) })),
    items: S.listForReview(store),
    canUndo: store.history.length > 0,
  };
}

async function framesOf(tabId) {
  return (await chrome.webNavigation.getAllFrames({ tabId })) || [];
}

function sendToFrame(tabId, frameId, message) {
  return chrome.tabs.sendMessage(tabId, message, { frameId }).catch(() => null);
}

async function scanTab(tabId) {
  const frames = await framesOf(tabId);
  const answers = await Promise.all(frames.map((f) => sendToFrame(tabId, f.frameId, { type: "rec:scanFrame" })));
  let created = 0;
  let scanned = 0;
  await withStore((store) => {
    for (const answer of answers) {
      if (!answer || !answer.site) continue;
      scanned += 1;
      created += S.applyScan(store, answer.site, answer.paths).length;
    }
  });
  return { created, frames: scanned };
}

// ------------------------------------------------------------------ 3. guide

// ONE active guide for the whole browser, in chrome.storage.session, so it survives page
// loads, this worker going to sleep, and SSO opening SJPT in a new tab. This worker is the
// only writer; the side panel reads and watches these keys.
//   activeGuide        { route, step, targetId, startedAt }       (S.newGuide)
//   guideView:<tabId>  { startedAt, shown, step, sejong, at }     what that tab highlights now
//   guideLast          { outcome: "finished" | "stopped", targetId, name, at }
const GUIDE = "activeGuide";
const viewKey = (tabId) => `guideView:${tabId}`;
const SEJONG_TABS = ["portal", "sjpt", "ecampus", "library"].map((h) => `*://${h}.sejong.ac.kr/*`);

let guideQueue = Promise.resolve();
// change(guide) returns the new guide, null to delete it, or undefined to keep it as is.
function updateGuide(change) {
  const run = guideQueue.then(async () => {
    const before = (await chrome.storage.session.get(GUIDE))[GUIDE] || null;
    const after = change(before);
    if (after === undefined) return before;
    if (after === null) await chrome.storage.session.remove(GUIDE);
    else await chrome.storage.session.set({ [GUIDE]: after });
    return after;
  });
  guideQueue = run.catch(() => {});
  return run;
}
const getGuide = () => updateGuide(() => undefined);

async function runGuide(tabId) {
  const guide = await getGuide();
  if (!S.isGuide(guide)) return { active: false };
  const frames = await framesOf(tabId).catch(() => []);
  const probes = (await Promise.all(frames.map(async (f) => {
    const answer = await sendToFrame(tabId, f.frameId, { type: "guide:probe", path: guide.route });
    return answer ? { frameId: f.frameId, visible: answer.visible || [] } : null;
  }))).filter(Boolean);
  const pick = S.pickStep(guide, probes.flatMap((p) => p.visible));
  const target = pick.show >= 0 ? probes.find((p) => p.visible.includes(pick.show)) : null;
  // Save a forward jump, unless the guide was stopped or replaced while we were probing.
  const now = await updateGuide((g) => (g && g.startedAt === guide.startedAt && pick.step > g.step
    ? Object.assign({}, g, { step: pick.step }) : undefined));
  if (!now || now.startedAt !== guide.startedAt) return { active: false };
  await Promise.all(frames.map((f) => sendToFrame(tabId, f.frameId, target && f.frameId === target.frameId
    ? { type: "guide:show", path: guide.route, index: pick.show, startedAt: guide.startedAt }
    : { type: "guide:clear", guiding: true })));
  const view = { startedAt: guide.startedAt, shown: pick.show, step: now.step, sejong: probes.length > 0, at: Date.now() };
  await chrome.storage.session.set({ [viewKey(tabId)]: view });
  return Object.assign({ active: true, total: guide.route.length }, view);
}

// Page loads and clicks in several frames ask at almost the same time: debounce. Menus that
// are built by script (SJPT) may not exist yet when the page loads: look again a few times.
const GUIDE_DELAYS = [400, 1000, 2500, 5000];
const refreshTimers = {};
function scheduleGuide(tabId, attempt = 0) {
  clearTimeout(refreshTimers[tabId]);
  refreshTimers[tabId] = setTimeout(async () => {
    const r = await runGuide(tabId).catch(() => null);
    // Retry while the step to click is not on screen yet (nothing found, or only a parent).
    if (r && r.active && r.sejong && r.shown < r.step && attempt + 1 < GUIDE_DELAYS.length) scheduleGuide(tabId, attempt + 1);
  }, GUIDE_DELAYS[attempt]);
}

async function clearGuideEverywhere() {
  const all = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith("guideView:")));
  const tabs = await chrome.tabs.query({ url: SEJONG_TABS }).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    const frames = await framesOf(tab.id).catch(() => []);
    await Promise.all(frames.map((f) => sendToFrame(tab.id, f.frameId, { type: "guide:clear", guiding: false })));
  }));
}

async function startGuide(tabId, path, targetId) {
  const guide = S.newGuide(path, targetId, Date.now());
  if (!S.isGuide(guide)) throw new Error("This item has no click path to follow.");
  await updateGuide(() => null);
  await clearGuideEverywhere();
  await chrome.storage.session.remove("guideLast");
  await updateGuide(() => guide);
  return runGuide(tabId);
}

async function endGuide(outcome) {
  let before = null;
  await updateGuide((g) => { before = g; return null; });
  await clearGuideEverywhere();
  if (S.isGuide(before)) {
    const target = before.route[before.route.length - 1];
    await chrome.storage.session.set({ guideLast: {
      outcome, targetId: before.targetId, name: target.name_ko || target.name_en || target.id, at: Date.now(),
    } });
  }
  return true;
}

async function guideClicked(msg, sender) {
  let finished = false;
  await updateGuide((g) => {
    if (!S.isGuide(g) || g.startedAt !== msg.startedAt) return undefined; // a click on an old guide's highlight
    const r = S.advanceGuide(g, msg.index);
    finished = r.finished;
    return finished ? undefined : r.guide;
  });
  if (finished) await endGuide("finished");
  else if (sender.tab) scheduleGuide(sender.tab.id);
  return { finished };
}

async function refreshIfGuiding(tabId) {
  if (tabId !== undefined && S.isGuide(await getGuide())) scheduleGuide(tabId);
}
// Switching tabs, and top-level page loads (also non-Sejong pages, so the panel can say so).
chrome.tabs.onActivated.addListener(({ tabId }) => refreshIfGuiding(tabId));
chrome.webNavigation.onCompleted.addListener(({ tabId, frameId }) => { if (frameId === 0) refreshIfGuiding(tabId); });
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(viewKey(tabId)));

// ------------------------------------------------------------------ 4. keep-English labels

// The menu map bundled with the extension (scripts/sync_extension_data.py copies
// data/menu_map.json here), plus recorded items whose English name you filled in.
let bundledItems = null;
async function labelPairs() {
  if (!bundledItems) {
    const res = await fetch(chrome.runtime.getURL("data/menu_map.json"));
    bundledItems = (await res.json()).items || [];
  }
  const { recStore } = await chrome.storage.local.get("recStore");
  const pairs = new Map();
  for (const item of bundledItems.concat(recStore ? Object.values(recStore.items) : [])) {
    const ko = S.cleanLabel(item.name_ko);
    const en = S.cleanLabel(item.name_en);
    if (ko && en && ko !== en && !pairs.has(ko)) pairs.set(ko, en);
  }
  return [...pairs];
}

// ------------------------------------------------------------------ 5. pop-up translation fallback

// Only a LibreTranslate that YOU run (TRANSLATE_URL in config.js). Never a public service:
// pop-ups can contain personal data.
async function translateLibre(text) {
  const base = self.SEJONG_CONFIG.TRANSLATE_URL;
  if (!base) return null;
  const res = await fetch(`${base}/translate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: text, source: "ko", target: "en", format: "text" }),
  });
  if (!res.ok) throw new Error(`LibreTranslate: HTTP ${res.status}`);
  return (await res.json()).translatedText || null;
}

// ------------------------------------------------------------------ messages

const HANDLERS = {
  "api:health": () => apiGet("/health", {}),
  "api:search": (m) => apiGet("/search", { q: m.query, k: m.k || self.SEJONG_CONFIG.SEARCH_K }),
  "api:suggest": (m) => apiGet("/suggest", { prefix: m.prefix }),
  "api:route": (m) => apiGet("/route", { from: m.from, to: m.to }), // → full items, in click order

  "rec:state": async () => recorderState(await withStore((s) => s), await isRecording()),
  "rec:setRecording": async (m) => {
    await chrome.storage.local.set({ recording: !!m.on });
    showBadge(!!m.on);
    return true;
  },
  "rec:click": async (m, sender) => {
    if (!sender.tab || !(await isRecording())) return null;
    return withStore((store) => S.applyClick(store, m.site, m.steps));
  },
  "rec:scan": (m) => scanTab(m.tabId),
  "rec:newPath": () => withStore((store) => { store.chain = []; return true; }),
  "rec:undo": () => withStore((store) => S.undo(store)),
  "rec:delete": (m) => withStore((store) => S.deleteItem(store, m.id)),
  "rec:clear": () => withStore((store) => { Object.assign(store, S.newStore()); return true; }),
  "rec:export": () => withStore((store) => S.toMenuMap(store)),
  "rec:import": (m) => withStore((store) => S.mergeMenuMap(store, m.json).length),

  "guide:start": (m) => startGuide(m.tabId, m.path, m.targetId),
  "guide:stop": () => endGuide("stopped"),
  "guide:clicked": (m, sender) => guideClicked(m, sender),
  // From a content script (page or frame loaded, click) or from the panel ({tabId}).
  "guide:refresh": async (m, sender) => {
    await refreshIfGuiding(sender.tab ? sender.tab.id : m.tabId);
    return true;
  },

  "labels:get": () => labelPairs(),
  // Any frame found a pop-up: the TOP frame translates it and shows the overlay.
  "popup:found": async (m, sender) => {
    if (sender.tab) await sendToFrame(sender.tab.id, 0, { type: "popup:show", text: m.text, kind: m.kind });
    return true;
  },
  "translate:libre": (m) => translateLibre(m.text),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = HANDLERS[msg && msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((data) => sendResponse({ ok: true, data }),
          (err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // keep the channel open for the async answer
});
