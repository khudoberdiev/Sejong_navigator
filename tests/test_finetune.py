# AI-generated — to be rewritten by me
"""ml/finetune.py without the real model: a tiny PyTorch encoder stands in for e5."""
import json
import zlib

import pytest
import torch
import torch.nn.functional as F

from core.data import load_menu_items
from core.models import MenuItem
from eval.questions import QUESTIONS
from index.text import normalize
from ml import finetune as ft

EVAL_QUESTIONS = [q for _, q, _, _ in QUESTIONS]


@pytest.fixture(scope="module")
def items():
    return sorted(load_menu_items().values(), key=lambda i: i.id)


@pytest.fixture(scope="module")
def split(items):
    return ft.split_synthetic(ft.synthetic_pairs(items))


class TinyEncoder:
    """Hashed character trigrams -> EmbeddingBag -> unit vector. Trainable, ~16k parameters."""

    def __init__(self, buckets=512, dim=32):
        torch.manual_seed(0)
        self.buckets = buckets
        self.bag = torch.nn.EmbeddingBag(buckets, dim, mode="mean")

    def _ids(self, text):
        s = f"  {normalize(text)} "
        return [zlib.crc32(s[i:i + 3].encode()) % self.buckets for i in range(len(s) - 2)] or [0]

    def embed(self, texts, kind):
        ids = [self._ids(t) for t in texts]
        offsets = torch.tensor([0] + [len(x) for x in ids[:-1]]).cumsum(0)
        flat = torch.tensor([i for x in ids for i in x])
        return F.normalize(self.bag(flat, offsets), dim=-1)

    def encode_numpy(self, texts, kind):
        with torch.no_grad():
            return self.embed(texts, kind).numpy()

    def parameters(self):
        return self.bag.parameters()

    def train(self):
        self.bag.train()

    def eval(self):
        self.bag.eval()


# ---------------------------------------------------------------- pairs


def test_synthetic_pairs_cover_every_item_and_language(items):
    pairs = ft.synthetic_pairs(items)
    # Items whose every name and keyword is shared with another item (e.g. the portal's
    # shortcut tab next to the same link in the main menu) get no pairs: they would teach noise.
    with_unique_terms = {item_id for item_id, terms in ft._unambiguous_terms(items).items() if terms}
    assert {p.item_id for p in pairs} == with_unique_terms
    assert len(with_unique_terms) >= 0.9 * len(items)
    assert {p.lang for p in pairs} == {"uz", "en", "ko"}
    assert all(p.term in p.query for p in pairs)


def test_hangul_terms_get_korean_templates_only(items):
    for p in ft.synthetic_pairs(items):
        assert (p.lang == "ko") == ft._is_hangul(p.term)


def test_ambiguous_terms_are_skipped():
    a = MenuItem("x.a", "portal", "가", "Alpha", None, "u", "", ("shared", "only a"))
    b = MenuItem("x.b", "portal", "나", "Beta", "x.a", "u", "", ("shared",))
    terms = {p.term for p in ft.synthetic_pairs([a, b])}
    assert "shared" not in terms and "only a" in terms


# ---------------------------------------------------------------- split and leakage


def test_split_has_no_leakage(split):
    train, test = split
    assert train and test
    report = ft.leakage_report(train, test)
    assert report == {"shared_queries": 0, "shared_terms": 0, "shared_templates": 0,
                      "near_duplicates_of_protected": 0}


def test_names_always_stay_in_training(items, split):
    train, test = split
    assert not any(p.from_name for p in test)
    unique = ft._unambiguous_terms(items)
    with_unique_name = {i.id for i in items if set(i.names()) & set(unique[i.id])}
    assert {p.item_id for p in train if p.from_name} == with_unique_name


def test_split_is_deterministic(items):
    pairs = ft.synthetic_pairs(items)
    assert ft.split_synthetic(pairs, seed=1) == ft.split_synthetic(pairs, seed=1)
    assert ft.split_synthetic(pairs, seed=1) != ft.split_synthetic(pairs, seed=2)


def test_eval_questions_are_protected(split):
    train, _ = split
    kept, dropped = ft.drop_near_duplicates(train, EVAL_QUESTIONS)
    assert "baholarim qayerda?" in {p.query for p in dropped}  # it is also a template × keyword
    assert ft.leakage_report(kept, [], EVAL_QUESTIONS)["near_duplicates_of_protected"] == 0


