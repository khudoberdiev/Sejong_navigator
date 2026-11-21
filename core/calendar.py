# AI-generated — to be rewritten by me
"""Academic-calendar answers: "when does spring semester start", "수강신청 언제", "qishki ta'til qachon".

The rows (data/calendar.json, 150 rows from SJPT 학사일정) are LOOKED UP, never trained on:
their dates change every semester. The rules (date words, semester words, breaks, concepts,
which menu page belongs to a row) are in data/calendar_rules.json.

    answer("when does spring semester start", today="2026-11-21") -> card dict or None

1. Is it a calendar question? A date word ("when", "qachon", "언제", ...) OR a strong lexical
   match with a row's title or keywords. Breaks and concepts (finals, tuition) always are.
2. Which rows? The same hybrid score as menu search (core/navigator.py): w × semantic +
   (1 − w) × lexical, over title_ko, title_en and keywords. The query's date, semester and filler
   words are removed first (drop_words, semester words, filler), so "spring semester start date"
   is matched as "semester start".
   No row with a lexical score >= min_lexical: no card (semantic scores alone always pick
   something). Semester words ("spring", "1학기", "bahorgi", ...) keep only that semester.
   Breaks: no "break" rows exist, so "winter break" = 2학기 종강일 + 1학기 개강일.
   Concepts: "final exams" (no exam rows: the last day of classes + a note), "tuition" (the bill
   printing and installment periods + where the amount is).
   Rows with identical dates and the same title apart from the group in parentheses
   ("수강신청기간(전체학년)" / "(타교생)" / "(편입)") are ONE card row: the all-years / general
   version is shown (GENERAL_GROUPS, then no group, then the better score); the others are
   listed in its merged_ids. Specific groups alone (1학년 / 2학년, same day) are not merged.
3. Relative to today (the user's local date, sent by the extension): current and upcoming rows
   first (current, then by start date); past rows only if nothing is upcoming, newest first,
   marked "past". At most max_rows (3).
4. Buttons: the SJPT 학사일정 page (calendar_item), and the page the first row is about
   (hint_items[related_hint]) when there is one. Item ids only; the extension has the items.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Optional

from core import navigator
from index.text import normalize
from ml.vector_index import VectorIndex

DATA = Path(__file__).resolve().parent.parent / "data"
CALENDAR_PATH = DATA / "calendar.json"
RULES_PATH = DATA / "calendar_rules.json"
OPEN_ENDED = "9999"
FILLER = ("does", "do", "is", "are", "the", "a", "an", "of", "for", "to", "will", "what", "how", "my", "i",
          "can", "in", "on", "at")
_HANGUL = re.compile(r"[가-힣ㄱ-ㆎ]")
_GROUP = re.compile(r"\(([^()]*)\)")
GENERAL_GROUPS = ("전체학년", "전체")  # preferred over specific groups (타교생, 편입, 신입, 외국인, ...)


@dataclass(frozen=True)
class Row:
    id: str
    semester: str
    title_ko: str
    title_en: str
    start: str
    end: str
    time: Optional[str]
    category: Optional[str]
    important: bool
    related_hint: Optional[str]
    keywords: tuple[str, ...]

    def terms(self) -> list[str]:
        return [self.title_ko, self.title_en, *self.keywords]

    def passage(self) -> str:
        return " | ".join(self.terms())


@lru_cache(maxsize=1)
def load_rows() -> tuple[Row, ...]:
    raw = json.loads(CALENDAR_PATH.read_text(encoding="utf-8"))
    return tuple(sorted((Row(r["id"], r["semester"], r["title_ko"], r["title_en"], r["start"], r["end"], r.get("time"),
                             r.get("category"), bool(r.get("important")), r.get("related_hint"),
                             tuple(r.get("keywords") or ())) for r in raw), key=lambda r: r.id))


@lru_cache(maxsize=1)
def load_rules() -> dict:
    return json.loads(RULES_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def _row_terms() -> list[tuple[Row, list[str]]]:
    return [(row, [t for t in (normalize(x) for x in row.terms()) if t]) for row in load_rows()]


@lru_cache(maxsize=1)
def _vector_index() -> VectorIndex:
    index = VectorIndex(navigator.embedder(), cache_dir=navigator.cache_dir())
    rows = load_rows()
    index.build(rows, texts=[row.passage() for row in rows])
    return index


navigator._extra_caches.extend([load_rows, load_rules, _row_terms, _vector_index])


# ---------------------------------------------------------------- words in the question

def _has(q: str, word: str) -> bool:
    """Latin words as whole words, Korean as a substring (no spaces between Korean words)."""
    w = normalize(word)
    if not w:
        return False
    return w in q if _HANGUL.search(word) else f" {w} " in f" {q} "


def _remove(q: str, words) -> str:
    for word in sorted(words, key=len, reverse=True):
        w = normalize(word)
        if not w:
            continue
        q = q.replace(w, " ") if _HANGUL.search(word) else re.sub(rf"(?<!\S){re.escape(w)}(?!\S)", " ", q)
    return " ".join(q.split())


def semesters_in(q: str) -> list[str]:
    """Semester keys ("1학기", "2학기", "여름학기", "겨울학기") the normalized question names."""
    return [key for key, words in load_rules()["semester_words"].items() if any(_has(q, w) for w in words)]


def _break_kind(q: str, semesters: list[str]) -> Optional[list[str]]:
    """["winter"] / ["summer"] / both for a break question, else None."""
    rules = load_rules()["breaks"]
    if not any(_has(q, w) for w in rules["words"]) or any(_has(q, w) for w in rules["not_with"]):
        return None
    kinds = [k for k, key in (("winter", "겨울학기"), ("summer", "여름학기")) if key in semesters]
    return kinds or ["winter", "summer"]


def _concept(q: str) -> Optional[dict]:
    for concept in load_rules()["concepts"]:
        if any(_has(q, w) for w in concept["words"]):
            return concept
    return None


# ---------------------------------------------------------------- scoring

def _contained(core_q: str, term: str) -> float:
    """The question inside a longer title ("grade inquiry" in "Grade inquiry period (final &
    seasonal)"): len(question) / len(term), at word boundaries."""
    return len(core_q) / len(term) if len(core_q) >= 4 and f" {core_q} " in f" {term} " else 0.0


