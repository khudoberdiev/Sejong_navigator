# AI-generated — to be rewritten by me
"""api/ (FastAPI) and server_ai/ (raw TCP) must answer every request identically:
same status, same headers (minus date/server/connection) and the same body BYTES.

To check your own server/ later: start it, then point TCP_TARGET at it (see bottom).
"""
import http.client
import socket
import threading
import time
from urllib.parse import quote

import pytest
from fastapi.testclient import TestClient

import server_ai.server as server_module
from api.main import app
from server_ai import HTTPServer

IGNORED_HEADERS = {"date", "server", "connection", "keep-alive"}
EXT = "chrome-extension://abcdefghijklmnop"
fastapi_client = TestClient(app, raise_server_exceptions=False)


@pytest.fixture(scope="module")
def tcp_server():
    server = HTTPServer("127.0.0.1", 0, log=False)
    server.start_in_thread()
    yield server
    server.shutdown()


def _headers(items):
    return {k.lower(): v for k, v in items if k.lower() not in IGNORED_HEADERS}


def ask_fastapi(method, target, headers=None):
    r = fastapi_client.request(method, target, headers=headers or {}, follow_redirects=False)
    return r.status_code, _headers(r.headers.items()), r.content


def ask_tcp(server, method, target, headers=None):
    conn = http.client.HTTPConnection(server.host, server.port, timeout=10)
    conn.request(method, target, headers={"Host": "testserver", **(headers or {})})
    r = conn.getresponse()
    body = r.read()
    conn.close()
    return r.status, _headers(r.getheaders()), body


q = quote  # percent-encode UTF-8, the way a browser sends it

CASES = [
    # (method, target, headers)
    ("GET", "/health", None),
    ("GET", "/search?q=grades&k=3", None),
    ("GET", "/search?q=" + q("baholarim qayerda?"), None),
    ("GET", "/search?q=" + q("성적 조회") + "&k=5", None),
    ("GET", "/search?q=where+are+my+grades%3F", None),       # "+" is a space
    ("GET", "/search?q=" + q("oʻquv xonasi"), None),         # Uzbek apostrophe
    ("GET", "/search?q=library&q=grades", None),             # repeated: last wins
    ("GET", "/search?q=grades&k=abc", None),                 # 400
    ("GET", "/search?q=grades&k=0", None),                   # 400
    ("GET", "/search?q=grades&k=51", None),                  # 400
    ("GET", "/search", None),                                # 400 missing q
    ("GET", "/search?q=", None),                             # 400 empty
    ("GET", "/search?q=%3F%21", None),                       # 400 only punctuation
    ("GET", "/route?from=portal.root&to=sjpt.current_semester_grades", None),
    ("GET", "/route?from=ecampus.my_courses&to=sjpt.course_evaluation", None),
    ("GET", "/route?from=portal.root&to=nope", None),        # 404
    ("GET", "/route?from=portal.root", None),                # 400 missing to
    ("GET", "/suggest?prefix=" + q("ㅈㅏㅇ"), None),
    ("GET", "/suggest?prefix=" + q("장ㅎ"), None),
    ("GET", "/suggest?prefix=Cur", None),
    ("GET", "/suggest", None),
    ("GET", "/suggest?prefix=%FF%FE", None),                 # invalid UTF-8 -> U+FFFD
    ("GET", "/s%65arch?q=grades", None),                     # percent-encoded path
    ("GET", "/nope", None),                                  # 404
    ("GET", "/health/", None),                               # 307 redirect
    ("GET", "/search/?q=grades", None),                      # 307 keeps the query
    ("POST", "/health", None),                               # 405
    ("HEAD", "/health", None),                               # 405, no body
    ("OPTIONS", "/health", None),                            # 405 (not a preflight)
    ("GET", "/health", {"Origin": EXT}),
    ("GET", "/route?from=portal.root&to=nope", {"Origin": EXT}),
    ("GET", "/health", {"Origin": "https://evil.example"}),
    ("OPTIONS", "/search", {"Origin": EXT, "Access-Control-Request-Method": "GET"}),
    ("OPTIONS", "/search", {"Origin": EXT, "Access-Control-Request-Method": "GET",
                            "Access-Control-Request-Headers": "content-type"}),
    ("OPTIONS", "/search", {"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"}),
    ("OPTIONS", "/search", {"Origin": EXT, "Access-Control-Request-Method": "POST"}),
    ("OPTIONS", "/search", {"Origin": EXT, "Access-Control-Request-Method": "GET",
                            "Access-Control-Request-Headers": "X-Custom"}),
    ("OPTIONS", "/search", {"Origin": "https://evil.example", "Access-Control-Request-Method": "PUT"}),
]


