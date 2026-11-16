# AI-generated — to be rewritten by me
"""Every test uses FakeEmbedder, so nothing downloads the model, except tests
marked @pytest.mark.slow, which use the real one. Run those with:  pytest -m slow
"""
import pytest

from core import navigator
from ml.fake_embedder import FakeEmbedder


@pytest.fixture(autouse=True)
def _embedder_for_tests(request):
    if request.node.get_closest_marker("slow"):
        navigator.use_embedder(None)  # real model + default disk cache
    else:
        navigator.use_embedder(FakeEmbedder())  # no disk cache
    yield
    navigator.use_embedder(None)
