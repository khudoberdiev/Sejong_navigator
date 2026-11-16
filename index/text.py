# AI-generated — to be rewritten by me
"""Text normalisation shared by the trie and lexical search.

normalize() runs these steps, in order:
  1. Unicode NFC + casefold                 "Grades" -> "grades"
  2. Unify Uzbek apostrophes (ʻ ’ ‘ ` ʼ -> ')  "oʻquv" -> "o'quv"
  3. Replace punctuation with spaces, collapse spaces, strip   "e-Campus!" -> "e campus"
  4. Split Hangul syllables into jamo         "장학" -> "ㅈㅏㅇㅎㅏㄱ"

Step 4 is what lets a half-typed Korean word match: while typing 장학금 on a
Korean keyboard the input box shows "ㅈ", "자", "장", "장ㅎ", "장하", ... and each
of these, once decomposed, is a prefix of the decomposed "장학금".
"""
from __future__ import annotations

import re
import unicodedata

# Compatibility jamo (the characters a keyboard produces), in Unicode order.
_LEADS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"                    # 19 initial consonants
_VOWELS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"            # 21 vowels
_TAILS = ["", *"ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"]  # 27 final consonants + "none"

# Compound jamo are typed as two keys, e.g. ㅘ = ㅗ then ㅏ. Splitting them makes
# "호" (ㅎㅗ) a prefix of "화" (ㅎㅗㅏ), just like on the keyboard.
_COMPOUND = {
    "ㅘ": "ㅗㅏ", "ㅙ": "ㅗㅐ", "ㅚ": "ㅗㅣ", "ㅝ": "ㅜㅓ", "ㅞ": "ㅜㅔ", "ㅟ": "ㅜㅣ", "ㅢ": "ㅡㅣ",
    "ㄳ": "ㄱㅅ", "ㄵ": "ㄴㅈ", "ㄶ": "ㄴㅎ", "ㄺ": "ㄹㄱ", "ㄻ": "ㄹㅁ", "ㄼ": "ㄹㅂ",
    "ㄽ": "ㄹㅅ", "ㄾ": "ㄹㅌ", "ㄿ": "ㄹㅍ", "ㅀ": "ㄹㅎ", "ㅄ": "ㅂㅅ",
}

_SYLLABLE_FIRST, _SYLLABLE_LAST = 0xAC00, 0xD7A3  # 가 .. 힣
_APOSTROPHES = str.maketrans({c: "'" for c in "ʻ’‘`ʼ"})
_NON_WORD = re.compile(r"[^\w']+")  # \w already includes Hangul and jamo


def decompose_hangul(text: str) -> str:
    """Replace every Hangul syllable with its jamo and split compound jamo.

    A syllable's code is 0xAC00 + (lead * 21 + vowel) * 28 + tail, so plain
    integer division recovers the three parts. Other characters are kept as they are.

        decompose_hangul("장학금") == "ㅈㅏㅇㅎㅏㄱㄱㅡㅁ"
        decompose_hangul("화") == "ㅎㅗㅏ"
    """
    out = []
    for ch in text:
        code = ord(ch)
        if _SYLLABLE_FIRST <= code <= _SYLLABLE_LAST:
            index = code - _SYLLABLE_FIRST
            lead, rest = divmod(index, 21 * 28)
            vowel, tail = divmod(rest, 28)
            parts = _LEADS[lead] + _VOWELS[vowel] + _TAILS[tail]
        else:
            parts = ch
        out.append("".join(_COMPOUND.get(p, p) for p in parts))
    return "".join(out)


def normalize(text: str) -> str:
    """Return the canonical form used for every comparison (see the module docstring)."""
    text = unicodedata.normalize("NFC", text).casefold().translate(_APOSTROPHES)
    text = _NON_WORD.sub(" ", text).strip()
    return decompose_hangul(text)
