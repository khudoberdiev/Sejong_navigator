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
    response = client.get("/route", params={"from": "portal.root", "to": "ecampus.my_courses"})
    assert response.status_code == 200
    assert response.json() == core.route("portal.root", "ecampus.my_courses")


def test_route_returns_full_items_in_order():
    path = client.get("/route", params={"from": "portal.root", "to": "sjpt.current_semester_grades"}).json()
    assert [step["id"] for step in path] == [
        "portal.root", "portal.info_system", "portal.integrated_info", "portal.sjpt",
        "sjpt.self_stud", "sjpt.class_grade", "sjpt.grades_course_evaluation", "sjpt.current_semester_grades"]
    assert path[-1]["name_ko"] == "당학기성적조회"
    assert "selector_desktop" in path[-1] and "name_en_site" in path[-1] and "score" not in path[-1]


def test_suggest_matches_core():
    assert client.get("/suggest", params={"prefix": "장"}).json() == core.suggest("장")


def test_items_endpoint_is_gone():
    assert client.get("/items", params={"ids": "portal.root"}).status_code == 404


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
