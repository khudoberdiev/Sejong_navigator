# AI-generated — to be rewritten by me
"""HTTP/1.1 message parsing and rendering (RFC 9112), just enough for this API.

Request format on the wire:
    GET /search?q=%EC%84%B1%EC%A0%81 HTTP/1.1\\r\\n      <- request line
    Host: 127.0.0.1:8000\\r\\n                            <- headers, one per line
    \\r\\n                                                 <- empty line ends the head
    <body: Content-Length bytes>                           <- usually empty for GET
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import BinaryIO
from urllib.parse import parse_qsl, unquote, urlsplit

MAX_LINE = 8190          # longest request line / header line we accept (bytes)
MAX_HEADERS = 100
MAX_BODY = 1024 * 1024   # GET requests should not have bodies; refuse big ones

REASONS = {
    200: "OK", 307: "Temporary Redirect", 400: "Bad Request", 404: "Not Found",
    405: "Method Not Allowed", 500: "Internal Server Error", 501: "Not Implemented",
}


class BadRequest(Exception):
    """The bytes are not a valid HTTP request. The server answers 400 and closes."""


@dataclass
class Request:
    method: str
    target: str                      # raw request target, e.g. "/search?q=%EC%84%B1"
    version: str                     # "HTTP/1.1"
    headers: dict[str, str]          # lowercase names; a repeated header keeps the last value
    body: bytes = b""

    @property
    def path(self) -> str:
        """Percent-decoded path (UTF-8): "/s%65arch" -> "/search"."""
        return unquote(urlsplit(self.target).path or "/")

    @property
    def query_string(self) -> str:
        return urlsplit(self.target).query

    @property
    def query(self) -> dict[str, str]:
        """Decoded query parameters. "+" is a space, %XX is UTF-8 (invalid bytes become U+FFFD),
        and a repeated parameter keeps the LAST value: the same rules as Starlette/FastAPI."""
        return dict(parse_qsl(self.query_string, keep_blank_values=True))

    def keep_alive(self) -> bool:
        """HTTP/1.1 keeps the connection open unless "Connection: close";
        HTTP/1.0 closes it unless "Connection: keep-alive"."""
        tokens = {t.strip().lower() for t in self.headers.get("connection", "").split(",")}
        if self.version == "HTTP/1.0":
            return "keep-alive" in tokens
        return "close" not in tokens


@dataclass
class Response:
    status: int
    body: bytes = b""
    headers: list[tuple[str, str]] = field(default_factory=list)

    def header(self, name: str, value: str) -> "Response":
        self.headers.append((name, value))
        return self

    def to_bytes(self, keep_alive: bool, head_only: bool = False) -> bytes:
        lines = [f"HTTP/1.1 {self.status} {REASONS.get(self.status, 'Unknown')}"]
        names = {name.lower() for name, _ in self.headers}
        if "content-length" not in names:
            lines.append(f"content-length: {len(self.body)}")
        lines += [f"{name}: {value}" for name, value in self.headers]
        lines.append(f"connection: {'keep-alive' if keep_alive else 'close'}")
        head = ("\r\n".join(lines) + "\r\n\r\n").encode("latin-1")
        return head if head_only else head + self.body


def render_json(content) -> bytes:
    """Exactly how Starlette's JSONResponse renders: compact, UTF-8, no ASCII escaping."""
    return json.dumps(content, ensure_ascii=False, allow_nan=False, indent=None,
                      separators=(",", ":")).encode("utf-8")


def json_response(content, status: int = 200) -> Response:
    return Response(status, render_json(content), [("content-type", "application/json")])


def text_response(text: str, status: int) -> Response:
    return Response(status, text.encode("utf-8"), [("content-type", "text/plain; charset=utf-8")])


def _readline(stream: BinaryIO) -> bytes:
    line = stream.readline(MAX_LINE + 2)
    if len(line) > MAX_LINE and not line.endswith(b"\n"):
        raise BadRequest("line too long")
    return line


def read_request(stream: BinaryIO) -> Request | None:
    """Read one request from a buffered socket stream.

    Returns None when the client closed the connection cleanly before sending
    anything (normal end of a keep-alive connection). Raises BadRequest for
    malformed input and socket.timeout when the client goes quiet.
    """
    line = _readline(stream)
    while line in (b"\r\n", b"\n"):  # RFC 9112: ignore empty lines before a request
        line = _readline(stream)
    if not line:
        return None

    parts = line.decode("latin-1").rstrip("\r\n").split(" ")
    if len(parts) != 3:
        raise BadRequest("bad request line")
    method, target, version = parts
    if not method.isalpha() or not method.isupper() or version not in ("HTTP/1.0", "HTTP/1.1"):
        raise BadRequest("bad request line")
    if not target or any(ch in target for ch in " \t\r\n"):
        raise BadRequest("bad target")

    headers: dict[str, str] = {}
    for _ in range(MAX_HEADERS + 1):
        line = _readline(stream)
        if not line:
            raise BadRequest("connection closed inside the headers")
        if line in (b"\r\n", b"\n"):
            break
        name, sep, value = line.decode("latin-1").partition(":")
        if not sep or not name or name != name.strip():
            raise BadRequest("bad header line")
        headers[name.lower()] = value.strip()
    else:
        raise BadRequest("too many headers")

    if "transfer-encoding" in headers:
        raise BadRequest("chunked request bodies are not supported")
    length_text = headers.get("content-length", "0")
    if not length_text.isdigit() or int(length_text) > MAX_BODY:
        raise BadRequest("bad content-length")
    body = stream.read(int(length_text)) if int(length_text) else b""
    if len(body) != int(length_text):
        raise BadRequest("body shorter than content-length")
    return Request(method, target, version, headers, body)
