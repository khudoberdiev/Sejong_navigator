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

// ------------------------------------------------------------------ Problem N

// 1. Same-page steps: URL matching
test("samePage: trailing slash, #hash, index.do, extra query on the page (fix 1)", () => {
  const home = "https://library.sejong.ac.kr/";
  for (const page of ["https://library.sejong.ac.kr", "https://library.sejong.ac.kr/", "https://library.sejong.ac.kr/#",
    "https://library.sejong.ac.kr/#content", "https://library.sejong.ac.kr/index.do", "https://LIBRARY.sejong.ac.kr/index.do?lang=en",
    "https://library.sejong.ac.kr/?token=abc", "http://library.sejong.ac.kr:443/"]) {
    ok(S.samePage(home, page), page);
  }
  ok(S.samePage("https://library.sejong.ac.kr/webcontent/info/22/", "https://library.sejong.ac.kr/webcontent/info/22#top"));
  ok(S.samePage("https://library.sejong.ac.kr/myloan/list", "https://library.sejong.ac.kr/myloan/list;jsessionid=XYZ?page=2"));
  ok(!S.samePage(home, "https://library.sejong.ac.kr/webcontent/info/22"), "another page");
  ok(!S.samePage(home, "https://portal.sejong.ac.kr/"), "another host");
  ok(!S.samePage("https://library.sejong.ac.kr/webcontent/info/22", "https://library.sejong.ac.kr/webcontent/info/2"));
  // the step's own query must match: board ?id=1 is not board ?id=2
  ok(S.samePage("https://ecampus.sejong.ac.kr/mod/ubboard/view.php?id=1", "https://ecampus.sejong.ac.kr/mod/ubboard/view.php?id=1&page=3"));
  ok(!S.samePage("https://ecampus.sejong.ac.kr/mod/ubboard/view.php?id=1", "https://ecampus.sejong.ac.kr/mod/ubboard/view.php?id=2"));
  ok(!S.samePage(null, home) && !S.samePage(home, "") && !S.samePage("javascript:void(0)", home));
});

test("isRealLink: menu toggles never count as 'this page'", () => {
  for (const href of ["#", "#top", "javascript:void(0)", " JavaScript:fn()", "", null]) ok(!S.isRealLink(href), String(href));
  for (const href of ["/", "/webcontent/info/22", "https://library.sejong.ac.kr/"]) ok(S.isRealLink(href), href);
});

const HOME_ROUTE = [
  { id: "portal.library", site: "portal", url: "https://library.sejong.ac.kr/" },  // route[0]: never a step
  { id: "library.home", site: "library", url: "https://library.sejong.ac.kr/" },
  { id: "library.seat_status", site: "library", url: null },
  { id: "library.seat_status_more", site: "library", url: "https://libseat.sejong.ac.kr/mobile/PA/roomStatus.php", opens_new_tab: true },
];

test("stepsOnPage + skipDoneSteps: the logo step is done on the library home page (bug A)", () => {
  const g = S.newGuide(HOME_ROUTE, null, 1);
  eq(S.stepsOnPage(HOME_ROUTE, "https://library.sejong.ac.kr/#"), [1]);       // route[0] is skipped
  eq(S.skipDoneSteps(g, S.stepsOnPage(HOME_ROUTE, "https://library.sejong.ac.kr/index.do")), { step: 2, finished: false, done: 1 });
  eq(S.skipDoneSteps(g, S.stepsOnPage(HOME_ROUTE, "https://library.sejong.ac.kr/searchTotal")), { step: 1, finished: false, done: -1 });
  eq(S.skipDoneSteps(g, [3]), { step: 1, finished: true, done: 3 });           // the target page is open
  const ahead = Object.assign({}, g, { step: 3 });
  eq(S.skipDoneSteps(ahead, [1]).step, 3);                                      // never moves back
  eq(S.skipDoneSteps(g, [0, 9, "x"]), { step: 1, finished: false, done: -1 });  // junk ignored
});

