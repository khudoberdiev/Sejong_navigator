// AI-generated — to be rewritten by me
// Unit tests for extension/shared.js. tests/test_extension_js.py glues shared.js + this file
// together and runs them with macOS JavaScriptCore (no browser, no Node).
// Output: one "RESULT {...}" line and one "EXPORT {...}" line (a recorded menu map).

const S = globalThis.SejongShared;
let passed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); passed++; } catch (e) { failures.push(`${name}: ${e.message}`); }
}
function eq(actual, expected) {
  const a = JSON.stringify(actual), b = JSON.stringify(expected);
  if (a !== b) throw new Error(`expected ${b}, got ${a}`);
}
function ok(value, message) {
  if (!value) throw new Error(message || "expected a truthy value");
}

// ------------------------------------------------------------------ sites, labels, urls

test("siteForHost", () => {
  eq(S.siteForHost("sjpt.sejong.ac.kr"), "sjpt");
  eq(S.siteForHost("LIBRARY.sejong.ac.kr"), "library");
  eq(S.siteForHost("example.com"), null);
  eq(S.siteForHost(""), null);
});

test("cleanLabel collapses whitespace", () => {
  eq(S.cleanLabel("  성적 \n  및\t강의평가 "), "성적 및 강의평가");
  eq(S.cleanLabel(null), "");
});

test("isSafeLabel accepts menu labels", () => {
  for (const label of ["성적 및 강의평가", "Current Loans", "수업/성적", "e-Campus", "2024 학사일정", "My Library"]) {
    ok(S.isSafeLabel(label), label);
  }
});

test("isSafeLabel refuses personal data", () => {
  for (const label of ["21011234", "학번 21011234", "홍길동님 환영합니다", "홍길동님", "hong@sejong.ac.kr",
                       "4.5", "3.87 / 4.5", "A+", "B0", "010-1234-5678", "", "x".repeat(41)]) {
    ok(!S.isSafeLabel(label), label);
  }
});

test("sanitizeUrl drops personal query parameters, hash and jsessionid", () => {
  eq(S.sanitizeUrl("https://SJPT.sejong.ac.kr/main.do?menuId=100234&stdNo=21011234#top"),
     "https://sjpt.sejong.ac.kr/main.do?menuId=100234");
  eq(S.sanitizeUrl("https://x.sejong.ac.kr/a;jsessionid=ABC123?x=1"), "https://x.sejong.ac.kr/a?x=1");
  eq(S.sanitizeUrl("https://x.sejong.ac.kr/a?id=21011234&tab=2"), "https://x.sejong.ac.kr/a?tab=2");
  eq(S.sanitizeUrl("https://x.sejong.ac.kr/a?q=hong%40mail.com"), "https://x.sejong.ac.kr/a");
  eq(S.sanitizeUrl("https://x.sejong.ac.kr/a?userName=Hong"), "https://x.sejong.ac.kr/a");
});

test("sanitizeUrl refuses non-http links", () => {
  eq(S.sanitizeUrl("javascript:fnMenu('A01')"), null);
  eq(S.sanitizeUrl("mailto:a@b.c"), null);
  eq(S.sanitizeUrl("/relative/path"), null);
  eq(S.sanitizeUrl(""), null);
  eq(S.sanitizeUrl(null), null);
});

test("stableId is deterministic and depends on site and label path", () => {
  const a = S.stableId("sjpt", ["수업/성적", "성적 및 강의평가"]);
  eq(a, S.stableId("sjpt", ["수업/성적", "성적 및 강의평가"]));
  ok(/^sjpt\.m[0-9a-z]+$/.test(a), a);
  ok(a !== S.stableId("sjpt", ["성적 및 강의평가"]));
  ok(a !== S.stableId("portal", ["수업/성적", "성적 및 강의평가"]));
});

// ------------------------------------------------------------------ click recording

const store = S.newStore();
const step = (label, extra) => Object.assign({ label, selector: `#${label.length}` }, extra || {});
let portalSjpt, classGrade, gradeEval, gradeCurrent;

test("first click creates the portal root and hangs under it", () => {
  const r = S.applyClick(store, "portal", [step("학사정보시스템", { url: "https://portal.sejong.ac.kr/go?stdNo=21011234" })]);
  portalSjpt = r.clickedId;
  ok(r.created.indexOf("portal.root") >= 0);
  eq(store.items[portalSjpt].parent_id, "portal.root");
  eq(store.items[portalSjpt].url, "https://portal.sejong.ac.kr/go");
  eq(store.items[portalSjpt].name_ko, "학사정보시스템");
  eq(store.items[portalSjpt].name_en, "");
});

test("a click on another site becomes a child of the previous click", () => {
  const r = S.applyClick(store, "sjpt", [step("수업/성적")]);
  classGrade = r.clickedId;
  eq(store.items[classGrade].parent_id, portalSjpt);
  eq(store.items["sjpt.root"].parent_id, "portal.root");
});

test("nested DOM path: ancestor already in the chain keeps its parent", () => {
  const r = S.applyClick(store, "sjpt", [step("수업/성적"), step("성적 및 강의평가")]);
  gradeEval = r.clickedId;
  eq(store.items[classGrade].parent_id, portalSjpt);
  eq(store.items[gradeEval].parent_id, classGrade);
});

test("a top-level entry in another frame hangs under the last click", () => {
  gradeCurrent = S.applyClick(store, "sjpt", [step("Current Semester Grade Inquiry")]).clickedId;
  eq(store.items[gradeCurrent].parent_id, gradeEval);
  eq(store.items[gradeCurrent].name_en, "Current Semester Grade Inquiry");
  eq(store.chain, [portalSjpt, classGrade, gradeEval, gradeCurrent]);
});

