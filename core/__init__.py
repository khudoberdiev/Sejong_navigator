# AI-generated — to be rewritten by me
"""Shared interface for every Sejong Navigator server.

Both ``api/`` (FastAPI) and ``server/`` (raw TCP) must call ONLY these three
functions. They must not touch ``index/``, ``ml/`` or ``data/`` themselves.
That way both servers always return the same results.

    from core import search, route, suggest
"""
from core.navigator import route, search, suggest

__all__ = ["search", "route", "suggest"]