// 2. Off-screen pointer
const WIN = { left: 0, top: 0, right: 1000, bottom: 800 };
const ARROW = S.ARROW_SIZE; // 56 × 56, 14 px from the edge
test("offscreenArrow: hidden while the target is in view (fix 2)", () => {
  eq(S.offscreenArrow({ left: 100, top: 300, right: 200, bottom: 330 }, WIN, ARROW), null);
  eq(S.offscreenArrow({ left: 100, top: 780, right: 200, bottom: 830 }, WIN, ARROW), null);   // 20 px shown: in view
  eq(S.offscreenArrow({ left: 100, top: 0, right: 200, bottom: 13 }, WIN, ARROW), null);       // a short target, all of it shown
});

test("offscreenArrow: below → bottom edge, above → top edge, at the target's x (fix 2)", () => {
  eq(S.offscreenArrow({ left: 400, top: 1500, right: 500, bottom: 1530 }, WIN, ARROW), { dir: "down", x: 422, y: 730 });
  eq(S.offscreenArrow({ left: 400, top: -300, right: 500, bottom: -270 }, WIN, ARROW), { dir: "up", x: 422, y: 14 });
  // just 5 px peeking in: still an arrow
  eq(S.offscreenArrow({ left: 400, top: 795, right: 500, bottom: 825 }, WIN, ARROW).dir, "down");
});

test("offscreenArrow: x clamped to the screen", () => {
  eq(S.offscreenArrow({ left: -500, top: 2000, right: -400, bottom: 2030 }, WIN, ARROW).x, 14);
  eq(S.offscreenArrow({ left: 990, top: 2000, right: 1400, bottom: 2030 }, WIN, ARROW).x, 1000 - 56 - 14);
  eq(S.offscreenArrow({ left: 0, top: 2000, right: 10, bottom: 2030 }, { left: 0, top: 0, right: 30, bottom: 800 }, ARROW).x, 14); // tiny view
});

test("offscreenArrow inside a scrolling box (SJPT tree): its edges, not the window's", () => {
  const tree = S.visibleArea({ width: 1000, height: 800 }, [{ left: 0, top: 150, right: 240, bottom: 600 }]);
  eq(tree, { left: 0, top: 150, right: 240, bottom: 600 });
  eq(S.offscreenArrow({ left: 20, top: 900, right: 200, bottom: 920 }, tree, ARROW), { dir: "down", x: 82, y: 530 });
  eq(S.offscreenArrow({ left: 20, top: 100, right: 200, bottom: 120 }, tree, ARROW), { dir: "up", x: 82, y: 164 });
  eq(S.offscreenArrow({ left: 20, top: 300, right: 200, bottom: 320 }, tree, ARROW), null);
  // the box itself is below the window: point at the window's edge (scroll the page first)
  eq(S.visibleArea({ width: 1000, height: 800 }, [{ left: 0, top: 900, right: 240, bottom: 1400 }]),
    { left: 0, top: 0, right: 1000, bottom: 800 });
});

// 5. Labels: never "(home)", never doubled
test("englishName shows label_en: no '(home)' note", () => {
  eq(S.englishName({ name_en: "Study room booking (home)", label_en: "Study room booking" }), "Study room booking");
  eq(S.englishName({ name_en: "Seat status (home)", name_en_site: null, label_en: "Seat status" }), "Seat status");
  eq(S.bothNames({ name_ko: "좌석 현황", name_en: "Seat status (home)", label_en: "Seat status" }), "좌석 현황 / Seat status");
  const row = S.crumbsModel([{ id: "a", name_ko: "스터디룸 예약", name_en: "Study room booking (home)", label_en: "Study room booking" }])[0];
  ok(row.en.indexOf("(home)") < 0, row.en);
});

test("replaceLabelText: the whole label, never prepended (bug D)", () => {
  eq(S.replaceLabelText(["S-Lounge", " 예약"], "S-Lounge booking"), ["S-Lounge booking", ""]);
  eq(S.replaceLabelText(["  스터디룸 예약 "], "Study room booking"), ["  Study room booking "]);
  eq(S.replaceLabelText(["\n", "스터디룸", " ", "예약"], "Study room booking"), ["\n", "Study room booking", " ", ""]);
  const shown = S.replaceLabelText(["S-Lounge", " 예약"], "S-Lounge booking").join("");
  eq(shown.split("S-Lounge").length - 1, 1);
});