test("unsafe clicks are ignored completely", () => {
  const before = JSON.stringify(store.items);
  const r = S.applyClick(store, "sjpt", [step("홍길동님")]);
  eq(r.created, []);
  eq(JSON.stringify(store.items), before);
  eq(store.chain.length, 4);
  eq(S.applyClick(store, "evil", [step("Menu")]).created, []);
  eq(S.applyClick(store, "sjpt", []).created, []);
});

test("clicking the same entry twice does not grow the chain", () => {
  S.applyClick(store, "sjpt", [step("Current Semester Grade Inquiry")]);
  eq(store.chain.length, 4);
});

test("undo removes what the last click added", () => {
  const id = S.applyClick(store, "sjpt", [step("강의평가")]).clickedId;
  ok(store.items[id]);
  S.undo(store); // undoes 강의평가
  ok(!store.items[id]);
  eq(store.chain[store.chain.length - 1], gradeCurrent);
});

test("new path starts again from the site root", () => {
  store.chain = [];
  const id = S.applyClick(store, "library", [step("대출현황")]).clickedId;
  eq(store.items[id].parent_id, "library.root");
  eq(store.items["library.root"].parent_id, "portal.root");
});

// ------------------------------------------------------------------ scanning and merging

test("scan adds items under the site root, but does not move known ones", () => {
  const created = S.applyScan(store, "sjpt", [
    [step("수업/성적")],
    [step("수업/성적"), step("성적 및 강의평가")],
    [step("학적")],
    [step("홍길동님")], // refused
  ]);
  const record = S.stableId("sjpt", ["학적"]);
  eq(created, [record]);
  eq(store.items[record].parent_id, "sjpt.root");
  eq(store.items[classGrade].parent_id, portalSjpt);
});

test("a later click upgrades a scanned root-parent and fills missing fields", () => {
  const s = S.newStore();
  S.applyScan(s, "sjpt", [[{ label: "성적조회", selector: null }]]);
  const id = S.stableId("sjpt", ["성적조회"]);
  eq(s.items[id].parent_id, "sjpt.root");
  const top = S.applyClick(s, "sjpt", [{ label: "수업", selector: "#top" }]).clickedId;
  S.applyClick(s, "sjpt", [{ label: "성적조회", selector: "#grades", url: "https://sjpt.sejong.ac.kr/g.do" }]);
  eq(s.items[id].parent_id, top);
  eq(s.items[id].selector, "#grades");
  eq(s.items[id].url, "https://sjpt.sejong.ac.kr/g.do");
});

test("parent upgrade never creates a cycle", () => {
  const s = S.newStore();
  // ("A"/"B" would be refused as letter grades, so use words)
  const a = S.applyClick(s, "sjpt", [{ label: "Alpha", selector: "#a" }]).clickedId; // parent: root
  const b = S.applyClick(s, "sjpt", [{ label: "Beta", selector: "#b" }]).clickedId;  // parent: a
  eq(s.items[b].parent_id, a);
  s.chain = [b];
  S.applyClick(s, "sjpt", [{ label: "Alpha", selector: "#a" }]); // would make a's parent b, while b's parent is a
  eq(s.items[a].parent_id, "sjpt.root");
});

test("deleteItem removes the whole subtree", () => {
  const s = JSON.parse(JSON.stringify(store));
  const removed = S.deleteItem(s, classGrade);
  eq(removed, 3); // class/grade, grade & evaluation, current grades
  ok(!s.items[gradeCurrent]);
  ok(s.items[portalSjpt]);
});

test("listForReview hides roots and shows label paths", () => {
  const rows = S.listForReview(store);
  ok(rows.every((r) => !S.isRootId(r.id)));
  ok(rows.some((r) => r.path === "수업/성적 › 성적 및 강의평가"));
});

// ------------------------------------------------------------------ export / import

const exported = S.toMenuMap(store);

test("export has the menu_map fields, empty keywords and valid parents", () => {
  const ids = new Set(exported.items.map((i) => i.id));
  for (const item of exported.items) {
    for (const f of ["id", "site", "name_ko", "name_en", "parent_id", "url", "selector", "description", "keywords"]) {
      ok(f in item, `${item.id} lacks ${f}`);
    }
    eq(item.keywords, []);
    ok(item.parent_id === null || ids.has(item.parent_id), `${item.id} has dangling parent`);
  }
  eq(exported.items[0].id, "portal.root");
  eq(exported.items.filter((i) => i.parent_id === null).length, 1);
});

test("export repairs a dangling parent", () => {
  const s = S.newStore();
  S.applyClick(s, "sjpt", [{ label: "X", selector: "#x" }]);
  const id = S.stableId("sjpt", ["X"]);
  s.items[id].parent_id = "sjpt.gone";
  eq(S.toMenuMap(s).items.find((i) => i.id === id).parent_id, "sjpt.root");
});

test("import of an export reproduces the same items", () => {
  const s = S.newStore();
  S.mergeMenuMap(s, JSON.parse(JSON.stringify(exported)));
  eq(S.toMenuMap(s).items, exported.items);
});

test("import ignores junk and merges into existing data", () => {
  const s = S.newStore();
  const created = S.mergeMenuMap(s, { items: [null, { id: 1 }, { id: "x", site: "evil" }] });
  eq(created, []);
  eq(S.mergeMenuMap(s, exported.items).length, exported.items.length); // a bare array works too
});

// ------------------------------------------------------------------ guide state