def _lexical(core_q: str) -> dict[str, float]:
    """navigator's term score (a title/keyword in the question), or the question in a title."""
    tokens = core_q.split()
    return {row.id: max((max(navigator._term_score(t, core_q, tokens), _contained(core_q, t)) for t in terms), default=0.0)
            for row, terms in _row_terms()}


def _semantic(question: str) -> dict[str, float]:
    raw = _vector_index().scores(question)
    if not raw:
        return {}
    low, high = min(raw.values()), max(raw.values())
    if high - low < 1e-9:
        return {k: 0.0 for k in raw}
    return {k: (v - low) / (high - low) for k, v in raw.items()}


def _in_semester(row: Row, semesters: list[str]) -> bool:
    return not semesters or any(row.semester.endswith("/" + s) for s in semesters)


def _status(row: Row, today: str) -> str:
    end = row.end if not row.end.startswith(OPEN_ENDED) else "9999-12-31"
    if row.start <= today <= end:
        return "current"
    return "upcoming" if row.start > today else "past"


def _base_title(row: Row) -> str:
    """The title without its groups in parentheses: "[학생]수강신청기간(타교생)" -> "[학생]수강신청기간"."""
    return " ".join(_GROUP.sub(" ", row.title_ko).split())


def _generality(row: Row) -> int:
    """0: an all-years / general group, 1: no group, 2: a specific group (타교생, 편입, ...)."""
    groups = [g.strip() for g in _GROUP.findall(row.title_ko)]
    if any(g in GENERAL_GROUPS for g in groups):
        return 0
    return 1 if not groups else 2


def merge_same_dates(scored: list[tuple[float, Row]]) -> list[tuple[float, Row, list[str]]]:
    """One entry per (semester, start, end, time, title without groups): the most general row
    (all years / no group), with the group's best score and the ids of the rows merged into it.
    Only specific groups with the same dates (1학년 and 2학년): nothing is merged, so the card
    never suggests a date is for 1st-years only."""
    groups: dict[tuple, list[tuple[float, Row]]] = {}
    for score, row in scored:
        groups.setdefault((row.semester, row.start, row.end, row.time, _base_title(row)), []).append((score, row))
    merged = []
    for members in groups.values():
        members.sort(key=lambda x: (_generality(x[1]), -x[0], x[1].id))
        if _generality(members[0][1]) == 2:  # only specific groups (1학년 + 2학년): keep each, say both
            merged.extend((score, row, []) for score, row in members)
            continue
        best_score = max(score for score, _ in members)
        merged.append((best_score, members[0][1], sorted(r.id for _, r in members[1:])))
    return merged


def _pick_by_date(rows: list[tuple[float, Row, list[str]]], today: str, limit: int) -> list[tuple[Row, str, list[str]]]:
    """Current first, then upcoming by start; only if none of those: past, newest first."""
    merged_ids = {row.id: ids for _, row, ids in rows}
    with_status = [(score, row, _status(row, today)) for score, row, _ in rows]
    live = [x for x in with_status if x[2] != "past"]
    if live:
        live.sort(key=lambda x: (x[2] != "current", x[1].start, -x[0], x[1].id))
        chosen = live
    else:
        chosen = sorted(with_status, key=lambda x: (x[1].end if not x[1].end.startswith(OPEN_ENDED) else x[1].start,
                                                    x[0]), reverse=True)
    return [(row, status, merged_ids[row.id]) for _, row, status in chosen[:limit]]