test("nodeIsWholeLabel: a badge may follow, a word may not", () => {
  ok(S.nodeIsWholeLabel("학사정보", "학사정보"));
  ok(S.nodeIsWholeLabel("학사정보", "학사정보 N"));
  ok(!S.nodeIsWholeLabel("예약", "S-Lounge 예약"));
  ok(!S.nodeIsWholeLabel("예약", "스터디룸 예약"));
  ok(!S.nodeIsWholeLabel("", "x"));
});

test("pickEnglish: a shared Korean label only where that item's selector matches", () => {
  const more = [{ en: "More seat status", selectors: [".usingTimeCon a.more"] }];
  eq(S.pickEnglish(more, (sel) => sel === ".usingTimeCon a.more"), "More seat status");
  eq(S.pickEnglish(more, () => false), null);                       // some other "더보기": left alone
  eq(S.pickEnglish([{ en: "Recorded", selectors: [] }], () => false), "Recorded");
  eq(S.pickEnglish([{ en: "A", selectors: ["::bad("] }, { en: "B", selectors: [] }], () => { throw new Error("bad"); }), "B");
});

// 4. Answer card and the booking hint
const RULES = {
  answers: [{ id: "seat_booking", message: "answer_seat_booking", triggers: ["seat reservation", "book seat", "좌석 예약", "joy band"], actions: [] }],
  done_hints: { "library.studyroom_booking": "hint_room_booking" },
};
test("answerFor: seat questions get the kiosk answer card (fix 4)", () => {
  for (const q of ["seat reservation", "Book a seat", "좌석 예약", "열람실좌석예약", "joy band qilish", "how do I book a seat?"]) {
    eq((S.answerFor(RULES, q) || {}).id, "seat_booking");
  }
  for (const q of ["study room", "seat status", "xona band qilish", "booking", ""]) eq(S.answerFor(RULES, q), null);
  eq(S.answerTokens("O'rindiq  band-qilish!"), ["orindiq", "band", "qilish"]);
});

test("finishedMessage: room booking hint after the guide opens libseat", () => {
  const hint = S.doneHint(RULES, "library.studyroom_booking");
  eq(hint, "hint_room_booking");
  eq(S.doneHint(RULES, "library.fs_seat"), null);
  eq(S.finishedMessage({ outcome: "finished", name: "스터디룸 예약", hint }, T),
    "Done: you reached “스터디룸 예약”. Pick a room, then a time. Rooms must be booked for at least half their capacity.");
  eq(S.finishedMessage({ outcome: "finished", name: "좌석 현황", already: true }, T), "You are already on “좌석 현황”.");
  eq(S.finishedMessage({ outcome: "stopped" }, T), "");
  eq(S.idleMessage(GUIDE_ROUTE, "t", null, { targetId: "t", outcome: "finished", name: "X", hint }, T).indexOf("half their capacity") > 0, true);
});

test("new-tab hint: libseat is not a site the guide continues on", () => {
  const route = [{ id: "library.home", site: "library", name_ko: "홈" },
    { id: "library.studyroom_booking", site: "library", name_ko: "스터디룸 예약", label_en: "Study room booking",
      url: "https://libseat.sejong.ac.kr/mobile/MA/LsroomList.php", opens_new_tab: true }];
  const g = S.newGuide(route, null, 1);
  eq(S.guideMessage(g, { kind: "here", index: 1 }, T), "You are there: “스터디룸 예약 / Study room booking” is highlighted. Click it to finish.");
  const next = S.guideMessage(Object.assign({}, g), { kind: "next", index: 1 }, T);
  ok(next.endsWith(T("hint_new_tab_external")) && next.indexOf(T("hint_new_tab")) < 0, next);
});

// ------------------------------------------------------------------ UI tweaks: arrow, ×

test("arrow: 56 × 56, room for the 10 px bounce at both edges", () => {
  eq(S.ARROW_SIZE, { width: 56, height: 56 });
  ok(S.ARROW_MARGIN >= 10 + 2, "the bounce must stay on screen");
  const down = S.offscreenArrow({ left: 400, top: 1500, right: 500, bottom: 1530 }, WIN, S.ARROW_SIZE);
  ok(down.y + 56 + 10 <= 800, "↓ bounces down, still on screen");
  const up = S.offscreenArrow({ left: 400, top: -300, right: 500, bottom: -270 }, WIN, S.ARROW_SIZE);
  ok(up.y - 10 >= 0, "↑ bounces up, still on screen");
});

