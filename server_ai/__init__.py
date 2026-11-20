# AI-generated — to be rewritten by me
"""Raw-TCP HTTP/1.1 server for Sejong Navigator: Python standard library only.

    .venv/bin/python -m server_ai --port 8000

Layers (each file can be read on its own):
  protocol.py  bytes <-> Request / Response (parsing, URL decoding, JSON rendering)
  app.py       routing, CORS and the four endpoints; calls ONLY core/
  server.py    sockets: accept loop, one thread per connection, keep-alive, timeouts

It answers byte-for-byte like api/ (FastAPI). tests/test_server_parity.py checks this.
This folder is the AI reference version; server/ is the hand-written one.
"""
from server_ai.app import handle
from server_ai.server import HTTPServer

__all__ = ["handle", "HTTPServer"]
