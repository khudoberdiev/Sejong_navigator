# AI-generated — to be rewritten by me
"""Real-model tests. Skipped by default; run with:  .venv/bin/python -m pytest -m slow"""
import pytest

import core
from core import navigator

pytestmark = pytest.mark.slow


@pytest.mark.parametrize("query", ["where are my grades?", "baholarim qayerda?", "성적 조회", "이번 학기 학점 확인"])
def test_hybrid_finds_grades_in_top3(query):
    assert "sjpt.current_semester_grades" in [r["id"] for r in core.search(query, 3)]


def test_semantic_only_handles_no_shared_words():
    ids = [r["id"] for r in navigator.search_with_weight("시험 결과 보기", 3, 1.0)]
    assert "sjpt.current_semester_grades" in ids


def test_both_servers_match_with_the_real_model():
    from urllib.parse import quote

    from tests.test_server_parity import ask_fastapi, ask_tcp
    from server_ai import HTTPServer

    server = HTTPServer("127.0.0.1", 0, log=False)
    server.start_in_thread()
    try:
        for question in ["baholarim qayerda?", "성적 조회", "where are my grades?"]:
            target = f"/search?q={quote(question)}&k=3"
            assert ask_tcp(server, "GET", target) == ask_fastapi("GET", target)
    finally:
        server.shutdown()


def test_vectors_are_cached_on_disk():
    navigator._vector_index()  # build (or load) once
    navigator.reset_caches()
    assert navigator._vector_index().loaded_from_cache
