# AI-generated — to be rewritten by me
"""The FastAPI server must return exactly what core returns."""
from fastapi.testclient import TestClient

import core
from api.main import app

client = TestClient(app)


def test_search_matches_core():
    response = client.get("/search", params={"q": "baholarim", "k": 3})
    assert response.status_code == 200
    assert response.json() == core.search("baholarim", 3)


def test_route_matches_core():
    response = client.get("/route", params={"from": "portal.root", "to": "library.loans"})
    assert response.json() == core.route("portal.root", "library.loans")


def test_suggest_matches_core():
    assert client.get("/suggest", params={"prefix": "장"}).json() == core.suggest("장")


def test_items_matches_core():
    ids = ["portal.root", "sjpt.grade_current"]
    response = client.get("/items", params={"ids": ",".join(ids)})
    assert response.json() == core.get_items(ids)
    assert [i["id"] for i in response.json()] == ids


def test_items_empty_and_unknown():
    assert client.get("/items", params={"ids": ""}).json() == []
    assert client.get("/items", params={"ids": "portal.root,nope"}).status_code == 404


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_cors_allows_extension_only():
    ext = client.get("/health", headers={"Origin": "chrome-extension://abcdefghijklmnop"})
    assert ext.headers["access-control-allow-origin"] == "chrome-extension://abcdefghijklmnop"
    web = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in web.headers


def test_unknown_id_is_404():
    assert client.get("/route", params={"from": "portal.root", "to": "nope"}).status_code == 404


def test_bad_query_is_400():
    assert client.get("/search", params={"q": "?!", "k": 3}).status_code == 400
