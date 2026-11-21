// AI-generated — to be rewritten by me
// UI text for every part of the extension: side panel, floating widget, pop-up overlay, errors.
// The text lives ONLY in _locales/<code>/messages.json (Chrome's format). English (_locales/en)
// is complete and is the manifest's default_locale. Settings → "UI language":
//   auto    chrome.i18n.getMessage: Chrome's choice (the browser language if we ship it), else English
//   <code>  that locale's messages.json; a key it lacks falls back to Chrome's choice (English)
// Adding a language = adding _locales/<code>/messages.json with a "language_name" entry. It
// appears in the Settings list by itself: CANDIDATE_LOCALES are probed once.
// Note: chrome.i18n only auto-picks locales Chrome itself supports (not "uz", for example);
// a forced choice in Settings works for any code below.
//
// Usage: SejongI18n.t(<message key>, [subs]) everywhere. Keys are always string literals at the call
// site, so tests/test_extension_js.py can check that every key exists.
(function (root) {
  "use strict";

  const S = root.SejongShared;
  const CANDIDATE_LOCALES = [
    "am", "ar", "bg", "bn", "ca", "cs", "da", "de", "el", "en", "en_GB", "en_US", "es", "es_419",
    "et", "fa", "fi", "fil", "fr", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "kk", "kn", "ko",
    "ky", "lt", "lv", "ml", "mn", "mr", "ms", "nl", "no", "pl", "pt_BR", "pt_PT", "ro", "ru", "sk",
    "sl", "sr", "sv", "sw", "ta", "te", "tg", "th", "tk", "tr", "uk", "uz", "vi", "zh_CN", "zh_TW",
  ];

  const chromeT = (key, subs) => {
    let text = "";
    try { text = chrome.i18n.getMessage(key, subs === undefined ? undefined : [].concat(subs).map(String)); } catch (e) { /* no i18n here */ }
    return text || key; // a missing key shows itself instead of an empty label
  };

  let translate = chromeT;
  let language = "auto";
  const listeners = [];

  // Extension pages and the service worker read their own files; content scripts cannot
  // (the files are not web-accessible), so they ask background.js.
  const isExtensionPage = typeof location !== "undefined" && location.protocol === "chrome-extension:";
  async function loadMessages(code) {
    if (CANDIDATE_LOCALES.indexOf(code) < 0) return null;
    if (!isExtensionPage) {
      const answer = await chrome.runtime.sendMessage({ type: "i18n:messages", code }).catch(() => null);
      return answer && answer.ok ? answer.data : null;
    }
    try {
      const res = await fetch(chrome.runtime.getURL(`_locales/${code}/messages.json`));
      return res.ok ? await res.json() : null;
    } catch (e) {
      return null;
    }
  }

  // [{code, name}] of the locales we ship, name from their own "language_name".
  let languagesCache = null;
  async function listLanguages() {
    if (!isExtensionPage) {
      const answer = await chrome.runtime.sendMessage({ type: "i18n:languages" }).catch(() => null);
      return answer && answer.ok ? answer.data : [];
    }
    if (!languagesCache) {
      const found = await Promise.all(CANDIDATE_LOCALES.map(async (code) => {
        const messages = await loadMessages(code);
        return messages ? { code, name: S.formatMessage(messages.language_name) || code } : null;
      }));
      languagesCache = found.filter(Boolean);
    }
    return languagesCache;
  }

  async function use(code) {
    language = code || "auto";
    const messages = language === "auto" ? null : await loadMessages(language);
    translate = messages ? S.makeTranslator(messages, chromeT) : chromeT;
  }

  async function init() {
    const { uiLanguage = "auto" } = await chrome.storage.local.get("uiLanguage").catch(() => ({}));
    await use(uiLanguage);
  }

  // Fill an HTML page's static text: data-i18n (text), data-i18n-placeholder, data-i18n-title,
  // data-i18n-aria-label.
  function apply(node) {
    for (const el of node.querySelectorAll("[data-i18n]")) el.textContent = translate(el.dataset.i18n);
    for (const el of node.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = translate(el.dataset.i18nPlaceholder);
    for (const el of node.querySelectorAll("[data-i18n-title]")) el.title = translate(el.dataset.i18nTitle);
    for (const el of node.querySelectorAll("[data-i18n-aria-label]")) el.setAttribute("aria-label", translate(el.dataset.i18nAriaLabel));
  }

  // Run cb after the UI language changed (in any tab or the panel) and the new text is loaded.
  function onChange(cb) { listeners.push(cb); }
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(async (changes, area) => {
      if (area !== "local" || !changes.uiLanguage) return;
      await use(changes.uiLanguage.newValue);
      for (const cb of listeners) { try { cb(); } catch (e) { /* one bad listener must not stop the rest */ } }
    });
  }

  root.SejongI18n = Object.freeze({
    t: (key, subs) => translate(key, subs),
    init, apply, onChange, listLanguages, loadMessages,
    language: () => language,
    CANDIDATE_LOCALES,
  });
})(globalThis);
