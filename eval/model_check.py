# AI-generated — to be rewritten by me
"""Quick sanity check for an embedding model before it is used for search.

Embeds 5 Uzbek, 5 English and 5 Korean phrasings of "where are my grades?",
then prints the cosine similarity to the correct item (sjpt.current_semester_grades)
next to the closest WRONG item. margin = correct - best_wrong (> 0 is good).

    .venv/bin/python -m eval.model_check intfloat/multilingual-e5-small [other/model ...]
"""
from __future__ import annotations

import sys

from core.data import load_menu_items
from ml.embedder import Embedder, passage_text

TARGET = "sjpt.current_semester_grades"
PHRASINGS = {
    "uz": ["baholarim qayerda?", "joriy semestr baholarimni qanday ko'raman?",
           "imtihon natijalarim", "bu semestrdagi baholarni ko'rish", "GPA ni qayerdan bilsam bo'ladi"],
    "en": ["where are my grades?", "how do I check my grades this semester",
           "show my exam results", "what did I get in my courses", "check my GPA"],
    "ko": ["성적 어디서 봐요?", "이번 학기 성적 확인", "시험 결과 보기", "내 학점 조회", "성적 조회는 어디서 하나요"],
}


def check(model_name: str) -> float:
    """Print the per-phrase table for one model and return its mean margin."""
    items = sorted(load_menu_items().values(), key=lambda i: i.id)
    embedder = Embedder(model_name)
    item_vecs = embedder.encode([passage_text(i) for i in items], kind="passage")
    ids = [i.id for i in items]
    target = ids.index(TARGET)

    print(f"\n=== {model_name} ===")
    margins = []
    for lang, queries in PHRASINGS.items():
        sims = embedder.encode(queries, kind="query") @ item_vecs.T
        for query, row in zip(queries, sims):
            wrong = max((j for j in range(len(ids)) if j != target), key=lambda j: row[j])
            margin = row[target] - row[wrong]
            margins.append(margin)
            flag = "ok  " if margin > 0 else "FAIL"
            print(f"{flag} {lang} {row[target]:.3f} vs {row[wrong]:.3f} ({ids[wrong]:<36}) {query}")
    mean = sum(margins) / len(margins)
    wins = sum(m > 0 for m in margins)
    print(f"correct item ranked first: {wins}/{len(margins)}, mean margin {mean:+.3f}")
    return mean


if __name__ == "__main__":
    for name in sys.argv[1:] or ["intfloat/multilingual-e5-small"]:
        check(name)
