// AI-generated — to be rewritten by me
// A tiny fake `chrome` for tests/js/context.test.js (see there).
var FAKE = (function () {
  let gone = false;
  const store = {};
  const storage = [];
  const invalid = () => { throw new Error("Extension context invalidated."); };
  const runtime = {
    get id() { return gone ? undefined : "fake"; },
    sendMessage(msg) { if (gone) invalid(); return Promise.resolve({ ok: true, data: "pong" }); },
    getURL(path) { if (gone) invalid(); return "chrome-extension://fake/" + path; },
    onMessage: { addListener() { if (gone) invalid(); }, removeListener() { if (gone) invalid(); } },
  };
  const local = {
    get(keys) { if (gone) invalid(); const out = {}; for (const k of [].concat(keys)) if (k in store) out[k] = store[k]; return Promise.resolve(out); },
    set(values) { if (gone) invalid(); Object.assign(store, values); return Promise.resolve(); },
  };
  const onChanged = {
    addListener(fn) { if (gone) invalid(); storage.push(fn); },
    // Chrome may throw here too once the context is gone; context.js removes listeners in onDead
    // (before anything else can run) and ignores a throw.
    removeListener(fn) { const i = storage.indexOf(fn); if (i >= 0) storage.splice(i, 1); },
  };
  globalThis.chrome = { runtime, storage: { local, onChanged } };
  return {
    reload() { gone = true; },
    fireStorage(changes, area) { for (const fn of storage.slice()) fn(changes, area); },
    storageListeners: () => storage.length,
  };
})();