test("arrowBox: the label sits on the screen side (above ↓, below ↑)", () => {
  eq(S.arrowBox({ dir: "down", x: 100, y: 730 }), { left: 100, top: 730 - S.ARROW_LABEL, right: 156, bottom: 786 });
  eq(S.arrowBox({ dir: "up", x: 100, y: 14 }), { left: 100, top: 14, right: 156, bottom: 70 + S.ARROW_LABEL });
  eq(T("scroll_down"), "Scroll down");
  eq(T("scroll_up"), "Scroll up");
});

test("widget ×: hidden on every tab until the toolbar icon shows it again", () => {
  ok(S.widgetWanted("widget", false) && S.widgetWanted(undefined, undefined));
  ok(!S.widgetWanted("widget", true), "closed with ×");
  ok(!S.widgetWanted("panel", false), "side panel mode");
  // hide → toolbar icon → show
  eq(S.toolbarAction(true, true), ["show"]);           // on a Sejong tab: show it again (no toggle)
  eq(S.toolbarAction(true, false), ["toggle"]);        // shown: full ↔ mini, as before
  eq(S.toolbarAction(false, false), ["panel"]);        // elsewhere: the side panel
  eq(S.toolbarAction(false, true), ["panel", "show"]); // elsewhere, hidden: panel, and the widget is back on Sejong tabs
  eq(S.widgetMode("mini", "full"), "full");            // shown again in the FULL view
  eq(T("close"), "Close");
});

// ------------------------------------------------------------------ context steps (headings)

test("skipContextSteps: a heading is passed without a click; the target never is", () => {
  eq(S.skipContextSteps(2, 3, [2]), 3);           // 좌석 현황 → 더보기
  eq(S.skipContextSteps(1, 5, [2, 3]), 1);        // only from the current step on
  eq(S.skipContextSteps(2, 5, [2, 3]), 4);        // two headings in a row
  eq(S.skipContextSteps(3, 3, [3]), 3);           // the last step (the target) stays
  eq(S.skipContextSteps(2, 4, undefined), 2);
  eq(S.mergeContext([2], [4, 2, 0, 9, "x"], 5), [2, 4]); // unique, sorted, never 0 or the last step
});

test("bug: 'free seats' on library home goes straight to 더보기, which gets the ↓ arrow", () => {
  const g = S.newGuide(HOME_ROUTE, null, 1);                // portal.library → home → 좌석 현황 → 더보기
  const last = HOME_ROUTE.length - 1;
  const skip = S.skipDoneSteps(g, S.stepsOnPage(HOME_ROUTE, "https://library.sejong.ac.kr/"));
  const context = S.mergeContext(g.context, [2], last);     // content.js: .seatHeader is not clickable
  const step = S.skipContextSteps(skip.step, last, context);
  eq(step, 3);
  const visible = [1, 2, 3].filter((i) => i > skip.done && context.indexOf(i) < 0);
  eq(S.pickStep(Object.assign({}, g, { step }), visible), { show: 3, step: 3 }); // the frame is on 더보기, not the heading
  // 더보기 is below the window: the arrow points down
  eq(S.offscreenArrow({ left: 900, top: 1400, right: 960, bottom: 1420 }, WIN, S.ARROW_SIZE).dir, "down");
});

test("crumbs: context steps greyed, not struck through or orange", () => {
  const rows = S.crumbsModel(HOME_ROUTE.map((r) => Object.assign({ name_ko: r.id }, r)), 3, 3, [2]);
  eq(rows.map((r) => r.state), ["", "done", "context", "current"]);
});

test("a step that can't be found says so (no silent nothing)", () => {
  const route = [{ id: "a", name_ko: "학술정보원" }, { id: "b", name_ko: "더보기", label_en: "More seat status" }];
  const g = S.newGuide(route, null, 1);
  const view = { startedAt: 1, shown: -1, sejong: true, site: null };
  const info = S.guideStatus(g, view);
  eq(info.kind, "missing");
  eq(S.guideMessage(g, info, T), "Step 1 of 1: Can't find “더보기 / More seat status” on this page.");
});