@pytest.mark.parametrize("method, target, headers", CASES, ids=[f"{m} {t}" for m, t, _ in CASES])
def test_same_response(tcp_server, method, target, headers):
    expected = ask_fastapi(method, target, headers)
    actual = ask_tcp(tcp_server, method, target, headers)
    assert actual == expected


def test_status_codes_cover_the_contract(tcp_server):
    statuses = {ask_tcp(tcp_server, m, t, h)[0] for m, t, h in CASES}
    assert {200, 307, 400, 404, 405} <= statuses


def test_korean_body_is_utf8_not_escaped(tcp_server):
    _, headers, body = ask_tcp(tcp_server, "GET", "/suggest?prefix=" + q("장"))
    assert headers["content-type"] == "application/json"
    assert "장학".encode() in body and b"\\u" not in body


# ---------------------------------------------------------------- server-only behaviour


def _raw(server, data: bytes, read_timeout=5.0) -> bytes:
    with socket.create_connection((server.host, server.port), timeout=read_timeout) as s:
        s.sendall(data)
        chunks = []
        try:
            while chunk := s.recv(65536):
                chunks.append(chunk)
        except socket.timeout:
            pass
        return b"".join(chunks)


def test_keep_alive_reuses_one_connection(tcp_server):
    conn = http.client.HTTPConnection(tcp_server.host, tcp_server.port, timeout=10)
    for _ in range(3):
        conn.request("GET", "/health")
        r = conn.getresponse()
        assert r.status == 200 and r.read() == b'{"status":"ok"}'
        assert r.getheader("connection") == "keep-alive"
    first_socket = conn.sock
    conn.request("GET", "/suggest?prefix=Cur")
    conn.getresponse().read()
    assert conn.sock is first_socket  # never reconnected
    conn.close()


def test_pipelined_requests_in_one_packet(tcp_server):
    data = (b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n"
            b"GET /suggest?prefix=Cur HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
    reply = _raw(tcp_server, data)
    assert reply.count(b"HTTP/1.1 200 OK") == 2
    assert b"Current Semester Grades" in reply


def test_connection_close_and_http10(tcp_server):
    reply = _raw(tcp_server, b"GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
    assert b"connection: close" in reply and reply.endswith(b'{"status":"ok"}')
    reply = _raw(tcp_server, b"GET /health HTTP/1.0\r\n\r\n")  # 1.0 closes by default
    assert reply.startswith(b"HTTP/1.1 200 OK") and b"connection: close" in reply


@pytest.mark.parametrize("garbage", [
    b"HELLO\r\n\r\n",
    b"GET /health\r\n\r\n",
    b"GET /health HTTP/9.9\r\n\r\n",
    b"GET /health HTTP/1.1\r\nBroken header line\r\n\r\n",
    b"GET /health HTTP/1.1\r\nContent-Length: abc\r\n\r\n",
    b"GET /health HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    b"GET /" + b"a" * 9000 + b" HTTP/1.1\r\n\r\n",
])
def test_malformed_requests_get_400_and_close(tcp_server, garbage):
    reply = _raw(tcp_server, garbage)
    assert reply.startswith(b"HTTP/1.1 400 Bad Request")
    assert b"connection: close" in reply and reply.endswith(b'{"detail":"Bad Request"}')


def test_request_body_is_read_and_ignored(tcp_server):
    reply = _raw(tcp_server, b"GET /health HTTP/1.1\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello")
    assert reply.startswith(b"HTTP/1.1 200 OK")


def test_unexpected_error_is_500_json(tcp_server, monkeypatch):
    import core

    def boom(prefix):
        raise RuntimeError("bug")

    monkeypatch.setattr(core, "suggest", boom)
    status, _, body = ask_tcp(tcp_server, "GET", "/suggest?prefix=x")
    assert (status, body) == (500, b'{"detail":"Internal Server Error"}')
    assert ask_fastapi("GET", "/suggest?prefix=x")[0::2] == (500, b'{"detail":"Internal Server Error"}')


def test_one_thread_per_connection_handles_parallel_clients(tcp_server):
    results = []

    def client():
        results.append(ask_tcp(tcp_server, "GET", "/route?from=portal.root&to=sjpt.current_semester_grades")[0])

    threads = [threading.Thread(target=client) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    assert results == [200] * 20


def test_idle_keep_alive_connection_is_closed(monkeypatch):
    monkeypatch.setattr(server_module, "IDLE_TIMEOUT", 0.3)
    server = HTTPServer("127.0.0.1", 0, log=False)
    server.start_in_thread()
    try:
        with socket.create_connection((server.host, server.port), timeout=5) as s:
            s.sendall(b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n")
            time.sleep(0.1)
            assert s.recv(65536).startswith(b"HTTP/1.1 200 OK")
            started = time.time()
            assert s.recv(65536) == b""  # server hung up after the idle timeout
            assert time.time() - started < 3
    finally:
        server.shutdown()