def test_leakage_report_catches_a_shared_query():
    p = ft.Pair("where is grades?", "sjpt.grade_current", "en", "grades", "where is {t}?")
    report = ft.leakage_report([p], [p])
    assert report["shared_queries"] == 1 and report["shared_terms"] == 1 and report["shared_templates"] == 1


def test_split_real_keeps_near_duplicates_together():
    pairs = [ft.Pair(q, "a", "en") for q in ["where are my grades", "where are my grades?",
                                             "Where are my grades!", "library loans", "timetable", "tuition bill"]]
    train, test = ft.split_real(pairs, test_fraction=0.5, seed=3)
    grade_variants = {p.query for p in pairs[:3]}
    assert grade_variants <= {p.query for p in train} or grade_variants <= {p.query for p in test}
    assert ft.leakage_report(train, test)["shared_queries"] == 0


def test_load_pairs_jsonl(tmp_path):
    path = tmp_path / "pairs.jsonl"
    path.write_text('{"query": "baholarim", "item_id": "sjpt.grade_current", "lang": "uz"}\n\n'
                    '{"query": "성적", "item_id": "sjpt.grade_current"}\n', encoding="utf-8")
    pairs = ft.load_pairs_jsonl(path, {"sjpt.grade_current"})
    assert [(p.query, p.lang) for p in pairs] == [("baholarim", "uz"), ("성적", "ko")]
    path.write_text('{"query": "x", "item_id": "nope"}\n', encoding="utf-8")
    with pytest.raises(ValueError, match="unknown item_id"):
        ft.load_pairs_jsonl(path, {"sjpt.grade_current"})


# ---------------------------------------------------------------- loss and training


def test_contrastive_loss_prefers_aligned_vectors():
    v = F.normalize(torch.eye(4), dim=-1)
    targets = torch.arange(4)
    aligned = ft.contrastive_loss(v, v, targets, 0.05)
    shuffled = ft.contrastive_loss(v, v.roll(1, dims=0), targets, 0.05)
    assert aligned < 0.01 < shuffled


def test_training_lowers_loss_and_improves_heldout_accuracy(items, split):
    train_pairs, test_pairs = split
    passages = {i.id: ft.passage_text(i) for i in items}
    encoder = TinyEncoder()
    before = ft.retrieval_accuracy(encoder.encode_numpy, test_pairs, passages)["all"]
    history = ft.train(encoder, train_pairs, passages, epochs=4, batch_size=64, lr=0.05,
                       temperature=0.1, log=lambda _: None)
    after = ft.retrieval_accuracy(encoder.encode_numpy, test_pairs, passages)["all"]
    assert history[-1] < history[0]
    assert after[0] > before[0]  # top-1 hits on phrasings it never saw


def test_retrieval_accuracy_counts_per_language(items):
    passages = {i.id: ft.passage_text(i) for i in items}
    pairs = [ft.Pair("성적", "sjpt.grade_current", "ko"), ft.Pair("grades", "sjpt.grade_current", "en")]
    result = ft.retrieval_accuracy(TinyEncoder().encode_numpy, pairs, passages)
    assert result["ko"][2] == 1 and result["en"][2] == 1 and result["all"][2] == 2


def test_results_markdown_has_both_models():
    stats = {"uz": (1, 2, 2), "en": (2, 2, 2), "ko": (0, 1, 2)}
    results = {name: {"heldout": {**stats, "all": (3, 5, 6)}, "semantic": stats, "hybrid": stats}
               for name in ("baseline", "fine-tuned")}
    info = {"base_model": "b", "out": "o", "data": "d", "train_pairs": 1, "test_pairs": 1,
            "dropped_near_eval": 0, "leakage": {}, "epochs": 1, "lr": 1e-5, "temperature": 0.05,
            "train_seconds": 1.0, "device": "cpu"}
    md = ft.results_markdown(results, info, 0.5)
    assert "| baseline |" in md and "| fine-tuned |" in md and "3/6 (50%)" in md
    json.dumps(info)  # the metadata file must be JSON-serialisable
