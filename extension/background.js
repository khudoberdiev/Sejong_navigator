// AI-generated — to be rewritten by me
// Service worker. Three jobs:
//   1. The only code that talks to the backend (BACKEND_URL in config.js).
//   2. Keeps the menu recorder's data in chrome.storage.local and merges what content scripts send.
//   3. Runs the on-page guide: asks every frame of the tab which path step it can see,
//      then tells the frame with the deepest visible step to highlight it.
importScripts("config.js", "shared.js");

const { BACKEND_URL } = self.SEJONG_CONFIG;
const S = self.SejongShared;

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

const guideKey = (tabId) => `guide:${tabId}`;

async function getGuide(tabId) {
  const key = guideKey(tabId);
  return (await chrome.storage.session.get(key))[key] || null;
}

async function runGuide(tabId) {
  const path = await getGuide(tabId);
  if (!path) return { active: false };
  const frames = await framesOf(tabId);
  const probes = await Promise.all(frames.map(async (f) => {
    const answer = await sendToFrame(tabId, f.frameId, { type: "guide:probe", path });
    return answer ? { frameId: f.frameId, index: answer.index } : null;
  }));
  let best = null;
  for (const p of probes) {
    if (p && p.index >= 0 && (!best || p.index > best.index)) best = p;
  }
  await Promise.all(frames.map((f) => sendToFrame(tabId, f.frameId, best && f.frameId === best.frameId
    ? { type: "guide:show", path, index: best.index }
    : { type: "guide:clear", guiding: true })));
  return { active: true, index: best ? best.index : -1, total: path.length };
}

// Page loads and clicks in several frames ask for a refresh at almost the same time: debounce.
const refreshTimers = {};
function scheduleGuide(tabId) {
  clearTimeout(refreshTimers[tabId]);
  refreshTimers[tabId] = setTimeout(() => runGuide(tabId).catch(() => {}), 400);
}

async function stopGuide(tabId) {
  await chrome.storage.session.remove(guideKey(tabId));
  const frames = await framesOf(tabId).catch(() => []);
  await Promise.all(frames.map((f) => sendToFrame(tabId, f.frameId, { type: "guide:clear", guiding: false })));
}

// A menu link that opens a new tab (portal → SJPT) keeps guiding in that tab.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (tab.openerTabId === undefined) return;
  const path = await getGuide(tab.openerTabId);
  if (path) await chrome.storage.session.set({ [guideKey(tab.id)]: path });
});
chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove(guideKey(tabId)));

// ------------------------------------------------------------------ messages

const HANDLERS = {
  "api:health": () => apiGet("/health", {}),
  "api:search": (m) => apiGet("/search", { q: m.query, k: m.k || self.SEJONG_CONFIG.SEARCH_K }),
  "api:suggest": (m) => apiGet("/suggest", { prefix: m.prefix }),
  "api:route": (m) => apiGet("/route", { from: m.from, to: m.to }),
  "api:items": (m) => apiGet("/items", { ids: m.ids.join(",") }),

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

  "guide:start": async (m) => {
    await chrome.storage.session.set({ [guideKey(m.tabId)]: m.path });
    return runGuide(m.tabId);
  },
  "guide:stop": (m) => stopGuide(m.tabId),
  "guide:refresh": async (_m, sender) => {
    if (sender.tab && (await getGuide(sender.tab.id))) scheduleGuide(sender.tab.id);
    return true;
  },
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