// ------------------------------------------------------------------ regression: off screen is FOUND

// Library home at scroll top in a 1000 × 800 window. The site sets body { overflow-x: hidden }
// (CSS then makes overflow-y "auto") and html/body { height: 100% }: the body box is only the first
// screen high. Its overflow belongs to the window, so it must not hide what is below.
const rectAt = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const SHOWN = { display: "block", visibility: "visible", opacity: "1", position: "static", checkVisible: true };
const PLAIN = { overflowX: "visible", overflowY: "visible", position: "static", transform: "none", rect: null, clientWidth: 0, clientHeight: 0 };
const BODY = { overflowX: "hidden", overflowY: "auto", position: "static", transform: "none", rect: rectAt(0, 0, 1000, 800), clientWidth: 1000, clientHeight: 800, body: true };
const HTML_VISIBLE = { overflowX: "visible", overflowY: "visible" };
const TOP = { x: 0, y: 0 };
const onHome = (rect) => S.judgeVisibility(Object.assign({}, SHOWN, { rect }), [PLAIN, PLAIN, BODY], HTML_VISIBLE, TOP);

test("judgeVisibility: below the window is FOUND, not hidden (regression)", () => {
  eq(onHome(rectAt(900, 1340, 60, 20)).shown, true);            // 더보기, 540 px below the window
  eq(onHome(rectAt(100, 1100, 80, 30)).shown, true);            // the STUDY ROOM GO button
  eq(onHome(rectAt(100, 300, 80, 30)).shown, true);             // on screen, of course
  // the body clips only when the window does not scroll it (html has its own overflow)
  const own = S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(0, 1340, 60, 20) }), [BODY],
    { overflowX: "hidden", overflowY: "hidden" }, TOP);
  eq(own.shown, true);                                        // body is auto in y: a scroller
  eq(own.scrollers, [0]);
});

test("judgeVisibility: a closed dropdown is hidden", () => {
  const closedHidden = { overflowX: "hidden", overflowY: "hidden", position: "absolute", transform: "none",
    rect: rectAt(100, 60, 200, 0), clientWidth: 200, clientHeight: 0 };
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(100, 60, 180, 24) }), [PLAIN, closedHidden, BODY], HTML_VISIBLE, TOP).shown, false);
  const closedAuto = Object.assign({}, closedHidden, { overflowX: "auto", overflowY: "auto" }); // height 0: not scrollable
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(100, 60, 180, 24) }), [closedAuto], HTML_VISIBLE, TOP).shown, false);
});

test("judgeVisibility: not on the page → hidden", () => {
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { display: "none", rect: rectAt(0, 0, 0, 0) }), [], HTML_VISIBLE, TOP).shown, false);
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { visibility: "hidden", rect: rectAt(0, 0, 50, 20) }), [], HTML_VISIBLE, TOP).shown, false);
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { checkVisible: false, rect: rectAt(0, 0, 50, 20) }), [], HTML_VISIBLE, TOP).shown, false); // display:none parent
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(0, 0, 0, 0) }), [], HTML_VISIBLE, TOP).shown, false);   // zero size
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(-9999, 10, 80, 20) }), [], HTML_VISIBLE, TOP).shown, false); // left:-9999px
  eq(S.judgeVisibility(null, [], HTML_VISIBLE, TOP).shown, false);
});

test("judgeVisibility: scrolled away inside the SJPT tree is FOUND, with its scroller", () => {
  const tree = { overflowX: "hidden", overflowY: "auto", position: "relative", transform: "none",
    rect: rectAt(0, 150, 240, 450), clientWidth: 240, clientHeight: 450 };
  const v = S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(20, 900, 180, 20) }), [PLAIN, tree, BODY], HTML_VISIBLE, TOP);
  eq(v, { shown: true, scrollers: [1], reason: null });
  const view = S.visibleArea({ width: 1000, height: 800 }, [tree.rect]);
  eq(S.offscreenArrow(S.frameGeometry(rectAt(20, 900, 180, 20)), view, S.ARROW_SIZE).dir, "down");
  // position:absolute escapes a clipping ancestor that is not its containing block
  const clipStatic = { overflowX: "hidden", overflowY: "hidden", position: "static", transform: "none", rect: rectAt(0, 0, 100, 10), clientWidth: 100, clientHeight: 10 };
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { position: "absolute", rect: rectAt(0, 50, 80, 20) }), [clipStatic], HTML_VISIBLE, TOP).shown, true);
});

