# AI-generated — to be rewritten by me
"""Temporary FastAPI server: a thin HTTP wrapper around core/.

Run it from the project root:
    .venv/bin/uvicorn api.main:app --reload --port 8000

The HTTP contract is in README.md. server_ai/ (and later server/) must give
byte-identical responses; tests/test_server_parity.py checks that.

Parameters are read as plain strings and checked here, not by FastAPI's
validation, so errors are 400 {"detail": "<message>"} (the contract), not 422.
"""
from __future__ import annotations

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import core

DEFAULT_K = 5

app = FastAPI(title="Sejong Navigator (temporary API)")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"chrome-extension://.*",
    allow_methods=["GET"],
)


def _required(name: str, value: str | None) -> str:
    if value is None:
        raise ValueError(f"missing query parameter: {name}")
    return value


def _parse_k(raw: str | None) -> int:
    if raw is None:
        return DEFAULT_K
    try:
        return int(raw)
    except ValueError:
        raise ValueError("k must be an integer") from None


def _call(fn) -> JSONResponse:
    """Run fn() and turn errors into the contract's status codes."""
    try:
        return JSONResponse(fn())
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e) or "not implemented") from e
    except KeyError as e:
        raise HTTPException(status_code=404, detail=f"unknown id: {e.args[0] if e.args else ''}") from e
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 - the contract wants JSON for every error
        raise HTTPException(status_code=500, detail="Internal Server Error") from e


@app.get("/health")
def health():
    return _call(lambda: {"status": "ok"})


@app.get("/search")
def search(q: str | None = None, k: str | None = None):
    return _call(lambda: core.search(_required("q", q), _parse_k(k)))


@app.get("/route")
def route(from_id: str | None = Query(None, alias="from"), to_id: str | None = Query(None, alias="to")):
    return _call(lambda: core.route(_required("from", from_id), _required("to", to_id)))


@app.get("/calendar")
def calendar(q: str | None = None, today: str | None = None):
    return _call(lambda: core.calendar_answer(_required("q", q), today))


@app.get("/suggest")
def suggest(prefix: str = ""):
    return _call(lambda: core.suggest(prefix))
