# AI-generated — to be rewritten by me
"""Fine-tune the embedding model on (question → menu item) pairs with a contrastive loss.

    # synthetic questions generated from names + keywords (today)
    .venv/bin/python -m ml.finetune
    # real questions later: one JSON object per line, {"query": "...", "item_id": "..."}
    .venv/bin/python -m ml.finetune --pairs data/real_pairs.jsonl
    # use the result in the app
    SEJONG_MODEL=models/e5-small-sejong .venv/bin/uvicorn api.main:app --port 8000

Pipeline:
  1. pairs     synthetic_pairs() (templates × terms) or load_pairs_jsonl()
  2. split     split_synthetic() / split_real(): the held-out test split shares NO
               phrasing with training (different terms AND different templates),
               checked by leakage_report(). Training questions that are near-copies
               of eval/questions.py are dropped, so the eval stays honest.
  3. train     PyTorch loop, InfoNCE contrastive loss: each question must score its
               own item's passage higher than every other item's passage.
  4. evaluate  baseline vs fine-tuned on the held-out split and on eval/questions.py;
               the table goes to eval/finetune_results.md (included in eval/results.md).
"""
from __future__ import annotations

import argparse
import json
import math
import random
import sys
import time
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Iterable

from index.edit_distance import similarity
from index.text import normalize
from ml.embedder import BASE_MODEL, passage_text, prefixes_for

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "models" / "e5-small-sejong"
RESULTS_FILE = ROOT / "eval" / "finetune_results.md"
NEAR_DUPLICATE = 0.85      # similarity() at or above this counts as the same phrasing
MAX_CANDIDATES = 256       # passages scored per training step (all items if fewer)

# ---------------------------------------------------------------- 1. pairs


@dataclass(frozen=True)
class Pair:
    query: str
    item_id: str
    lang: str                  # "uz" | "en" | "ko"
    term: str | None = None    # the name/keyword it was made from (synthetic only)
    template: str | None = None
    from_name: bool = False    # term is name_ko/name_en/name_en_site (never held out)


# "{t}" is filled with one name or keyword of the item. Latin-script terms get the
# English AND the Uzbek templates (students mix both), Hangul terms the Korean ones.
TEMPLATES = {
    "en": ["{t}", "where is {t}?", "where can I find {t}", "how do I open {t}", "show me {t}",
           "I want to see {t}", "{t} page", "go to {t}", "how to check {t}", "open {t} please"],
    "uz": ["{t} qayerda?", "{t} qayerda joylashgan", "{t}ni qanday topaman", "{t} sahifasi",
           "{t}ni ko'rmoqchiman", "{t} bo'limi qayerda", "{t}ni qayerdan ko'raman", "{t} kerak"],
    "ko": ["{t}", "{t} 어디서 봐요?", "{t} 어디 있어요", "{t} 확인", "{t} 메뉴", "{t} 보는 법",
           "{t} 페이지", "{t} 하려면 어떻게 해요", "{t} 어디서 해요", "{t} 바로가기"],
}


def _is_hangul(text: str) -> bool:
    return any("가" <= ch <= "힣" or "ㄱ" <= ch <= "ㆎ" for ch in text)


def _unambiguous_terms(items) -> dict[str, list[str]]:
    """{item_id: [terms]} with terms that point to exactly one item (others would teach noise)."""
    owners = defaultdict(set)
    for item in items:
        for term in item.search_terms():
            if term.strip():
                owners[normalize(term)].add(item.id)
    result = {}
    for item in items:
        seen, terms = set(), []
        for term in item.search_terms():
            key = normalize(term)
            if term.strip() and len(owners[key]) == 1 and key not in seen:
                seen.add(key)
                terms.append(term.strip())
        result[item.id] = terms
    return result


def synthetic_pairs(items) -> list[Pair]:
    """Every (term, template) combination for every item, in a fixed order."""
    names = {item.id: {name.strip() for name in item.names()} for item in items}
    pairs = []
    for item_id, terms in sorted(_unambiguous_terms(items).items()):
        for term in terms:
            langs = ["ko"] if _is_hangul(term) else ["en", "uz"]
            for lang in langs:
                for template in TEMPLATES[lang]:
                    pairs.append(Pair(template.format(t=term), item_id, lang, term, template,
                                      from_name=term in names[item_id]))
    return pairs