// The whole flow, starting at scroll top: what content.js reports → what background.js picks →
// what the widget says → where the arrow goes.
function flow(route, elements, pageUrl) {
  const guide = S.newGuide(route, null, 7);
  const probe = { visible: [], hidden: [], here: [], context: [] };
  for (const [index, e] of Object.entries(elements)) {
    const i = Number(index);
    (onHome(e.rect).shown ? probe.visible : probe.hidden).push(i);
    if (e.here) probe.here.push(i);
    if (!e.clickable) probe.context.push(i);
  }
  const plan = S.planGuide(guide, S.stepsOnPage(route, pageUrl), [probe]);
  const now = Object.assign({}, guide, { step: Math.max(guide.step, plan.pick.step), context: plan.context });
  const view = { startedAt: 7, shown: plan.pick.show, step: now.step, sejong: true, site: "library" };
  const info = S.guideStatus(now, view);
  const shownRect = elements[plan.pick.show] && elements[plan.pick.show].rect;
  const arrow = shownRect ? S.offscreenArrow(S.frameGeometry(shownRect), S.visibleArea({ width: 1000, height: 800 }, []), S.ARROW_SIZE) : null;
  return { plan, info, message: S.guideMessage(now, info, T), arrow, crumbs: S.crumbsModel(route, info.index, now.step, now.context).map((c) => c.state) };
}

test("flow: 'free seats' from scroll top → ↓ arrow on 더보기, no Can't find (regression)", () => {
  const route = HOME_ROUTE.map((r) => Object.assign({ name_ko: r.id }, r));
  const r = flow(route, {
    1: { rect: rectAt(20, 20, 160, 40), clickable: true, here: true },     // the logo: this page
    2: { rect: rectAt(600, 1300, 300, 30), clickable: false },             // 좌석 현황: a heading
    3: { rect: rectAt(900, 1340, 60, 20), clickable: true },               // 더보기
  }, "https://library.sejong.ac.kr/");
  eq(r.plan.pick.show, 3);
  eq(r.info.kind, "here");
  ok(r.message.indexOf("Can't find") < 0, r.message);
  eq(r.arrow && r.arrow.dir, "down");
  eq(r.crumbs, ["", "done", "context", "current"]);
});

test("flow: 'Book a study room' from scroll top → ↓ arrow on GO, no Can't find (regression)", () => {
  const route = [
    { id: "portal.library", site: "portal", name_ko: "학술정보원", url: "https://library.sejong.ac.kr/" },
    { id: "library.home", site: "library", name_ko: "세종대학교 학술정보원", url: "https://library.sejong.ac.kr/" },
    { id: "library.studyroom_booking", site: "library", name_ko: "스터디룸 예약", label_en: "Study room booking",
      url: "https://libseat.sejong.ac.kr/mobile/MA/LsroomList.php", opens_new_tab: true },
  ];
  const r = flow(route, {
    1: { rect: rectAt(20, 20, 160, 40), clickable: true, here: true },
    2: { rect: rectAt(100, 1100, 80, 30), clickable: true },               // GO, below the window
  }, "https://library.sejong.ac.kr/");
  eq(r.plan.pick.show, 2);
  eq(r.info.kind, "here");
  ok(r.message.indexOf("Can't find") < 0, r.message);
  eq(r.arrow && r.arrow.dir, "down");
});

