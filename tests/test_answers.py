# AI-generated — to be rewritten by me
"""Answer cards (data/answers.json, core/answers.py, extension/shared.js answerFor).

"seat reservation" has no menu item as its answer: reading-room seats are issued at the
library's kiosks. The card explains that and offers what can be booked online.
"""
import json
import subprocess

import pytest

from core import answers
from core.data import load_menu_items
from eval.questions import ANSWER_QUESTIONS
from scripts import build_menu_map as build
from tests.test_extension_js import EXT, JSC, MESSAGES, ROOT, needs_jsc

SEAT_QUESTIONS = ["seat reservation", "book a seat", "좌석 예약", "joy band qilish", "Seat Reservation?",
                  "how do I reserve a seat", "열람실 좌석예약", "o'rindiq band qilish", "o‘rindiq bron qilmoqchiman"]
NOT_SEAT = ["study room", "book a room", "seat status", "free seats", "xona band qilish", "S-Lounge booking",
            "seat assignment rules", "좌석 현황", "스터디룸 예약", "grades", "reserve a quiet place to study", "seat"]


@pytest.mark.parametrize("question", SEAT_QUESTIONS)
def test_seat_questions_get_the_kiosk_card(question):
    assert answers.answer_for(question)["id"] == "seat_booking"


@pytest.mark.parametrize("question", NOT_SEAT)
def test_other_questions_get_no_card(question):
    assert answers.answer_for(question) is None


def test_card_offers_free_seats_and_the_three_bookings():
    card = answers.answer_for("seat reservation")
    assert [a["item"] for a in card["actions"]] == [
        "library.seat_status_more", "library.studyroom_booking", "library.cinemaroom_booking", "library.slounge_booking"]
    messages = json.loads(MESSAGES.read_text(encoding="utf-8"))
    text = messages[card["message"]]["message"]
    assert "kiosk" in text and "can't be booked online" in text
    assert [messages[a["label"]]["message"] for a in card["actions"]] == [
        "See free seats", "Book a study room", "Cinema room", "S-Lounge"]


def test_booking_guides_end_with_the_capacity_hint():
    rules = answers.load_answers()
    messages = json.loads(MESSAGES.read_text(encoding="utf-8"))
    for item_id in ("library.studyroom_booking", "library.cinemaroom_booking", "library.slounge_booking"):
        assert messages[rules["done_hints"][item_id]]["message"] == (
            "Pick a room, then a time. Rooms must be booked for at least half their capacity.")


def test_eval_answer_questions_match():
    for _lang, question, expected, _note in ANSWER_QUESTIONS:
        got = answers.answer_for(question)
        assert (got and got["id"]) == expected, question


def test_build_checks_answers_against_items_and_messages():
    rules = json.loads((ROOT / "data" / "answers.json").read_text(encoding="utf-8"))
    items = [{"id": i} for i in load_menu_items()]
    messages = json.loads(MESSAGES.read_text(encoding="utf-8"))
    assert build.check_answers(rules, items, messages) == []
    broken = json.loads(json.dumps(rules))
    broken["answers"][0]["actions"][0]["item"] = "library.nope"
    broken["answers"][0]["message"] = "no_such_key"
    broken["done_hints"]["library.gone"] = "hint_room_booking"
    problems = build.check_answers(broken, items, messages)
    assert len(problems) == 3 and any("library.nope" in p for p in problems)


def test_extension_copy_is_in_sync():
    copy = EXT / "data" / "answers.json"
    source = json.loads((ROOT / "data" / "answers.json").read_text(encoding="utf-8"))
    assert copy.read_text(encoding="utf-8") == build.render_answers(source), "run scripts/build_menu_map.py"


@needs_jsc
def test_javascript_matcher_agrees_with_python(tmp_path):
    questions = SEAT_QUESTIONS + NOT_SEAT + [q for _, q, _, _ in ANSWER_QUESTIONS] + [
        "SEAT-reservation!!", "  좌석  예약  ", "joy", "band joy", "reserve   a   seat", "ʻorindiq band"]
    rules = (ROOT / "data" / "answers.json").read_text(encoding="utf-8")
    script = tmp_path / "answers.js"
    script.write_text((EXT / "shared.js").read_text(encoding="utf-8") + "\n"
                      + f"const RULES = {rules};\nconst QS = {json.dumps(questions, ensure_ascii=False)};\n"
                      + "print(JSON.stringify(QS.map((q) => { const a = SejongShared.answerFor(RULES, q); return a ? a.id : null; })));\n"
                      + "print(JSON.stringify(QS.map((q) => SejongShared.answerTokens(q))));\n",
                      encoding="utf-8")
    proc = subprocess.run([str(JSC), str(script)], capture_output=True, text=True, timeout=60)
    assert proc.returncode == 0, proc.stdout + proc.stderr
    js_ids, js_tokens = (json.loads(line) for line in proc.stdout.splitlines()[:2])
    assert js_tokens == [answers.tokens(q) for q in questions]
    py_ids = [(a and a["id"]) for a in map(answers.answer_for, questions)]
    assert js_ids == py_ids