const ROUTE = [
  { id: "portal.root", name_ko: "세종대학교 포털" },
  { id: "portal.sjpt", name_ko: "학사정보시스템" },
  { id: "sjpt.grades", name_ko: "수업/성적" },
  { id: "sjpt.grade_current", name_ko: "금학기 성적조회" },
];

test("newGuide starts at step 1 and targets the last item", () => {
  const g = S.newGuide(ROUTE, null, 123);
  eq([g.step, g.targetId, g.startedAt, g.route.length], [1, "sjpt.grade_current", 123, 4]);
  ok(S.isGuide(g));
  eq(S.newGuide(ROUTE, "explicit", 1).targetId, "explicit");
});

test("isGuide rejects junk and routes with nothing to click", () => {
  ok(!S.isGuide(null));
  ok(!S.isGuide({ route: "x", step: 1 }));
  ok(!S.isGuide(S.newGuide([ROUTE[0]], null, 1)));
  ok(!S.isGuide(S.newGuide(undefined, null, 1)));
});

test("pickStep highlights the deepest visible step and only moves forward", () => {
  const g = Object.assign(S.newGuide(ROUTE, null, 1), { step: 2 });
  eq(S.pickStep(g, []), { show: -1, step: 2 });
  eq(S.pickStep(g, [2]), { show: 2, step: 2 });
  eq(S.pickStep(g, [1, 3, 2]), { show: 3, step: 3 });   // user went ahead
  eq(S.pickStep(g, [1]), { show: 1, step: 2 });         // only a parent visible: hint, keep step
  eq(S.pickStep(g, [0, 9, -1, "2", null]), { show: -1, step: 2 }); // root and junk ignored
});

test("advanceGuide moves to the next step, finishes on the last", () => {
  const g = S.newGuide(ROUTE, null, 1);
  const a = S.advanceGuide(g, 1);
  eq([a.guide.step, a.finished], [2, false]);
  eq(g.step, 1); // input not mutated
  eq(S.advanceGuide(a.guide, 1).guide.step, 2);  // clicking a parent again never goes back
  eq(S.advanceGuide(a.guide, 3).finished, true);
  eq(S.advanceGuide(a.guide, 7), { guide: a.guide, finished: false });
  eq(S.advanceGuide(a.guide, 0).finished, false);
});

test("guideStatus per tab", () => {
  const g = Object.assign(S.newGuide(ROUTE, null, 5), { step: 2 });
  const view = (shown, extra) => Object.assign({ startedAt: 5, shown, sejong: true }, extra);
  eq(S.guideStatus(g, null), { kind: "pending", index: 2 });
  eq(S.guideStatus(g, view(2, { startedAt: 4 })), { kind: "pending", index: 2 }); // stale view of an old guide
  eq(S.guideStatus(g, view(-1, { sejong: false })), { kind: "other-tab", index: 2 });
  eq(S.guideStatus(g, view(-1)), { kind: "missing", index: 2 });
  eq(S.guideStatus(g, view(1)), { kind: "hint", index: 1 });
  eq(S.guideStatus(g, view(2)), { kind: "next", index: 2 });
  eq(S.guideStatus(g, view(3)), { kind: "here", index: 3 });
});

test("a whole portal → SJPT walk survives a JSON round trip (storage)", () => {
  let g = S.newGuide(ROUTE, null, 9);
  const store = (x) => JSON.parse(JSON.stringify(x)); // what chrome.storage does to values
  g = store(S.advanceGuide(g, S.pickStep(g, [1]).show).guide);   // portal: click 학사정보시스템
  // new SJPT tab loads: reads the same guide
  const p = S.pickStep(g, [2]);
  eq(p, { show: 2, step: 2 });
  g = store(S.advanceGuide(g, p.show).guide);
  eq(g.step, 3);
  eq(S.advanceGuide(g, S.pickStep(g, [3]).show).finished, true);
});

// ------------------------------------------------------------------ finding items on the page

test("decodeEntities handles numeric, hex and named entities", () => {
  eq(S.decodeEntities("Academic Affairs Q&#38;A"), "Academic Affairs Q&A");
  eq(S.decodeEntities("A&#x26;B &amp; C &lt;D&gt; &quot;e&quot; &apos;f&apos;"), "A&B & C <D> \"e\" 'f'");
  eq(S.decodeEntities("a&nbsp;b"), "a b");
  eq(S.decodeEntities("&unknown; &#0; Q&A"), "&unknown; &#0; Q&A"); // left alone
  eq(S.decodeEntities(null), "");
});

test("labelKey decodes, trims, collapses spaces and ignores case", () => {
  eq(S.labelKey("  Academic Affairs\n Q&#38;A "), "academic affairs q&a");
  eq(S.labelKey("Current Semester Grade INQUIRY"), "current semester grade inquiry");
  eq(S.labelKey("a&nbsp;&nbsp;b"), "a b");
});

test("siteNames: Korean and English-mode labels, no duplicates, no blanks", () => {
  eq(S.siteNames({ name_ko: "당학기성적조회", name_en: "Current Semester Grades", name_en_site: "Current Semester Grade inquiry" }),
     ["당학기성적조회", "current semester grade inquiry"]);  // name_en (our translation) is not on the site
  eq(S.siteNames({ name_ko: "Facebook", name_en_site: "Facebook" }), ["facebook"]);
  eq(S.siteNames({ name_ko: "수업", name_en_site: null }), ["수업"]);
});