def load_pairs_jsonl(path: Path, known_ids: set[str]) -> list[Pair]:
    """Real questions: one {"query": ..., "item_id": ..., "lang": optional} per line."""
    pairs = []
    for number, line in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        row = json.loads(line)
        if row.get("item_id") not in known_ids:
            raise ValueError(f"{path}:{number}: unknown item_id {row.get('item_id')!r}")
        query = str(row["query"]).strip()
        lang = row.get("lang") or ("ko" if _is_hangul(query) else "en")
        pairs.append(Pair(query, row["item_id"], lang))
    return pairs


# ---------------------------------------------------------------- 2. split + leakage


def split_synthetic(pairs: list[Pair], test_fraction: float = 0.25, seed: int = 13):
    """Hold out whole terms (per item) AND whole templates (per language).

    train = pairs with a training term and a training template
    test  = pairs with a held-out term and a held-out template
    Mixed pairs are dropped, so no test question shares its term or its
    template with any training question. Item names always stay in training.
    """
    rng = random.Random(seed)
    held_templates = set()
    for lang, templates in TEMPLATES.items():
        candidates = [t for t in templates if t != "{t}"]
        rng.shuffle(candidates)
        held_templates |= {(lang, t) for t in candidates[:max(1, round(len(candidates) * test_fraction))]}

    keywords_by_item = defaultdict(list)
    for p in pairs:
        if not p.from_name and p.term not in keywords_by_item[p.item_id]:
            keywords_by_item[p.item_id].append(p.term)
    held_terms = set()
    for item_id, keywords in keywords_by_item.items():
        rng.shuffle(keywords)
        n = round(len(keywords) * test_fraction)
        held_terms |= {(item_id, t) for t in keywords[:n]}

    train, test = [], []
    for p in pairs:
        term_out = (p.item_id, p.term) in held_terms
        template_out = (p.lang, p.template) in held_templates
        if not term_out and not template_out:
            train.append(p)
        elif term_out and template_out:
            test.append(p)
    # Two items can share a term ("예약"): held out for one, trained for the other, the same
    # question text would be on both sides. Such a question is not held out: drop it from test.
    seen = {normalize(p.query) for p in train}
    return train, [p for p in test if normalize(p.query) not in seen]


def split_real(pairs: list[Pair], test_fraction: float = 0.2, seed: int = 13):
    """Real data: split groups of near-identical questions, never one group across both sides."""
    groups: list[list[Pair]] = []
    keys: list[str] = []
    for p in sorted(pairs, key=lambda p: normalize(p.query)):
        key = normalize(p.query)
        for i, other in enumerate(keys):
            if similarity(key, other) >= NEAR_DUPLICATE:
                groups[i].append(p)
                break
        else:
            keys.append(key)
            groups.append([p])
    rng = random.Random(seed)
    rng.shuffle(groups)
    n_test = max(1, round(len(groups) * test_fraction)) if len(groups) > 1 else 0
    test = [p for g in groups[:n_test] for p in g]
    train = [p for g in groups[n_test:] for p in g]
    return train, test


def drop_near_duplicates(train: list[Pair], protected: Iterable[str]) -> tuple[list[Pair], list[Pair]]:
    """Remove training questions that are (near-)copies of a protected question (eval set)."""
    protected = [normalize(q) for q in protected]
    kept, dropped = [], []
    for p in train:
        key = normalize(p.query)
        if any(key == q or similarity(key, q) >= NEAR_DUPLICATE for q in protected):
            dropped.append(p)
        else:
            kept.append(p)
    return kept, dropped


