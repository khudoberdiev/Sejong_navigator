# AI-generated — to be rewritten by me
"""Command line: .venv/bin/python -m server_ai [--host 127.0.0.1] [--port 8000] [--no-warmup] [--quiet]"""
from __future__ import annotations

import argparse
import sys

import core
from server_ai.server import HTTPServer


def main() -> None:
    parser = argparse.ArgumentParser(description="Sejong Navigator raw-TCP HTTP server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-warmup", action="store_true",
                        help="skip loading the model at start (the first /search is then slow)")
    parser.add_argument("--quiet", action="store_true", help="no per-request log lines")
    args = parser.parse_args()

    if not args.no_warmup:
        # Build every index once, before any thread can race to build it.
        print("warming up (loading menu map and model)...", file=sys.stderr)
        core.search("warm up", 1)
        core.suggest("a")
        core.route("portal.root", "portal.root")

    server = HTTPServer(args.host, args.port, log=not args.quiet)
    print(f"serving on http://{server.host}:{server.port}  (Ctrl+C to stop)", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