test("selectorsFor: desktop, then mobile, then the old single selector", () => {
  eq(S.selectorsFor({ selector_desktop: "#gnb a", selector_mobile: ".m_gnb a" }), ["#gnb a", ".m_gnb a"]);
  eq(S.selectorsFor({ selector_desktop: null, selector_mobile: "a.btn_gnb" }), ["a.btn_gnb"]);
  eq(S.selectorsFor({ selector: "#old" }), ["#old"]);
  eq(S.selectorsFor({ selector_desktop: null, selector_mobile: "  " }), []); // → text matching
});

// The two portal SSO links share one selector, #gnb a[href*="doSsoLogin.do"]; only their labels differ.
const PORTAL_SJPT = { id: "portal.sjpt", name_ko: "학사정보시스템 (SJPT)", name_en_site: "Academic Information System (SJPT)" };
const GENERAL_ADMIN = { id: "portal.general_admin", name_ko: "일반행정정보시스템", name_en_site: "General Administrative Information System" };
const SSO_LINKS = {
  kor: [{ text: "일반행정정보시스템", title: "", visible: true },
        { text: "학사정보시스템", title: "학사정보시스템", visible: true }],
  engEnglishTitle: [{ text: "General Administrative Information System", title: "", visible: true },
                    { text: "Academic Information System", title: "Academic Information System", visible: true }],
  engNoTitle: [{ text: "General Administrative Information System", title: "", visible: true },
               { text: " Academic Information\n System ", title: "", visible: true }],
};

test("labelMatches: text or title, KOR or ENG, shortened labels", () => {
  ok(S.labelMatches(PORTAL_SJPT, "학사정보시스템", ""));                     // site drops " (SJPT)"
  ok(S.labelMatches(PORTAL_SJPT, "Academic Information System", ""));
  ok(S.labelMatches(PORTAL_SJPT, "", "학사정보시스템"));                     // only the title says it
  ok(S.labelMatches(PORTAL_SJPT, "ACADEMIC information system (sjpt)", ""));
  ok(!S.labelMatches(PORTAL_SJPT, "General Administrative Information System", ""));
  ok(!S.labelMatches(GENERAL_ADMIN, "Academic Information System", "Academic Information System"));
  ok(!S.labelMatches(PORTAL_SJPT, "", ""));
  ok(!S.labelMatches(PORTAL_SJPT, "S", ""));                                 // 1 letter never matches
});

test("pickCandidate finds 학사정보시스템 among the SSO links in KOR and ENG mode (bug: ENG never highlighted)", () => {
  for (const mode of Object.keys(SSO_LINKS)) {
    eq([mode, S.pickCandidate(PORTAL_SJPT, SSO_LINKS[mode])], [mode, 1]);
    eq([mode, S.pickCandidate(GENERAL_ADMIN, SSO_LINKS[mode])], [mode, 0]);  // and never the other way round
  }
});

test("pickCandidate prefers a visible labelled match, refuses to guess between different links", () => {
  const twice = [{ text: "학사정보시스템", title: "", visible: false }, { text: "Academic Information System", title: "", visible: true }];
  eq(S.pickCandidate(PORTAL_SJPT, twice), 1);                              // hidden mobile copy + visible desktop
  eq(S.pickCandidate(PORTAL_SJPT, [twice[0]]), 0);                         // exists but hidden: still reported
  const unknown = [{ text: "*Student*Information Plaza", title: "", visible: true }];
  eq(S.pickCandidate({ name_ko: "학부생학사정보", name_en_site: "Student Information Plaza" }, unknown), 0); // one match: keep
  const same = [{ text: "Menu", visible: false }, { text: "menu", visible: true }];
  eq(S.pickCandidate({ name_ko: "메뉴" }, same), 1);                        // copies of one entry: keep, visible first
  const different = [{ text: "Notices", visible: true }, { text: "Calendar", visible: true }];
  eq(S.pickCandidate({ name_ko: "학사정보", name_en_site: "Academic Information" }, different), -1);
  eq(S.pickCandidate(PORTAL_SJPT, []), -1);
});

test("boxIsShown: real size, clipped by overflow ancestors and the document edge", () => {
  const box = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  ok(S.boxIsShown(box(10, 10, 100, 20), []));
  ok(!S.boxIsShown(box(10, 10, 0, 20), []));                                // zero width
  ok(!S.boxIsShown(null, []));
  const closedDropdown = { left: 0, top: 50, right: 500, bottom: 50 };     // height:0; overflow:hidden
  ok(!S.boxIsShown(box(10, 60, 100, 20), [closedDropdown]));
  const openDropdown = { left: 0, top: 50, right: 500, bottom: 300 };
  ok(S.boxIsShown(box(10, 60, 100, 20), [openDropdown]));
  const onlyClipsX = { left: 0, right: 500, top: -Infinity, bottom: Infinity }; // overflow-x: hidden only
  ok(S.boxIsShown(box(10, 900, 100, 20), [onlyClipsX]));
  const documentEdge = { left: 0, top: 0, right: Infinity, bottom: Infinity };
  ok(!S.boxIsShown(box(-9999, 10, 100, 20), [documentEdge]));               // left:-9999px "hidden" menu
  ok(S.boxIsShown(box(10, 2000, 100, 20), [documentEdge]));                 // below the fold: scrollable, so visible
});

test("frameGeometry: element box + 4 px padding + 3 px border, nothing more", () => {
  const link = { left: 100, top: 50, width: 120, height: 20 };
  const g = S.frameGeometry(link);
  eq([g.left, g.top, g.width, g.height], [93, 43, 134, 34]);
  eq(S.frameGeometry(link, 0, 0), { left: 100, top: 50, width: 120, height: 20, glow: 0.35 });
  eq([S.FRAME_PAD, S.FRAME_BORDER], [4, 3]);
});

