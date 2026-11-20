# AI-generated — to be rewritten by me
"""Sockets: accept loop, one thread per connection, keep-alive and timeouts.

    listening socket ──accept()──> connection socket ──> new thread:
        loop:  read_request → handle → write response
               stop when the client asks to close, goes quiet (timeout),
               sends garbage (400 + close) or reaches MAX_REQUESTS.
"""
from __future__ import annotations

import socket
import sys
import threading
import time

from server_ai.app import handle
from server_ai.protocol import BadRequest, json_response, read_request

IDLE_TIMEOUT = 15.0     # seconds a keep-alive connection may stay quiet
MAX_REQUESTS = 1000     # per connection, then we close it


def _lingering_close(conn: socket.socket) -> None:
    """Close after an error without losing our reply.

    If unread request bytes are still in the receive buffer when we close(),
    the OS sends a TCP reset and the client may never see the 400. So: stop
    writing, read and discard what is left for a moment, then close.
    """
    try:
        conn.shutdown(socket.SHUT_WR)
        conn.settimeout(0.5)
        for _ in range(64):
            if not conn.recv(65536):
                break
    except OSError:
        pass


class HTTPServer:
    """A threaded HTTP/1.1 server. ``port=0`` picks a free port (see ``.port``)."""

    def __init__(self, host: str = "127.0.0.1", port: int = 8000, log: bool = True) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((host, port))
        self.sock.listen(128)
        self.host, self.port = self.sock.getsockname()[:2]
        self.log = log
        self._running = False
        self._connections: set[socket.socket] = set()
        self._lock = threading.Lock()

    # ------------------------------------------------------------ lifecycle

    def serve_forever(self) -> None:
        """Accept connections until shutdown(). Each connection gets its own thread."""
        self._running = True
        while self._running:
            try:
                conn, address = self.sock.accept()
            except OSError:  # the listening socket was closed by shutdown()
                break
            with self._lock:
                self._connections.add(conn)
            threading.Thread(target=self._serve_connection, args=(conn, address), daemon=True).start()

    def start_in_thread(self) -> threading.Thread:
        """Run serve_forever() in a background thread (used by tests)."""
        thread = threading.Thread(target=self.serve_forever, daemon=True)
        thread.start()
        return thread

    def shutdown(self) -> None:
        """Stop accepting and close every open connection."""
        self._running = False
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()
        with self._lock:
            for conn in list(self._connections):
                try:
                    conn.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    # ------------------------------------------------------------ one connection

    def _serve_connection(self, conn: socket.socket, address) -> None:
        conn.settimeout(IDLE_TIMEOUT)
        stream = conn.makefile("rb")
        try:
            for _ in range(MAX_REQUESTS):
                try:
                    request = read_request(stream)
                except BadRequest:
                    conn.sendall(json_response({"detail": "Bad Request"}, 400).to_bytes(keep_alive=False))
                    _lingering_close(conn)
                    return
                if request is None:
                    return  # client closed the connection
                started = time.perf_counter()
                response = handle(request)
                keep_alive = request.keep_alive()
                conn.sendall(response.to_bytes(keep_alive, head_only=request.method == "HEAD"))
                if self.log:
                    ms = (time.perf_counter() - started) * 1000
                    print(f"{address[0]} {request.method} {request.target} {response.status} {ms:.1f}ms",
                          file=sys.stderr)
                if not keep_alive:
                    return
        except (socket.timeout, ConnectionError, OSError):
            return  # quiet or vanished client: just close
        finally:
            with self._lock:
                self._connections.discard(conn)
            stream.close()
            conn.close()