def leakage_report(train: list[Pair], test: list[Pair], protected: Iterable[str] = ()) -> dict:
    """Counts that must be 0 for an honest evaluation (see tests/test_finetune.py)."""
    train_queries = {normalize(p.query) for p in train}
    protected = [normalize(q) for q in protected]
    train_terms = {(p.item_id, p.term) for p in train if p.term}
    train_templates = {(p.lang, p.template) for p in train if p.template}
    return {
        "shared_queries": sum(normalize(p.query) in train_queries for p in test),
        "shared_terms": sum((p.item_id, p.term) in train_terms for p in test if p.term),
        "shared_templates": sum((p.lang, p.template) in train_templates for p in test if p.template),
        "near_duplicates_of_protected": sum(
            any(similarity(normalize(p.query), q) >= NEAR_DUPLICATE for q in protected) for p in train),
    }


# ---------------------------------------------------------------- 3. training


class SentenceTransformerEncoder:
    """Adapter that makes a sentence-transformers model trainable with plain PyTorch.

    ``embed(texts, kind)`` returns L2-normalised embeddings WITH gradients.
    Any object with embed / parameters / train / eval works with train()
    (tests use a tiny fake one).
    """

    def __init__(self, model_name: str, device: str = "cpu", max_seq_length: int = 128) -> None:
        from sentence_transformers import SentenceTransformer  # heavy import, kept local

        self.model_name = model_name
        self.device = device
        self.model = SentenceTransformer(model_name, device=device)
        self.model.max_seq_length = max_seq_length
        self.prefixes = prefixes_for(model_name)

    def embed(self, texts, kind):
        import torch.nn.functional as F

        texts = [self.prefixes[kind] + t for t in texts]
        # sentence-transformers >= 6 renamed tokenize() to preprocess(); its output also
        # carries non-tensor entries (e.g. "modality": "text"), which stay as they are.
        prepare = getattr(self.model, "preprocess", None) or self.model.tokenize
        features = {k: v.to(self.device) if hasattr(v, "to") else v for k, v in prepare(texts).items()}
        return F.normalize(self.model(features)["sentence_embedding"], dim=-1)

    def parameters(self):
        return self.model.parameters()

    def train(self):
        self.model.train()

    def eval(self):
        self.model.eval()

    def save(self, path: Path) -> None:
        self.model.save(str(path))


def contrastive_loss(query_vectors, passage_vectors, targets, temperature: float):
    """InfoNCE: cross-entropy over cosine similarities / temperature.

    Row i of the logits holds question i against every candidate passage; the
    target is the index of its own item. Every other item is a negative, and
    because each item appears once among the candidates there are no false
    negatives (unlike plain in-batch negatives, where two questions about the
    same item would push each other away).
    """
    import torch.nn.functional as F

    logits = query_vectors @ passage_vectors.T / temperature
    return F.cross_entropy(logits, targets)