test("frameGeometry: the inward glow never reaches the middle of a one-line link", () => {
  for (const height of [14, 20, 28, 40, 60, 200]) {
    const g = S.frameGeometry({ left: 0, top: 0, width: 300, height });
    const inside = height + 2 * S.FRAME_PAD;
    // widest glow layer (content.css): inset 0 0 18px*glow 8px*glow; it fades out by spread + blur/2
    const reach = 8 * g.glow + 18 * g.glow / 2;
    ok(g.glow >= 0.35 && g.glow <= 1, `glow ${g.glow}`);
    ok(reach < inside / 2, `height ${height}: glow reaches ${reach}px of ${inside / 2}px`);
  }
  eq(S.frameGeometry({ left: 0, top: 0, width: 300, height: 200 }).glow, 1); // big box: the full glow
});

test("contentScriptMissing: only Sejong tabs where no frame answered", () => {
  ok(S.contentScriptMissing("https://portal.sejong.ac.kr/main.do", 0));
  ok(S.contentScriptMissing("https://sjpt.sejong.ac.kr/main/view/Login/doSsoLogin.do", 0));
  ok(!S.contentScriptMissing("https://portal.sejong.ac.kr/main.do", 2));      // running
  ok(!S.contentScriptMissing("https://www.google.com/", 0));                  // not ours
  ok(!S.contentScriptMissing("chrome://extensions/", 0));
  ok(!S.contentScriptMissing(undefined, 0));                                  // no access to the URL
});

test("guideStatus: a Sejong tab where injecting failed asks for a reload", () => {
  const g = Object.assign(S.newGuide(ROUTE, null, 5), { step: 2 });
  eq(S.guideStatus(g, { startedAt: 5, shown: -1, sejong: false, injectFailed: true }), { kind: "reload", index: 2 });
  eq(S.guideStatus(g, { startedAt: 5, shown: -1, sejong: false, injectFailed: false }), { kind: "other-tab", index: 2 });
});

test("englishName prefers the site's own label, decoded", () => {
  eq(S.englishName({ name_en: "Academic Q&A", name_en_site: "Academic Affairs Q&#38;A" }), "Academic Affairs Q&A");
  eq(S.englishName({ name_en: "Classes", name_en_site: null }), "Classes");
  eq(S.englishName(null), "");
});

const SJPT_ROUTE = [
  { id: "portal.root", site: "portal", name_ko: "세종대학교 포털" },
  { id: "portal.sjpt", site: "portal", name_ko: "학사정보시스템 (SJPT)", name_en_site: "Academic Information System (SJPT)", opens_new_tab: true },
  { id: "sjpt.st", site: "sjpt", name_ko: "학생서비스", name_en_site: "Service For Student" },
  { id: "sjpt.student_counseling_center", site: "sjpt", name_ko: "학생생활상담소", name_en_site: null },
  { id: "sjpt.counseling", site: "sjpt", name_ko: "상담", name_en_site: null },
];

test("korOnlyStep: next step missing in an English-mode page and has no English label", () => {
  const g = Object.assign(S.newGuide(SJPT_ROUTE, null, 1), { step: 3 });
  const en = { site: "sjpt", lang: "en", visible: [2], hidden: [] };
  eq(S.korOnlyStep(g, [en], 2), 3);
  eq(S.korOnlyStep(g, [Object.assign({}, en, { lang: "ko" })], 2), -1);    // Korean mode: just not opened yet
  eq(S.korOnlyStep(g, [Object.assign({}, en, { lang: null })], 2), -1);    // language unknown: say nothing
  eq(S.korOnlyStep(g, [Object.assign({}, en, { hidden: [3] })], 2), -1);   // in a collapsed branch: it exists
  eq(S.korOnlyStep(g, [Object.assign({}, en, { visible: [2, 3] })], 3), -1); // it is on screen
  eq(S.korOnlyStep(g, [Object.assign({}, en, { site: "portal" })], 2), -1); // English portal says nothing about SJPT
  eq(S.korOnlyStep(Object.assign({}, g, { step: 2 }), [en], 1), -1);        // the step has an English label
  const lib = [{ id: "portal.root", site: "portal" }, { id: "library.home", site: "library", name_ko: "학술정보원", name_en_site: null }];
  eq(S.korOnlyStep(S.newGuide(lib, null, 1), [{ site: "library", lang: "en", visible: [], hidden: [] }], -1), -1);
  // library: English labels were never recorded, so null says nothing
});

test("guideStatus reports kor-only before missing/hint", () => {
  const g = Object.assign(S.newGuide(SJPT_ROUTE, null, 5), { step: 3 });
  const view = (shown, korOnly) => ({ startedAt: 5, shown, sejong: true, korOnly });
  eq(S.guideStatus(g, view(2, 3)), { kind: "kor-only", index: 3 });
  eq(S.guideStatus(g, view(-1, 3)), { kind: "kor-only", index: 3 });
  eq(S.guideStatus(g, view(2, -1)), { kind: "hint", index: 2 });
  eq(S.guideStatus(g, view(2, undefined)), { kind: "hint", index: 2 }); // views saved before this field existed
});