test("flow: a target inside a closed dropdown is not found → Can't find", () => {
  const route = [{ id: "a", site: "library", name_ko: "홈" }, { id: "b", site: "library", name_ko: "대출현황", label_en: "Loans" }];
  const guide = S.newGuide(route, null, 7);
  const closed = { overflowX: "hidden", overflowY: "hidden", position: "absolute", transform: "none", rect: rectAt(0, 60, 200, 0), clientWidth: 200, clientHeight: 0 };
  const shown = S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(0, 60, 180, 24) }), [closed, BODY], HTML_VISIBLE, TOP).shown;
  const plan = S.planGuide(guide, [], [{ visible: shown ? [1] : [], hidden: shown ? [] : [1], here: [], context: [] }]);
  const info = S.guideStatus(guide, { startedAt: 7, shown: plan.pick.show, step: 1, sejong: true, site: "library" });
  eq(info.kind, "missing");
  eq(S.guideMessage(guide, info, T), "Step 1 of 1: Can't find “대출현황 / Loans” on this page.");
});

test("judgeVisibility: scroll-reveal (opacity 0 until scrolled to) below the window is FOUND", () => {
  const WIN_SIZE = { width: 1280, height: 900 };
  // 더보기 at the agent's position, inside section#info that fades in when scrolled to
  const more = Object.assign({}, SHOWN, { opacity: 0, rect: rectAt(955.8, 1036.6, 134.2, 20) });
  eq(S.judgeVisibility(more, [PLAIN, PLAIN, BODY], HTML_VISIBLE, TOP, WIN_SIZE), { shown: true, scrollers: [], reason: null });
  // the same on screen is really invisible: hidden (a closed fade-out menu)
  const menu = Object.assign({}, SHOWN, { opacity: 0, rect: rectAt(100, 60, 120, 24) });
  eq(S.judgeVisibility(menu, [PLAIN], HTML_VISIBLE, TOP, WIN_SIZE).reason, "opacity");
});

test("judgeVisibility: says why something is hidden", () => {
  const r = rectAt(100, 60, 180, 24);
  const closed = { overflowX: "hidden", overflowY: "hidden", position: "absolute", transform: "none", rect: rectAt(100, 60, 200, 0), clientWidth: 200, clientHeight: 0 };
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { rect: r }), [PLAIN, closed], HTML_VISIBLE, TOP).reason, "clip:1");
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { display: "none", rect: r }), [], HTML_VISIBLE, TOP).reason, "display");
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { visibility: "hidden", rect: r }), [], HTML_VISIBLE, TOP).reason, "visibility");
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(0, 0, 0, 10) }), [], HTML_VISIBLE, TOP).reason, "size");
  eq(S.judgeVisibility(Object.assign({}, SHOWN, { rect: rectAt(-9999, 10, 80, 20) }), [], HTML_VISIBLE, TOP).reason, "offpage");
});

test("flow: 'free seats' with a scroll-reveal section → ↓ arrow on 더보기 (agent's page)", () => {
  const route = HOME_ROUTE.map((r) => Object.assign({ name_ko: r.id }, r));
  const guide = S.newGuide(route, null, 7);
  const WIN_SIZE = { width: 1280, height: 900 };
  const judge = (rect, opacity) => S.judgeVisibility(Object.assign({}, SHOWN, { rect, opacity }), [PLAIN, PLAIN, BODY], HTML_VISIBLE, TOP, WIN_SIZE).shown;
  const probe = { visible: [], hidden: [], here: [1], context: [2] };
  [[1, rectAt(20, 20, 160, 40), 1], [2, rectAt(600, 1030, 480, 30), 0], [3, rectAt(955.8, 1036.6, 134.2, 20), 0]]
    .forEach(([i, rect, opacity]) => (judge(rect, opacity) ? probe.visible : probe.hidden).push(i));
  const plan = S.planGuide(guide, S.stepsOnPage(route, "https://library.sejong.ac.kr/"), [probe]);
  eq(plan.pick.show, 3);
  const info = S.guideStatus(Object.assign({}, guide, { step: plan.pick.step }), { startedAt: 7, shown: plan.pick.show, sejong: true, site: "library" });
  eq(info.kind, "here");
  eq(S.offscreenArrow(S.frameGeometry(rectAt(955.8, 1036.6, 134.2, 20)), S.visibleArea(WIN_SIZE, []), S.ARROW_SIZE).dir, "down");
});

print("RESULT " + JSON.stringify({ passed, failures }));
print("EXPORT " + JSON.stringify(exported));
