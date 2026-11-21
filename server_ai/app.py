# AI-generated — to be rewritten by me
"""Routing, CORS and the five endpoints. Calls ONLY core/

Every rule here copies what api/ (FastAPI + Starlette CORSMiddleware) does, so
both servers are interchangeable for the extension:
  * GET /health /search /route /suggest /calendar -> JSON
  * known path, other method (also HEAD and non-CORS OPTIONS) -> 405 + "allow: GET"
  * unknown path -> 404 {"detail":"Not Found"}
  * "/health/" -> 307 redirect to "/health" (Starlette's redirect_slashes)
  * errors -> {"detail": message}: 400 bad argument, 404 unknown id, 500 unexpected
  * CORS: only chrome-extension:// origins; preflight answered like Starlette
"""
from __future__ import annotations

import re

import core
from server_ai.protocol import Request, Response, json_response, text_response

DEFAULT_K = 5
ALLOWED_ORIGIN = re.compile(r"chrome-extension://.*")
SAFELISTED_HEADERS = ["Accept", "Accept-Language", "Content-Language", "Content-Type"]
PREFLIGHT_VARY = "Origin, Access-Control-Request-Method, Access-Control-Request-Headers, Access-Control-Request-Private-Network"


# ---------------------------------------------------------------- endpoints

def _required(query: dict[str, str], name: str) -> str:
    if name not in query:
        raise ValueError(f"missing query parameter: {name}")
    return query[name]


def _parse_k(query: dict[str, str]) -> int:
    if "k" not in query:
        return DEFAULT_K
    try:
        return int(query["k"])
    except ValueError:
        raise ValueError("k must be an integer") from None


ENDPOINTS = {
    "/health": lambda q: {"status": "ok"},
    "/search": lambda q: core.search(_required(q, "q"), _parse_k(q)),
    "/route": lambda q: core.route(_required(q, "from"), _required(q, "to")),
    "/suggest": lambda q: core.suggest(q.get("prefix", "")),
    "/calendar": lambda q: core.calendar_answer(_required(q, "q"), q.get("today")),
}


def _run(endpoint, query: dict[str, str]) -> Response:
    """Call the endpoint and map core's exceptions to status codes."""
    try:
        return json_response(endpoint(query))
    except NotImplementedError as e:
        return json_response({"detail": str(e) or "not implemented"}, 501)
    except KeyError as e:
        return json_response({"detail": f"unknown id: {e.args[0] if e.args else ''}"}, 404)
    except ValueError as e:
        return json_response({"detail": str(e)}, 400)
    except Exception:  # noqa: BLE001 - never let a bug kill the connection thread
        return json_response({"detail": "Internal Server Error"}, 500)


# ---------------------------------------------------------------- CORS

def _origin_allowed(origin: str) -> bool:
    return ALLOWED_ORIGIN.fullmatch(origin) is not None


def _preflight(request: Request) -> Response:
    """Answer a CORS preflight (OPTIONS + Origin + Access-Control-Request-Method)."""
    origin = request.headers["origin"]
    failures = []
    headers = [("vary", PREFLIGHT_VARY), ("access-control-allow-methods", "GET"),
               ("access-control-max-age", "600"),
               ("access-control-allow-headers", ", ".join(SAFELISTED_HEADERS))]
    if _origin_allowed(origin):
        headers.append(("access-control-allow-origin", origin))
    else:
        failures.append("origin")
    if request.headers["access-control-request-method"] != "GET":
        failures.append("method")
    requested = request.headers.get("access-control-request-headers", "")
    allowed = {h.lower() for h in SAFELISTED_HEADERS}
    if any(h.strip().lower() not in allowed for h in requested.split(",") if h.strip()):
        failures.append("headers")

    response = text_response("Disallowed CORS " + ", ".join(failures), 400) if failures else text_response("OK", 200)
    response.headers = headers + response.headers
    return response


def _add_cors(request: Request, response: Response) -> Response:
    """Headers for a normal (non-preflight) response."""
    origin = request.headers.get("origin")
    if origin and _origin_allowed(origin):
        response.header("access-control-allow-origin", origin)
    return response.header("vary", "Origin")


# ---------------------------------------------------------------- routing

def handle(request: Request) -> Response:
    """Turn one parsed request into one response. No sockets here, so it is easy to test."""
    if (request.method == "OPTIONS" and "origin" in request.headers
            and "access-control-request-method" in request.headers):
        return _preflight(request)

    path = request.path
    endpoint = ENDPOINTS.get(path)
    if endpoint is None:
        if path.endswith("/") and path.rstrip("/") in ENDPOINTS:
            location = f"http://{request.headers.get('host', 'localhost')}{path.rstrip('/')}"
            if request.query_string:
                location += "?" + request.query_string
            response = Response(307).header("location", location)
        else:
            response = json_response({"detail": "Not Found"}, 404)
    elif request.method != "GET":
        response = json_response({"detail": "Method Not Allowed"}, 405).header("allow", "GET")
    else:
        response = _run(endpoint, request.query)
    return _add_cors(request, response)