def _row_dict(row: Row, status: str, merged_ids: list[str]) -> dict:
    open_ended = row.end.startswith(OPEN_ENDED)
    return {"id": row.id, "semester": row.semester, "title_ko": row.title_ko, "title_en": row.title_en,
            "start": row.start, "end": None if open_ended else row.end, "open_ended": open_ended,
            "time": row.time, "status": status, "related_hint": row.related_hint, "merged_ids": merged_ids}


# ---------------------------------------------------------------- public

def answer(question: str, today: Optional[str] = None, weight: Optional[float] = None) -> Optional[dict]:
    """The calendar answer card for a question, or None (not a calendar question / no row).

    Args:
        question: Free text in Uzbek, English or Korean.
        today: The user's local date, "YYYY-MM-DD". Default: the server's date.
        weight: Semantic weight w (default: navigator.SEMANTIC_WEIGHT; 0 = lexical only).

    Returns:
        {"rows": [{id, semester, title_ko, title_en, start, end, open_ended, time, status,
                   related_hint, merged_ids}],  status: "current" | "upcoming" | "past";
                                              merged_ids: same-date group rows shown as this one
         "note": message key or None,         ("calendar_no_finals", "calendar_tuition_note", ...)
         "buttons": [{"label": message key, "item": menu item id}],
         "today": the date used}

    Raises:
        ValueError: if today is not a YYYY-MM-DD date.
    """
    rules = load_rules()
    today = today or date.today().isoformat()
    try:
        date.fromisoformat(today)
    except ValueError:
        raise ValueError("today must be a date like 2026-11-21") from None
    w = navigator.SEMANTIC_WEIGHT if weight is None else weight
    q = normalize(question or "")
    if not q:
        return None
    semesters = semesters_in(q)
    note = None
    extra_item = None

    all_semester_words = [x for words in rules["semester_words"].values() for x in words]
    core_q = _remove(q, list(rules["drop_words"]) + all_semester_words + list(FILLER)) or q
    # "semester" itself: part of "semester start", filler in "fall semester course registration"
    bare_q = _remove(core_q, rules["semester_filler"]) or core_q
    lexical = _lexical(core_q)
    if bare_q != core_q:
        lexical = {k: max(v, w) for (k, v), w in zip(lexical.items(), _lexical(bare_q).values())}
    candidates = [row for row in load_rows() if _in_semester(row, semesters)]
    best = max(candidates, key=lambda row: (lexical[row.id], row.id), default=None)
    best_lex = lexical[best.id] if best else 0.0

    breaks = _break_kind(q, semesters)
    concept = None if breaks else _concept(q)
    # A row named outright wins over a concept: "tuition receipt" is its own row, not a bill period.
    if concept and best_lex >= rules["concept_override"] and best.related_hint not in concept["hints"]:
        concept = None
    if breaks:
        b = rules["breaks"]
        wanted = [(b["end_hint"], b[k]["end_of"]) for k in breaks] + [(b["start_hint"], b[k]["start_of"]) for k in breaks]
        scored = [(1.0, row) for row in load_rows()
                  if any(row.related_hint == hint and row.semester.endswith("/" + sem) for hint, sem in wanted)]
        note = "calendar_break_note"
    elif concept:
        scored = [(1.0, row) for row in load_rows() if row.related_hint in concept["hints"] and _in_semester(row, semesters)]
        note = concept.get("note")
        extra_item = concept.get("item")
    else:
        is_question = any(_has(q, word) for word in rules["date_words"]) or best_lex >= rules["strong_lexical"]
        if not is_question or best_lex < rules["min_lexical"]:
            return None
        semantic = _semantic(question.strip()) if w > 0 else {}
        hybrid = {row.id: w * semantic.get(row.id, 0.0) + (1 - w) * lexical[row.id] for row in candidates}
        top = max(hybrid.values())
        scored = [(hybrid[row.id], row) for row in candidates
                  if lexical[row.id] > 0 and hybrid[row.id] >= rules["keep_within"] * top]
    if not scored:
        return None

    picked = _pick_by_date(merge_same_dates(scored), today, rules["max_rows"])
    buttons = [{"label": "calendar_show_where", "item": rules["calendar_item"]}]
    page = extra_item or next((rules["hint_items"].get(row.related_hint) for row, _, _ in picked
                               if rules["hint_items"].get(row.related_hint)), None)
    if page:
        buttons.append({"label": "calendar_show_page", "item": page})
    return {"rows": [_row_dict(row, status, ids) for row, status, ids in picked], "note": note, "buttons": buttons, "today": today}
