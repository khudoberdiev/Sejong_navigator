# AI-generated — to be rewritten by me
"""Embedder logic without loading the real model: a stub replaces SentenceTransformer."""
import numpy as np

from core.data import load_menu_items
from ml.embedder import Embedder, passage_text


class StubModel:
    def __init__(self):
        self.seen = []
        self.batch_size = None

    def encode(self, texts, batch_size, **kwargs):
        self.seen.extend(texts)
        self.batch_size = batch_size
        return np.ones((len(texts), 4), dtype=np.float64) / 2.0


def _with_stub(model_name):
    embedder = Embedder(model_name, batch_size=8)
    embedder._model = StubModel()  # skip the download
    return embedder


def test_e5_prefixes():
    embedder = _with_stub("intfloat/multilingual-e5-small")
    embedder.encode(["baholarim qayerda?"], kind="query")
    embedder.encode(["금학기 성적조회"], kind="passage")
    assert embedder._model.seen == ["query: baholarim qayerda?", "passage: 금학기 성적조회"]


def test_other_models_get_no_prefix():
    embedder = _with_stub("sentence-transformers/LaBSE")
    embedder.encode(["x"], kind="query")
    assert embedder._model.seen == ["x"]


def test_batch_size_and_dtype():
    embedder = _with_stub("intfloat/multilingual-e5-small")
    vectors = embedder.encode(["a", "b", "c"])
    assert embedder._model.batch_size == 8
    assert vectors.shape == (3, 4) and vectors.dtype == np.float32


def test_empty_input_does_not_load_the_model():
    embedder = Embedder()
    assert embedder.encode([]).shape[0] == 0
    assert embedder._model is None


def test_default_device_is_cpu(monkeypatch):
    monkeypatch.delenv("SEJONG_DEVICE", raising=False)
    assert Embedder().device == "cpu"


def test_passage_text_contains_all_parts():
    item = load_menu_items()["sjpt.current_semester_grades"]
    text = passage_text(item)
    for part in (item.name_ko, item.name_en, item.name_en_site, "joriy baholar", "당학기성적",
                 "View this semester's grades"):
        assert part in text
