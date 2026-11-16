// AI-generated — to be rewritten by me
// Runs on *.sejong.ac.kr pages and highlights the menu element to click next.
// Message: {type: "highlight", selector: "<css selector>"}
// TODO: handle menus inside iframes (SJPT often uses frames) and menus that load late.

const HIGHLIGHT_CLASS = "sejong-nav-highlight";

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "highlight") return false;
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((el) => el.classList.remove(HIGHLIGHT_CLASS));
  const el = msg.selector ? document.querySelector(msg.selector) : null;
  if (el) {
    el.classList.add(HIGHLIGHT_CLASS);
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  sendResponse({ found: Boolean(el) });
  return false;
});
