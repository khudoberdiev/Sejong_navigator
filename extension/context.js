// AI-generated — to be rewritten by me
// Is the extension still there? When it is reloaded or updated, the content scripts already
// running in open Sejong tabs are orphaned: chrome.runtime.id is gone and every chrome.* call
// throws "Extension context invalidated" (an uncaught error in the page's console; widget.js
// hit it when saving its view). Every chrome.* call of the content scripts and the shared UI
// (content.js, widget.js, ui.js, i18n.js) goes through this file instead:
//   * alive()             false once the extension is gone; the first time, every onDead
//                         handler runs once (content.js removes the widget, frame and arrow and
//                         detaches its listeners), then everything stays quiet
//   * send(msg)           chrome.runtime.sendMessage that never throws: the answer, or null
//   * storageGet / storageSet / onStorageChanged / onMessage / getURL: the same, guarded
// A heartbeat (WATCH_MS) notices the loss even when nothing calls in, so an orphaned widget
// goes away by itself. Loaded before i18n.js, ui.js, widget.js and content.js (manifest, popup,
// background.js) and in the service worker, where it is simply always alive.
(function (root) {
  "use strict";

  const WATCH_MS = 2000;
  const handlers = [];
  let dead = false;
  let watch = null;

  function die() {
    if (dead) return;
    dead = true;
    if (watch !== null) clearInterval(watch);
    watch = null;
    for (const fn of handlers.splice(0)) {
      try { fn(); } catch (e) { /* the others must still run */ }
    }
  }

  function alive() {
    if (dead) return false;
    let ok = false;
    try { ok = typeof chrome !== "undefined" && !!(chrome.runtime && chrome.runtime.id); } catch (e) { ok = false; }
    if (!ok) die();
    return ok;
  }

  // fn runs once when the extension goes away. → unsubscribe()
  function onDead(fn) {
    if (dead) { try { fn(); } catch (e) { /* ignore */ } return () => {}; }
    handlers.push(fn);
    if (watch === null && typeof setInterval === "function") watch = setInterval(alive, WATCH_MS);
    return () => { const i = handlers.indexOf(fn); if (i >= 0) handlers.splice(i, 1); };
  }

  // A chrome.* call that may throw synchronously (context gone) or reject. → a promise that
  // resolves to the result, or to `fallback`.
  function guarded(call, fallback) {
    if (!alive()) return Promise.resolve(fallback);
    try {
      return Promise.resolve(call()).catch(() => { alive(); return fallback; });
    } catch (e) {
      alive();
      return Promise.resolve(fallback);
    }
  }

  const send = (message) => guarded(() => chrome.runtime.sendMessage(message), null);
  const storageGet = (keys) => guarded(() => chrome.storage.local.get(keys), {}).then((r) => r || {});
  const storageSet = (values) => guarded(() => chrome.storage.local.set(values), undefined);

  // Add a chrome event listener that is removed again when the extension goes away, and is not
  // called once it is gone. → unsubscribe()
  function listen(getEvent, fn) {
    if (!alive()) return () => {};
    const wrapped = function () { if (alive()) return fn.apply(this, arguments); return false; };
    let event = null;
    try { event = getEvent(); event.addListener(wrapped); } catch (e) { return () => {}; }
    const remove = () => { try { event.removeListener(wrapped); } catch (e) { /* already gone */ } };
    const unsubscribe = onDead(remove);
    return () => { unsubscribe(); remove(); };
  }
  const onStorageChanged = (fn) => listen(() => chrome.storage.onChanged, fn);
  const onMessage = (fn) => listen(() => chrome.runtime.onMessage, fn);

  function getURL(path) {
    if (!alive()) return null;
    try { return chrome.runtime.getURL(path); } catch (e) { alive(); return null; }
  }

  root.SejongContext = Object.freeze({ alive, onDead, send, storageGet, storageSet, onStorageChanged, onMessage, getURL, WATCH_MS });
})(globalThis);
