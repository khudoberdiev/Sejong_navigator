# AI-generated — to be rewritten by me
"""Temporary FastAPI server: a thin HTTP wrapper around core/.

Run it from the project root:
    .venv/bin/uvicorn api.main:app --reload --port 8000

The HTTP contract is in README.md. server/ must give the same responses.
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

import core

app = FastAPI(title="Sejong Navigator (temporary API)")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["GET"],
)


def _call(fn, *args):
    """Call a core function and turn its errors into HTTP status codes."""
    try:
        return fn(*args)
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e) or "not implemented")
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"unknown id: {e.args[0] if e.args else ''}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/search")
def search(q: str = Query(..., min_length=1), k: int = Query(5, ge=1, le=50)) -> list[dict]:
    return _call(core.search, q, k)


@app.get("/route")
def route(from_id: str = Query(..., alias="from"), to_id: str = Query(..., alias="to")) -> list[dict]:
    return _call(core.route, from_id, to_id)


@app.get("/suggest")
def suggest(prefix: str = Query("")) -> list[str]:
    return _call(core.suggest, prefix)