test("a collapsed SJPT branch: the nearest visible parent step is highlighted until it is opened", () => {
  let g = Object.assign(S.newGuide(SJPT_ROUTE, null, 7), { step: 2 });
  // SJPT tab, tree collapsed: 학생서비스 visible, 학생생활상담소 and 상담 in the DOM but hidden
  let p = S.pickStep(g, [2]);
  eq(p, { show: 2, step: 2 });
  g = S.advanceGuide(g, p.show).guide;                       // user opens 학생서비스
  p = S.pickStep(g, [2, 3]);                                 // its children are now on screen
  eq(p, { show: 3, step: 3 });
  g = S.advanceGuide(g, p.show).guide;                       // user expands 학생생활상담소
  eq(S.pickStep(g, [2, 3, 4]), { show: 4, step: 4 });
});

// ------------------------------------------------------------------ UI text (i18n)
// EN_MESSAGES = extension/_locales/en/messages.json, USED_KEYS = every key the code uses
// (both injected by tests/test_extension_js.py).

const T = S.makeTranslator(EN_MESSAGES); // strict: a missing key throws

test("every UI string key used by the code exists in English messages.json", () => {
  ok(USED_KEYS.length > 50, "the key scan found almost nothing");
  const missing = USED_KEYS.filter((key) => !EN_MESSAGES[key]);
  eq(missing, []);
  for (const key of USED_KEYS) ok(T(key, ["A", "B", "C"]).trim(), `${key} is empty`);
});

test("formatMessage follows Chrome's placeholder rules", () => {
  const entry = { message: "Step $step$ of $total$ costs $$5", placeholders: { step: { content: "$1" }, total: { content: "$2" } } };
  eq(S.formatMessage(entry, [3, 7]), "Step 3 of 7 costs $5");
  eq(S.formatMessage(entry, ["$2", "x"]), "Step $2 of x costs $5");   // a substitution is not re-substituted
  eq(S.formatMessage({ message: "Hi $Name$", placeholders: { name: { content: "$1" } } }, "Ann"), "Hi Ann"); // case-insensitive, single sub
  eq(S.formatMessage({ message: "plain" }), "plain");
  eq(S.formatMessage(undefined), "");
});

test("makeTranslator: chosen language first, then the fallback; strict without one", () => {
  const uz = S.makeTranslator({ stop: { message: "To'xtatish" } }, (key) => T(key));
  eq(uz("stop"), "To'xtatish");
  eq(uz("settings"), "Settings");                     // not translated yet: English
  let threw = false;
  try { T("no_such_key"); } catch (e) { threw = true; }
  ok(threw, "a missing key must throw in the strict translator");
});

const GUIDE_ROUTE = [
  { id: "portal.root", site: "portal", name_ko: "세종대학교 포털", name_en: "Sejong University Portal" },
  { id: "portal.sjpt", site: "portal", name_ko: "학사정보시스템 (SJPT)", name_en_site: "Academic Information System (SJPT)", opens_new_tab: true },
  { id: "sjpt.self_stud", site: "sjpt", name_ko: "학부생학사정보", name_en_site: "*Student*Information Plaza", mobile_path_note: "top tab first" },
  { id: "sjpt.current_semester_grades", site: "sjpt", name_ko: "당학기성적조회", name_en_site: "Current Semester Grade inquiry" },
];

test("guideMessage: every status has English text with Korean + English menu names", () => {
  const g = Object.assign(S.newGuide(GUIDE_ROUTE, null, 1), { step: 2 });
  const kinds = ["pending", "reload", "other-tab", "kor-only", "other-site", "missing", "hint", "next", "here"];
  for (const kind of kinds) {
    const index = kind === "here" ? 3 : kind === "hint" ? 1 : 2;
    const text = S.guideMessage(g, { kind, index }, T);
    ok(text && text.indexOf("$") < 0, `${kind}: ${text}`);
    ok(text.indexOf(kind === "here" ? "당학기성적조회" : kind === "hint" ? "학사정보시스템" : "학부생학사정보") >= 0, `${kind}: ${text}`);
  }
  eq(S.guideMessage(g, { kind: "next", index: 2 }, T), "Step 2 of 3: click the highlighted “학부생학사정보 / *Student*Information Plaza”.");
  ok(S.guideMessage(g, { kind: "hint", index: 1 }, T).indexOf("It opens in a new tab") >= 0); // portal.sjpt opens a new tab
  ok(S.guideMessage(g, { kind: "missing", index: 2 }, T).indexOf("top tab first") < 0); // no internal notes
  ok(S.guideMessage(g, { kind: "kor-only", index: 2 }, T).indexOf("This menu only appears in Korean mode (KOR)") === 0);
  ok(S.guideMessage(g, { kind: "reload", index: 2 }, T).indexOf("Reload this page (Cmd+R) to start the guide.") === 0);
});

test("idleMessage: no path, another guide, done, stopped", () => {
  const g = S.newGuide(GUIDE_ROUTE, null, 1);
  eq(S.idleMessage([GUIDE_ROUTE[0]], "x", null, null, T), "No click path to this item.");
  ok(S.idleMessage(GUIDE_ROUTE, "x", g, null, T).indexOf("당학기성적조회") >= 0);
  eq(S.idleMessage(GUIDE_ROUTE, "t", null, { targetId: "t", outcome: "finished", name: "당학기성적조회" }, T), "Done: you reached “당학기성적조회”.");
  eq(S.idleMessage(GUIDE_ROUTE, "t", null, { targetId: "t", outcome: "stopped" }, T), "Guide stopped.");
  eq(S.idleMessage(GUIDE_ROUTE, "t", null, { targetId: "other", outcome: "stopped" }, T), "");
});

