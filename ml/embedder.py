# AI-generated — to be rewritten by me
"""Turns text into vectors with a multilingual sentence-embedding model.

Any object with ``model_name: str`` and
``encode(texts, kind) -> np.ndarray`` (rows L2-normalised) can be used as an
embedder. ml/fake_embedder.py is a tiny one for tests.
"""
from __future__ import annotations

import os
from typing import TYPE_CHECKING, Literal, Sequence

import numpy as np

if TYPE_CHECKING:  # type hints only; a real import would be circular (core imports ml)
    from core.models import MenuItem

DEFAULT_MODEL = "intfloat/multilingual-e5-small"
Kind = Literal["query", "passage"]

# Some models are trained with a prefix that marks questions vs documents.
# e5: "query: ..." for questions, "passage: ..." for the texts we search in.
_PREFIXES: dict[str, dict[str, str]] = {
    "e5": {"query": "query: ", "passage": "passage: "},
}


def passage_text(item: MenuItem) -> str:
    """The text that represents one menu item for the embedding model.

    Korean name, English name, keywords and description joined in one line, e.g.
    "금학기 성적조회. Current Semester Grade Inquiry. baholar, grades, 성적. See your grades ..."
    Changing this changes every vector; the disk cache notices (it hashes the texts).
    """
    parts = [item.name_ko, item.name_en, ", ".join(item.keywords), item.description]
    return ". ".join(p.strip().rstrip(".") for p in parts if p.strip())


class Embedder:
    """Wraps a sentence-transformers model, loaded lazily on the first encode().

    The model downloads on first use into the Hugging Face cache (HF_HOME,
    default ~/.cache/huggingface). Runs on CPU by default; set SEJONG_DEVICE=mps
    to try the Apple GPU.
    """

    def __init__(self, model_name: str = DEFAULT_MODEL, device: str | None = None,
                 batch_size: int = 32) -> None:
        self.model_name = model_name
        self.device = device or os.environ.get("SEJONG_DEVICE", "cpu")
        self.batch_size = batch_size
        self._model = None
        family = next((f for f in _PREFIXES if f in model_name.lower()), None)
        self._prefixes = _PREFIXES.get(family, {"query": "", "passage": ""})

    def _load(self):
        if self._model is None:
            os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
            from sentence_transformers import SentenceTransformer  # heavy import, kept local
            self._model = SentenceTransformer(self.model_name, device=self.device)
        return self._model

    def encode(self, texts: Sequence[str], kind: Kind = "query") -> np.ndarray:
        """Return an array of shape (len(texts), dim): float32, each row L2-normalised.

        Texts are processed ``batch_size`` at a time. Because rows are unit
        vectors, ``a @ b.T`` is the cosine similarity.
        """
        prefix = self._prefixes[kind]
        if not texts:
            return np.zeros((0, 0), dtype=np.float32)
        vectors = self._load().encode(
            [prefix + t for t in texts],
            batch_size=self.batch_size,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        return vectors.astype(np.float32)
