// AI-generated — to be rewritten by me
// Unit tests for extension/context.js with a fake `chrome` (JavaScriptCore, no browser).
// tests/test_extension_js.py runs: fake chrome + context.js + this file. Output: "RESULT {...}".
// The fake: chrome.runtime.id disappears when the "extension is reloaded" (reload()), and then
// every call throws "Extension context invalidated", like Chrome does.

let passed = 0;
const failures = [];
// Tests run one after another (each may be async): the reload in the last one must not
// happen while an earlier one still waits.
let queue = Promise.resolve();
function test(name, fn) {
  queue = queue.then(() => fn()).then(() => { passed++; }, (e) => { failures.push(`${name}: ${e.message}`); });
}
function eq(actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`expected ${b}, got ${a}`);
}
function ok(value, message) { if (!value) throw new Error(message || "expected a truthy value"); }

const C = globalThis.SejongContext;

test("alive while the extension is there; calls go through", async () => {
  ok(C.alive());
  eq(await C.send({ type: "ping" }), { ok: true, data: "pong" });
  await C.storageSet({ widgetMode: "full" });
  eq(await C.storageGet(["widgetMode"]), { widgetMode: "full" });
  eq(C.getURL("arrow.css"), "chrome-extension://fake/arrow.css");
});

test("a listener gets events while alive", () => {
  const seen = [];
  C.onStorageChanged((changes, area) => seen.push(area));
  FAKE.fireStorage({ x: 1 }, "local");
  eq(seen, ["local"]);
  eq(FAKE.storageListeners(), 1);
});

const deadCalls = [];
const unsubscribed = [];
test("onDead handlers can be registered and removed", () => {
  C.onDead(() => deadCalls.push("content.js shutdown"));
  const off = C.onDead(() => unsubscribed.push("should never run"));
  off();
});

test("after the extension is reloaded: nothing throws, everything is quiet", async () => {
  FAKE.reload();                                         // chrome.runtime.id gone, calls throw
  eq(await C.send({ type: "ping" }), null);              // sendMessage would throw synchronously
  eq(deadCalls, ["content.js shutdown"]);                // onDead ran (remove widget, frame, arrow)
  eq(unsubscribed, []);
  ok(!C.alive());
  await C.storageSet({ widgetMode: "mini" });            // widget.js:124 threw here before
  eq(await C.storageGet(["widgetMode"]), {});
  eq(C.getURL("arrow.css"), null);
  eq(FAKE.storageListeners(), 0);                        // listeners detached
  eq(typeof C.onStorageChanged(() => {}), "function");   // adding one now: a no-op, no throw
  FAKE.fireStorage({ x: 2 }, "local");                   // nobody hears it
  C.alive(); C.alive();
  eq(deadCalls.length, 1);                               // onDead runs once
  let late = 0;
  C.onDead(() => late++);                                // registered after death: runs at once
  eq(late, 1);
});

queue.then(() => print("RESULT " + JSON.stringify({ passed, failures })));