test("crumbsModel: current step orange, earlier steps done, root never struck", () => {
  const rows = S.crumbsModel(GUIDE_ROUTE, 2, 2);
  eq(rows.map((r) => r.state), ["", "done", "current", ""]);
  eq([rows[1].ko, rows[1].en], ["학사정보시스템 (SJPT)", "Academic Information System (SJPT)"]);
  eq(rows[0].en, "Sejong University Portal");
  eq(S.crumbsModel(GUIDE_ROUTE).map((r) => r.state), ["", "", "", ""]); // just a path, no guide
});

// ------------------------------------------------------------------ floating widget

test("widgetMode: mini → compact → full and back, toolbar toggle, junk", () => {
  eq(S.WIDGET_MODES, ["mini", "compact", "full"]);
  eq(S.widgetMode("mini", "expand"), "compact");         // click the pill
  eq(S.widgetMode("compact", "expand"), "full");
  eq(S.widgetMode("full", "expand"), "full");
  eq(S.widgetMode("full", "collapse"), "compact");
  eq(S.widgetMode("compact", "collapse"), "mini");
  eq(S.widgetMode("mini", "collapse"), "mini");
  eq(S.widgetMode("full", "toggle"), "mini");            // toolbar icon
  eq(S.widgetMode("compact", "toggle"), "full");
  eq(S.widgetMode("mini", "toggle"), "full");
  eq(S.widgetMode("full", "compact"), "compact");        // set directly (guide started)
  eq(S.widgetMode("garbage", "expand"), "full");         // unknown saved mode: the default
  eq(S.widgetMode(undefined, "nothing"), S.DEFAULT_WIDGET_MODE);
});

const VIEW = { width: 1200, height: 800 };
const SIZE = { width: 300, height: 200 };
const rect = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h });
const box = (p) => rect(p.x, p.y, SIZE.width, SIZE.height);
const overlaps = (a, b) => Math.min(a.right, b.right) > Math.max(a.left, b.left) && Math.min(a.bottom, b.bottom) > Math.max(a.top, b.top);

test("clampWidget keeps the widget inside the viewport (resize)", () => {
  eq(S.clampWidget(null, SIZE, VIEW), { x: 892, y: 592 });                       // default: bottom-right
  eq(S.clampWidget({ x: 5000, y: -40 }, SIZE, VIEW), { x: 892, y: 8 });
  eq(S.clampWidget({ x: 892, y: 592 }, SIZE, { width: 600, height: 400 }), { x: 292, y: 192 }); // window got smaller
  eq(S.clampWidget({ x: 100, y: 100 }, SIZE, { width: 200, height: 100 }), { x: 8, y: 8 });     // bigger than the window
});

test("placeWidget: stays home unless it would cover the highlight, then the opposite corner", () => {
  const home = { x: 892, y: 592 };                                              // bottom-right
  eq(S.placeWidget(home, SIZE, null, VIEW), { x: 892, y: 592, avoided: false });
  eq(S.placeWidget(home, SIZE, rect(100, 100, 120, 30), VIEW), { x: 892, y: 592, avoided: false }); // far away
  const under = rect(950, 650, 120, 30);                                        // highlight behind the widget
  const p = S.placeWidget(home, SIZE, under, VIEW);
  eq(p, { x: 8, y: 8, avoided: true });                                         // diagonally opposite: top-left
  ok(!overlaps(box(p), under));
  // just outside the widget but within the 8 px margin still counts as covering
  ok(S.placeWidget(home, SIZE, rect(870, 650, 20, 20), VIEW).avoided);
});

test("placeWidget: the next free corner when the opposite one is covered too, least overlap if none is free", () => {
  const home = { x: 8, y: 8 };                                                  // top-left
  const wideBar = rect(0, 0, 1200, 120);                                        // a full-width menu bar at the top
  const p = S.placeWidget(home, SIZE, wideBar, VIEW);
  ok(p.avoided && p.y === 592, JSON.stringify(p));                              // moved to the bottom
  ok(!overlaps(box(p), wideBar));
  const huge = rect(0, 0, 1200, 800);                                           // covers everything
  const q = S.placeWidget(home, SIZE, huge, VIEW);
  ok(q.avoided && Number.isFinite(q.x) && Number.isFinite(q.y));
});

test("placeWidget returns home after the highlight moves away (home is never changed)", () => {
  const home = { x: 892, y: 592 };
  ok(S.placeWidget(home, SIZE, rect(950, 650, 120, 30), VIEW).avoided);
  eq(S.placeWidget(home, SIZE, null, VIEW), { x: 892, y: 592, avoided: false });
  eq(home, { x: 892, y: 592 });
});

// ------------------------------------------------------------------ Problem M: sites in the guide

// portal.root → … → 학술정보원 (portal.library, entry) → library home → … → 열람실 좌석배정 이용
const LIB_ROUTE = [
  { id: "portal.root", site: "portal", name_ko: "세종대학교 포털" },
  { id: "portal.student_services", site: "portal", name_ko: "학생서비스", name_en_site: "Student Services",
    mobile_path_note: "open hamburger ≡, tap '학생서비스' (a.depth_tit1, 2nd)", selector_desktop: null },
  { id: "portal.other_services", site: "portal", name_ko: "기타 서비스" },
  { id: "portal.library", site: "portal", name_ko: "학술정보원", kind: "entry", entry_for: "library", opens_new_tab: true },
  { id: "library.home", site: "library", name_ko: "세종대학교 학술정보원" },
  { id: "library.about_facilities", site: "library", name_ko: "시설 및 서비스이용" },
  { id: "library.fs_seat", site: "library", name_ko: "열람실 좌석배정 이용", name_en_site: null },
];

