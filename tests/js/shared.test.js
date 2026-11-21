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

print("RESULT " + JSON.stringify({ passed, failures }));
print("EXPORT " + JSON.stringify(exported));
