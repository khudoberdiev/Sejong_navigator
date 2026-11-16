# AI-generated — to be rewritten by me
from index.text import decompose_hangul, normalize


def test_decompose_simple_syllables():
    assert decompose_hangul("장학금") == "ㅈㅏㅇㅎㅏㄱㄱㅡㅁ"


def test_decompose_splits_compound_vowels_and_tails():
    assert decompose_hangul("화") == "ㅎㅗㅏ"
    assert decompose_hangul("읽") == "ㅇㅣㄹㄱ"


def test_decompose_keeps_non_hangul_and_loose_jamo():
    assert decompose_hangul("abc ㅈ1") == "abc ㅈ1"


def test_normalize_case_punctuation_spaces():
    assert normalize("  Where are   my GRADES?! ") == "where are my grades"
    assert normalize("e-Campus") == "e campus"


def test_normalize_uzbek_apostrophes():
    assert normalize("oʻquv") == normalize("o’quv") == "o'quv"


def test_normalize_empty():
    assert normalize("") == ""
    assert normalize("?!  ") == ""
