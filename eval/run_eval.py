# AI-generated — to be rewritten by me
"""Top-1 / top-3 accuracy per language for lexical, semantic and hybrid search.

    .venv/bin/python -m eval.run_eval          # writes eval/results.md

Uses the real model (the first run downloads it; later runs use the vector cache).
"""
from __future__ import annotations

from pathlib import Path

from core import navigator
from eval.questions import QUESTIONS
from ml.embedder import DEFAULT_MODEL

LANGS = ("uz", "en", "ko")
SETUPS = {"lexical only (w=0)": 0.0, "semantic only (w=1)": 1.0,
          f"hybrid (w={navigator.SEMANTIC_WEIGHT})": navigator.SEMANTIC_WEIGHT}
SWEEP = (0.0, 0.3, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0)
RESULTS = Path(__file__).resolve().parent / "results.md"


def evaluate(weight: float) -> tuple[dict, list]:
    """Return ({lang: (top1_hits, top3_hits, total)}, [failure rows for top-1])."""
    stats = {lang: [0, 0, 0] for lang in LANGS}
    failures = []
    for lang, question, expected, note in QUESTIONS:
        ids = [r["id"] for r in navigator.search_with_weight(question, 3, weight)]
        stats[lang][0] += ids[:1] == [expected]
        stats[lang][1] += expected in ids
        stats[lang][2] += 1
        if ids[:1] != [expected]:
            failures.append((lang, question, expected, ids, note))
    return stats, failures


def _pct(hits: int, total: int) -> str:
    return f"{hits}/{total} ({100 * hits / total:.0f}%)"


def main() -> None:
    lines = [
        "<!-- AI-generated — to be rewritten by me -->",
        "# Search evaluation",
        "",
        f"Model: `{DEFAULT_MODEL}`, {len(QUESTIONS)} questions (eval/questions.py). "
        "Regenerate with `.venv/bin/python -m eval.run_eval`.",
        "",
        "| Setup | " + " | ".join(f"{l} top-1 | {l} top-3" for l in LANGS) + " | all top-1 | all top-3 |",
        "|---" * (2 * len(LANGS) + 3) + "|",
    ]
    hybrid_failures = []
    for name, weight in SETUPS.items():
        stats, failures = evaluate(weight)
        cells = []
        for lang in LANGS:
            t1, t3, n = stats[lang]
            cells += [_pct(t1, n), _pct(t3, n)]
        t1 = sum(s[0] for s in stats.values())
        t3 = sum(s[1] for s in stats.values())
        n = sum(s[2] for s in stats.values())
        lines.append(f"| {name} | " + " | ".join(cells) + f" | {_pct(t1, n)} | {_pct(t3, n)} |")
        if weight == navigator.SEMANTIC_WEIGHT:
            hybrid_failures = failures

    lines += ["", "## Weight sweep (all languages)", "", "| w | top-1 | top-3 |", "|---|---|---|"]
    for weight in SWEEP:
        stats, _ = evaluate(weight)
        n = sum(s[2] for s in stats.values())
        lines.append(f"| {weight} | {_pct(sum(s[0] for s in stats.values()), n)} "
                     f"| {_pct(sum(s[1] for s in stats.values()), n)} |")

    lines += ["", f"## Hybrid top-1 failures (w={navigator.SEMANTIC_WEIGHT})", "",
              "| lang | question | expected | got (top 3) | note |", "|---|---|---|---|---|"]
    for lang, question, expected, ids, note in hybrid_failures:
        lines.append(f"| {lang} | {question} | `{expected}` | {', '.join(f'`{i}`' for i in ids)} | {note} |")
    if not hybrid_failures:
        lines.append("| | (none) | | | |")

    RESULTS.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
