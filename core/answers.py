# AI-generated — to be rewritten by me
"""Answer cards: a short explanation shown above the search results (data/answers.json).

Some questions have no menu item as their answer. "seat reservation": reading-room seats are
issued at the library's kiosks and cannot be booked online, so the best search result alone
would mislead. The card says so and offers the items that do exist (free seats, room booking).

The extension matches questions itself (extension/shared.js answerFor, same rules, checked by
tests/test_answers.py); this module is the reference for the eval and the tests. The search
API is unchanged.
"""
from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Optional

ANSWERS_PATH = Path(__file__).resolve().parent.parent / "data" / "answers.json"
STOPWORDS = frozenset({"a", "an", "the", "my", "i", "to"})
_APOSTROPHES = re.compile(r"['ʻʼ‘’`]")
_NOT_WORD = re.compile(r"[\W_]+")
_HANGUL = re.compile(r"[가-힣ㄱ-ㆎ]")


def tokens(text: str) -> list[str]:
    """Lower-case words without apostrophes ("o'rindiq" -> "orindiq") and without STOPWORDS."""
    text = _NOT_WORD.sub(" ", _APOSTROPHES.sub("", str(text).lower()))
    return [w for w in text.split() if w not in STOPWORDS]


def trigger_matches(trigger: str, question: str) -> bool:
    """All the trigger's words are in the question; a Korean trigger may also appear with
    different spacing ("좌석 예약" in "열람실좌석예약")."""
    want = tokens(trigger)
    have = tokens(question)
    if want and set(want) <= set(have):
        return True
    return bool(want and _HANGUL.search(trigger) and "".join(want) in "".join(have))


@lru_cache(maxsize=1)
def load_answers(path: Path = ANSWERS_PATH) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def answer_for(question: str, rules: Optional[dict] = None) -> Optional[dict]:
    """The first answer card whose trigger matches the question, or None."""
    for answer in (rules or load_answers())["answers"]:
        if any(trigger_matches(t, question) for t in answer["triggers"]):
            return answer
    return None