def train(encoder, pairs: list[Pair], passages: dict[str, str], epochs: int = 3,
          batch_size: int = 32, lr: float = 2e-5, temperature: float = 0.05, seed: int = 13,
          log: Callable[[str], None] = print) -> list[float]:
    """Train in place. Returns the mean loss of every epoch."""
    import torch

    torch.manual_seed(seed)
    rng = random.Random(seed)
    item_ids = sorted(passages)
    params = [p for p in encoder.parameters() if p.requires_grad]
    optimizer = torch.optim.AdamW(params, lr=lr, weight_decay=0.01)
    total_steps = max(1, epochs * math.ceil(len(pairs) / batch_size))
    warmup = max(1, total_steps // 10)
    scheduler = torch.optim.lr_scheduler.LambdaLR(
        optimizer, lambda step: min((step + 1) / warmup, max(0.0, (total_steps - step) / (total_steps - warmup + 1))))

    history = []
    encoder.train()
    for epoch in range(epochs):
        order = pairs[:]
        rng.shuffle(order)
        losses = []
        started = time.time()
        for start in range(0, len(order), batch_size):
            batch = order[start:start + batch_size]
            if len(item_ids) <= MAX_CANDIDATES:
                candidates = item_ids
            else:  # many items: the batch's own items + random negatives
                own = sorted({p.item_id for p in batch})
                others = [i for i in item_ids if i not in set(own)]
                candidates = own + rng.sample(others, MAX_CANDIDATES - len(own))
            position = {item_id: i for i, item_id in enumerate(candidates)}
            q = encoder.embed([p.query for p in batch], "query")
            d = encoder.embed([passages[i] for i in candidates], "passage")
            targets = torch.tensor([position[p.item_id] for p in batch], device=q.device)
            loss = contrastive_loss(q, d, targets, temperature)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(params, 1.0)
            optimizer.step()
            scheduler.step()
            losses.append(loss.item())
        history.append(sum(losses) / len(losses))
        log(f"epoch {epoch + 1}/{epochs}: loss {history[-1]:.4f} ({time.time() - started:.0f}s)")
    encoder.eval()
    return history


# ---------------------------------------------------------------- 4. evaluation


def retrieval_accuracy(encode: Callable, pairs: list[Pair], passages: dict[str, str]) -> dict:
    """Semantic-only top-1 / top-3 per language. encode(texts, kind) -> numpy array of unit vectors."""
    item_ids = sorted(passages)
    doc = encode([passages[i] for i in item_ids], "passage")
    stats = defaultdict(lambda: [0, 0, 0])
    for lang in sorted({p.lang for p in pairs}):
        subset = [p for p in pairs if p.lang == lang]
        sims = encode([p.query for p in subset], "query") @ doc.T
        for p, row in zip(subset, sims):
            ranked = [item_ids[j] for j in row.argsort()[::-1][:3]]
            stats[lang][0] += ranked[0] == p.item_id
            stats[lang][1] += p.item_id in ranked
            stats[lang][2] += 1
    total = [sum(s[i] for s in stats.values()) for i in range(3)]
    return {**{lang: tuple(s) for lang, s in stats.items()}, "all": tuple(total)}


def _pct(hits: int, n: int) -> str:
    return f"{hits}/{n} ({100 * hits / n:.0f}%)" if n else "-"


def evaluate_models(models: dict[str, str], test: list[Pair], passages: dict[str, str],
                    weight: float) -> dict:
    """{label: {"heldout": ..., "semantic": ..., "hybrid": ...}} for each model name/path."""
    from core import navigator
    from eval.run_eval import evaluate
    from ml.embedder import Embedder

    results = {}
    for label, model in models.items():
        embedder = Embedder(model)
        navigator.use_embedder(embedder, cache_dir=navigator.DEFAULT_CACHE_DIR)
        heldout = retrieval_accuracy(embedder.encode, test, passages)
        semantic, _ = evaluate(1.0)
        hybrid, _ = evaluate(weight)
        results[label] = {"heldout": heldout, "semantic": semantic, "hybrid": hybrid}
    navigator.use_embedder(None)
    return results


def results_markdown(results: dict, info: dict, weight: float) -> str:
    lines = [
        "## Fine-tuning",
        "",
        f"Base `{info['base_model']}` → `{info['out']}`; {info['data']}; "
        f"{info['train_pairs']} training / {info['test_pairs']} held-out pairs; "
        f"{info['epochs']} epochs, lr {info['lr']}, temperature {info['temperature']}, "
        f"{info['train_seconds']:.0f}s on {info['device']}. "
        f"Dropped {info['dropped_near_eval']} training questions that were near-copies of eval/questions.py.",
        "",
        f"Leakage check (all must be 0): {info['leakage']}",
        "",
        "| Model | held-out top-1 | held-out top-3 | eval-30 semantic top-1 | eval-30 semantic top-3 "
        f"| eval-30 hybrid (w={weight}) top-1 | eval-30 hybrid top-3 |",
        "|---|---|---|---|---|---|---|",
    ]
    for label, r in results.items():
        h = r["heldout"]["all"]
        s = [sum(v[i] for v in r["semantic"].values()) for i in range(3)]
        y = [sum(v[i] for v in r["hybrid"].values()) for i in range(3)]
        lines.append(f"| {label} | {_pct(h[0], h[2])} | {_pct(h[1], h[2])} | {_pct(s[0], s[2])} "
                     f"| {_pct(s[1], s[2])} | {_pct(y[0], y[2])} | {_pct(y[1], y[2])} |")
    lines += ["", "Per language, top-1 (held-out · eval-30 semantic · eval-30 hybrid):", "",
              "| Model | uz | en | ko |", "|---|---|---|---|"]
    for label, r in results.items():
        cells = []
        for lang in ("uz", "en", "ko"):
            h = r["heldout"].get(lang, (0, 0, 0))
            s, y = r["semantic"][lang], r["hybrid"][lang]
            cells.append(f"{_pct(h[0], h[2])} · {_pct(s[0], s[2])} · {_pct(y[0], y[2])}")
        lines.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- CLI


def main(argv=None) -> None:
    from core.data import load_menu_items
    from core.navigator import SEMANTIC_WEIGHT
    from eval.questions import QUESTIONS

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-model", default=BASE_MODEL)
    parser.add_argument("--pairs", type=Path, help="real pairs (JSONL); default: synthetic from the menu map")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=2e-5)
    parser.add_argument("--temperature", type=float, default=0.05)
    parser.add_argument("--test-fraction", type=float, default=0.25)
    parser.add_argument("--device", default="cpu", help="cpu (default) or mps")
    parser.add_argument("--seed", type=int, default=13)
    parser.add_argument("--no-eval", action="store_true")
    args = parser.parse_args(argv)
    log = lambda msg: print(msg, file=sys.stderr)  # noqa: E731

    items = sorted(load_menu_items().values(), key=lambda i: i.id)
    passages = {item.id: passage_text(item) for item in items}
    if args.pairs:
        train_pairs, test_pairs = split_real(load_pairs_jsonl(args.pairs, set(passages)), args.test_fraction, args.seed)
        data = f"real pairs from `{args.pairs}`"
    else:
        train_pairs, test_pairs = split_synthetic(synthetic_pairs(items), args.test_fraction, args.seed)
        data = "synthetic pairs (templates × names/keywords)"
    eval_questions = [question for _, question, _, _ in QUESTIONS]
    train_pairs, dropped = drop_near_duplicates(train_pairs, eval_questions)
    leakage = leakage_report(train_pairs, test_pairs, eval_questions)
    log(f"{len(train_pairs)} train / {len(test_pairs)} held-out pairs; dropped {len(dropped)} near eval; leakage {leakage}")
    if any(leakage.values()):
        raise SystemExit(f"leakage detected, refusing to train: {leakage}")

    encoder = SentenceTransformerEncoder(args.base_model, device=args.device)
    started = time.time()
    history = train(encoder, train_pairs, passages, args.epochs, args.batch_size, args.lr,
                    args.temperature, args.seed, log)
    seconds = time.time() - started
    args.out.mkdir(parents=True, exist_ok=True)
    encoder.save(args.out)
    info = {
        "base_model": args.base_model, "out": str(args.out.relative_to(ROOT) if args.out.is_relative_to(ROOT) else args.out),
        "data": data, "train_pairs": len(train_pairs), "test_pairs": len(test_pairs),
        "dropped_near_eval": len(dropped), "leakage": leakage, "epochs": args.epochs, "lr": args.lr,
        "temperature": args.temperature, "device": args.device, "train_seconds": seconds,
        "loss_per_epoch": history, "seed": args.seed,
    }
    (args.out / "sejong_finetune.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
    (args.out / "heldout_pairs.jsonl").write_text(
        "".join(json.dumps(asdict(p), ensure_ascii=False) + "\n" for p in test_pairs), encoding="utf-8")
    log(f"saved to {args.out}")

    if not args.no_eval:
        results = evaluate_models({"baseline": args.base_model, "fine-tuned": str(args.out)},
                                  test_pairs, passages, SEMANTIC_WEIGHT)
        markdown = results_markdown(results, info, SEMANTIC_WEIGHT)
        from eval.run_eval import FINGERPRINT_PREFIX, data_fingerprint  # which data these numbers are for
        RESULTS_FILE.write_text("<!-- AI-generated — to be rewritten by me -->\n"
                                f"{FINGERPRINT_PREFIX}{data_fingerprint()} -->\n" + markdown, encoding="utf-8")
        print(markdown)
        log(f"wrote {RESULTS_FILE} (re-run eval/run_eval.py to refresh eval/results.md)")


if __name__ == "__main__":
    main()
