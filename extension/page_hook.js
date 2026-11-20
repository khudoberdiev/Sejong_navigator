// AI-generated — to be rewritten by me
// Runs in the PAGE's own JavaScript world (manifest: "world": "MAIN"), before the site's scripts.
// Korean university sites show many messages with window.alert()/confirm(), which the
// content script cannot see. This wrapper only reports the message text to content.js
// (as a DOM event) and then calls the original function unchanged.
// The text is translated on this computer (see content.js); it is not sent anywhere.
(() => {
  if (window.__sejongNavHook) return;
  window.__sejongNavHook = true;
  const report = (kind, message) => {
    try {
      // A string detail crosses from the page world to the content-script world safely.
      document.dispatchEvent(new CustomEvent("sejong-nav-dialog", { detail: JSON.stringify({ kind, message: String(message) }) }));
    } catch (e) { /* never break the site's dialog */ }
  };
  for (const name of ["alert", "confirm", "prompt"]) {
    const original = window[name];
    if (typeof original !== "function") continue;
    window[name] = function (message, ...rest) {
      report(name, message);
      return original.call(this, message, ...rest);
    };
  }
})();