test("trimRouteForSite: start at the first step on the current site (bug B)", () => {
  const ids = (r) => r.map((s) => s.id);
  eq(ids(S.trimRouteForSite(LIB_ROUTE, "library")),
     ["portal.library", "library.home", "library.about_facilities", "library.fs_seat"]); // no portal detour
  eq(S.trimRouteForSite(LIB_ROUTE, "portal"), LIB_ROUTE);    // starts here anyway
  eq(S.trimRouteForSite(LIB_ROUTE, "sjpt"), LIB_ROUTE);      // never visits SJPT: the first step says where to go
  eq(S.trimRouteForSite(LIB_ROUTE, null), LIB_ROUTE);
  eq(S.trimRouteForSite([], "library"), []);
  // a trimmed route is still a guide: its first step (route[1]) is on this site
  const g = S.newGuide(S.trimRouteForSite(LIB_ROUTE, "library"), null, 1);
  ok(S.isGuide(g) && g.route[g.step].site === "library");
});

test("entryOnSite: an entry link into the site you are already on (bug A)", () => {
  ok(S.entryOnSite(LIB_ROUTE[3], "library"));
  ok(!S.entryOnSite(LIB_ROUTE[3], "portal"));               // from the portal it IS the way in
  ok(!S.entryOnSite(LIB_ROUTE[6], "library"));              // a normal page
  ok(!S.entryOnSite(LIB_ROUTE[3], null));
});

test("guideStatus: a step on another site is 'other-site', not 'missing' (bug D, item 2)", () => {
  const g = Object.assign(S.newGuide(LIB_ROUTE, null, 5), { step: 1 }); // next: 학생서비스 on the portal
  const view = (site, shown) => ({ startedAt: 5, shown, sejong: true, site });
  eq(S.guideStatus(g, view("library", -1)), { kind: "other-site", index: 1 });
  eq(S.guideStatus(g, view("portal", -1)), { kind: "missing", index: 1 });       // right site, just not open yet
  eq(S.guideStatus(g, view("portal", 1)), { kind: "next", index: 1 });
  eq(S.guideStatus(g, view(undefined, -1)), { kind: "missing", index: 1 });      // views saved before site existed
  const later = Object.assign({}, g, { step: 4 });                              // next: library home
  eq(S.guideStatus(later, view("portal", 3)), { kind: "other-site", index: 4 }); // portal tab still shows 학술정보원
  eq(S.guideStatus(later, view("library", 6)), { kind: "here", index: 6 });      // went ahead on the library site
});

test("status text never shows mobile_path_note, selectors or site codes (bug D)", () => {
  const g = Object.assign(S.newGuide(LIB_ROUTE, null, 5), { step: 1 });
  const other = S.guideMessage(g, { kind: "other-site", index: 1 }, T);
  eq(other, "Step 1 of 6: this step (“학생서비스 / Student Services”) is on the Portal.");
  for (const kind of ["other-site", "missing", "hint", "next", "pending", "other-tab"]) {
    const text = S.guideMessage(g, { kind, index: 1 }, T);
    for (const leak of ["hamburger", "a.depth_tit1", "mobile_path_note", "selector", "portal.", "≡"]) {
      ok(text.indexOf(leak) < 0, `${kind} shows "${leak}": ${text}`);
    }
  }
});

test("siteName: plain names for buttons and sentences", () => {
  eq([S.siteName("portal", T), S.siteName("portal", T, true)], ["Portal", "the Portal"]);
  eq([S.siteName("library", T), S.siteName("library", T, true)], ["Library", "the Library"]);
  eq(S.siteName("sjpt", T), "SJPT");
  eq(T("open_site", [S.siteName("portal", T)]), "Open Portal");
  eq(T("already_on_site", [S.siteName("library", T, true)]), "You are already in the Library.");
});

test("siteOfUrl / siteHome", () => {
  eq(S.siteOfUrl("https://library.sejong.ac.kr/search?x=1"), "library");
  eq(S.siteOfUrl("https://libseat.sejong.ac.kr/mobile/PA/roomStatus.php"), null);
  eq(S.siteOfUrl(undefined), null);
  eq(S.siteHome("portal"), "https://portal.sejong.ac.kr");
  eq(S.siteHome("nope"), null);
});

test("newTabSite: which step opens another Sejong site in a new tab (bug C)", () => {
  eq(S.newTabSite(LIB_ROUTE, 3), "library");                // 학술정보원 → library tab
  eq(S.newTabSite(LIB_ROUTE, 2), null);                     // same site, same tab
  eq(S.newTabSite(LIB_ROUTE, 6), null);                     // last step
  eq(S.newTabSite(null, 0), null);
});

test("pickTabForSite: reuse the most recently used tab of that site, never the clicked one (bug C)", () => {
  const tabs = [
    { id: 1, url: "https://portal.sejong.ac.kr/main.do", lastAccessed: 50 },
    { id: 2, url: "https://library.sejong.ac.kr/", lastAccessed: 10 },
    { id: 3, url: "https://library.sejong.ac.kr/searchTotal", lastAccessed: 30 },
    { id: 4, url: "https://libseat.sejong.ac.kr/x", lastAccessed: 99 },
  ];
  eq(S.pickTabForSite(tabs, "library", 1).id, 3);
  eq(S.pickTabForSite(tabs, "library", 3).id, 2);
  eq(S.pickTabForSite(tabs, "sjpt", 1), null);              // none open: the link opens a new tab as usual
  eq(S.pickTabForSite(tabs, "portal", 1), null);            // only the tab the click came from
  eq(S.pickTabForSite(null, "library", 1), null);
});

print("RESULT " + JSON.stringify({ passed, failures }));
print("EXPORT " + JSON.stringify(exported));
