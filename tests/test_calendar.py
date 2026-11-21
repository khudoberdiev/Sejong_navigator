# AI-generated — to be rewritten by me
"""Academic-calendar answers (core/calendar.py, data/calendar.json, data/calendar_rules.json).

Lexical only (weight 0) unless noted: FakeEmbedder (conftest.py) is not a real model;
eval/run_eval.py measures the hybrid with the real one. Dates are fixed: today = 2026-11-21.
"""
import json

import pytest

import core
from core import calendar as cal
from core.data import load_menu_items
from eval.questions import CALENDAR_QUESTIONS, EVAL_TODAY
from scripts import build_menu_map as build

TODAY = "2026-11-21"


def first(question, today=TODAY, weight=0.0):
    a = cal.answer(question, today=today, weight=weight)
    return a and a["rows"][0]["id"]


@pytest.mark.parametrize("question, expected", [
    ("when does spring semester start", "cal.2026_1.classes_start"),
    ("spring semester start date", "cal.2026_1.classes_start"),   # menu search said 계절학기 개설희망신청
    ("bahorgi semestr qachon boshlanadi", "cal.2026_1.classes_start"),
    ("2학기 개강", "cal.2026_2.classes_start"),
    ("1학기 개강일", "cal.2026_1.classes_start"),
    ("수강신청 언제", "cal.2026_winter.course_reg_all"),            # the next registration
    ("course registration", "cal.2026_winter.course_reg_all"),     # no date word, but a strong match
    ("겨울학기 수강신청", "cal.2026_winter.course_reg_all"),
    ("add drop period", "cal.2026_winter.course_change_all"),
    ("when are grades released", "cal.2026_2.grades_view_final"),
    ("휴학 신청 기간", "cal.2026_2.leave_apply"),
])
def test_calendar_questions_find_the_right_row(question, expected):
    assert first(question) == expected


@pytest.mark.parametrize("question", ["grades", "where are my grades?", "baholarim qayerda?", "seat reservation",
                                      "when is the library open", "my weekly class schedule", "study room", "library"])
def test_other_questions_get_no_card(question):
    assert cal.answer(question, today=TODAY, weight=0.0) is None


def test_upcoming_first_past_only_when_nothing_is_upcoming():
    assert cal.answer("when does spring semester start", today="2026-01-10", weight=0.0)["rows"][0]["status"] == "upcoming"
    later = cal.answer("when does spring semester start", today=TODAY, weight=0.0)["rows"]
    assert [r["status"] for r in later] == ["past"]     # no 2027 start date in the data yet
    rows = cal.answer("course registration", today="2026-12-02", weight=0.0)["rows"]
    assert rows[0]["status"] == "current" and rows[0]["id"].startswith("cal.2026_winter.course_reg")
    assert all(r["status"] != "past" for r in rows)


def test_at_most_three_rows():
    assert len(cal.answer("course registration", today="2026-01-01", weight=0.0)["rows"]) == 3


def test_semester_words_filter_by_semester():
    for q, sem in [("1학기 수강신청 언제", "1학기"), ("fall semester course registration", "2학기"),
                   ("kuzgi semestr fanlarga yozilish qachon", "2학기"), ("summer course registration", "여름학기")]:
        rows = cal.answer(q, today="2026-01-01", weight=0.0)["rows"]
        assert rows and all(r["semester"].endswith("/" + sem) for r in rows), (q, rows)


@pytest.mark.parametrize("question", ["winter break", "when does winter break start", "qishki ta'til qachon", "겨울방학 언제"])
def test_winter_break_is_end_of_fall_and_start_of_spring(question):
    a = cal.answer(question, today="2026-11-21", weight=0.0)
    assert a["note"] == "calendar_break_note"
    assert [r["id"] for r in a["rows"]] == ["cal.2026_2.classes_end"]  # the next 1학기 개강 is not in the data
    early = cal.answer(question, today="2025-12-01", weight=0.0)
    assert {r["id"] for r in early["rows"]} == {"cal.2026_2.classes_end", "cal.2026_1.classes_start"}


def test_akademik_tatil_is_leave_not_a_break():
    a = cal.answer("akademik ta'til qachon", today=TODAY, weight=0.0)
    assert a["note"] is None and a["rows"][0]["related_hint"] == "leave of absence"


def test_final_exams_say_there_are_no_exam_dates():
    a = cal.answer("final exams", today=TODAY, weight=0.0)
    assert a["note"] == "calendar_no_finals" and a["rows"][0]["id"] == "cal.2026_2.classes_end"


@pytest.mark.parametrize("question", ["tuition", "tuition deadline", "how much to pay", "kontrakt to'lovi qachon", "등록금 고지서"])
def test_tuition_shows_bill_periods_and_where_the_amount_is(question):
    a = cal.answer(question, today=TODAY, weight=0.0)
    assert a["note"] == "calendar_tuition_note"
    assert all(r["related_hint"] in ("tuition bill", "tuition installment") for r in a["rows"])
    assert a["rows"][0]["id"] == "cal.2026_2.tuition_bill_inst4"  # 27 Nov – 4 Dec 2026
    assert {"label": "calendar_show_page", "item": "sjpt.registration_history_tuition_bill_print"} in a["buttons"]


def test_buttons_show_me_where_and_the_related_page():
    a = cal.answer("수강신청 언제", today=TODAY, weight=0.0)
    assert a["buttons"] == [{"label": "calendar_show_where", "item": "sjpt.academic_schedule_inquiry"},
                            {"label": "calendar_show_page", "item": "sjpt.course_registration"}]
    assert load_menu_items()["sjpt.academic_schedule_inquiry"].name_ko == "학사일정조회"
    only = cal.answer("when does spring semester start", today=TODAY, weight=0.0)
    assert only["buttons"] == [{"label": "calendar_show_where", "item": "sjpt.academic_schedule_inquiry"}]


def test_open_ended_rows():
    a = cal.answer("tuition receipt printing period", today=TODAY, weight=0.0)
    assert a["note"] is None  # its own row, not a bill period
    row = a["rows"][0]
    assert row["open_ended"] is True and row["end"] is None and row["status"] == "current"


def test_row_fields_and_bad_date():
    row = cal.answer("수강신청 언제", today=TODAY, weight=0.0)["rows"][0]
    assert set(row) == {"id", "semester", "title_ko", "title_en", "start", "end", "open_ended", "time", "status",
                        "related_hint", "merged_ids"}
    with pytest.raises(ValueError):
        cal.answer("tuition", today="21.11.2026")


def test_hybrid_runs_through_core():
    # the default weight (semantic on, FakeEmbedder here) gives the same first row for clear questions
    assert core.calendar_answer("수강신청 언제", TODAY)["rows"][0]["id"].startswith("cal.2026_winter.course_reg")
    assert core.calendar_answer("grades", TODAY) is None


def test_eval_calendar_questions_pass_lexically():
    assert EVAL_TODAY == TODAY
    for _lang, question, expected, _note in CALENDAR_QUESTIONS:
        assert first(question, EVAL_TODAY) == expected, question


def test_build_checks_calendar_rules():
    rules = json.loads(build.CALENDAR_RULES.read_text(encoding="utf-8"))
    rows = json.loads(build.CALENDAR.read_text(encoding="utf-8"))
    items = [{"id": i} for i in load_menu_items()]
    messages = json.loads(build.MESSAGES.read_text(encoding="utf-8"))
    assert build.check_calendar(rules, rows, items, messages) == []
    rules["calendar_item"] = "sjpt.nope"
    rules["hint_items"].pop("grades")
    problems = build.check_calendar(rules, rows, items, messages)
    assert any("sjpt.nope" in p for p in problems)
    assert any("related_hint 'grades'" in p for p in problems)


# --------------------------------------------------------------------- same dates, one row


@pytest.mark.parametrize("weight", [0.0, 0.5, 1.0])  # whatever the score prefers, the all-years row is shown
def test_course_registration_shows_the_all_years_row_not_visiting_students(weight):
    rows = cal.answer("course registration", today=TODAY, weight=weight)["rows"]
    assert rows[0]["id"] == "cal.2026_winter.course_reg_all"            # 전체학년, not 타교생
    assert rows[0]["merged_ids"] == ["cal.2026_winter.course_reg_visiting"]
    assert "cal.2026_winter.course_reg_visiting" not in [r["id"] for r in rows]


def test_same_dates_merge_into_the_general_row():
    rows = {r["id"]: r for r in cal.answer("add drop period", today="2026-01-01", weight=0.0)["rows"]}
    assert rows["cal.2026_1.course_change_all"]["merged_ids"] == ["cal.2026_1.course_change_visiting"]
    assert len({(r["start"], r["end"]) for r in rows.values()}) == len(rows)  # no duplicate dates on the card


def test_specific_groups_alone_are_not_merged():
    # 1학년 and 2학년 register on the same day; neither is "all years": both stay, nothing hidden
    rows = cal.answer("1학기 수강신청 언제", today="2026-01-01", weight=0.0)["rows"]
    ids = [r["id"] for r in rows]
    merged = [m for r in rows for m in r["merged_ids"]]
    assert "cal.2026_1.course_reg_y2" not in merged
    row = lambda title, start: cal.Row("x." + title, "2026/1학기", title, "", start, start, None, None, False, None, ())
    a, b = row("[학생]수강신청기간(1학년)", "2026-02-12"), row("[학생]수강신청기간(2학년)", "2026-02-12")
    general = row("[학생]수강신청기간(전체학년)", "2026-02-12")
    assert [len(m) for _, _, m in cal.merge_same_dates([(1.0, a), (1.0, b)])] == [0, 0]
    assert cal.merge_same_dates([(0.9, a), (1.0, general), (0.8, b)]) == [(1.0, general, ["x.[학생]수강신청기간(1학년)", "x.[학생]수강신청기간(2학년)"])]
