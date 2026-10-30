"""Local web server for the Swarm chat UI. Standard library only.

Routes:
    GET  /                  chat page
    POST /api/chat          {"message": "..."} -> {"text": "...", "task_id": "..."}
    GET  /api/agents        registered agent names
    GET  /api/tasks         all tasks
    GET  /api/tasks/<id>    one task
"""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .agent import REGISTRY
from .chat import handle

WEB_FILE = Path(__file__).resolve().parent.parent / "web" / "index.html"
MAX_BODY = 16 * 1024


class Worker:
    """Runs pending tasks on a background thread with its own event loop.

    Each wake-up runs everything unfinished. Tasks queued while a run is in
    progress trigger another run as soon as the current one finishes.
    """

    def __init__(self, runner):
        self.runner = runner
        self._wake = threading.Event()
        threading.Thread(target=self._loop, daemon=True, name="swarm-worker").start()
        self.wake()  # pick up anything left over from a previous session

    def wake(self):
        self._wake.set()

    def _loop(self):
        while True:
            self._wake.wait()
            self._wake.clear()
            try:
                asyncio.run(self.runner.run_pending())
            except Exception as exc:  # keep the worker alive
                print(f"[swarm] worker error: {exc!r}")


def make_handler(runner, worker):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):  # keep the terminal quiet
            pass

        def _send(self, code, body: bytes, content_type: str):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, code, obj):
            self._send(code, json.dumps(obj).encode(), "application/json")

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in ("/", "/index.html"):
                try:
                    body = WEB_FILE.read_bytes()
                except FileNotFoundError:
                    return self._send(500, b"web/index.html is missing", "text/plain")
                return self._send(200, body, "text/html; charset=utf-8")
            if path == "/api/agents":
                return self._json(200, {"agents": sorted(REGISTRY)})
            if path == "/api/tasks":
                return self._json(200, {"tasks": runner.store.snapshot()})
            if path.startswith("/api/tasks/"):
                task_id = path.rsplit("/", 1)[1]
                task = next((t for t in runner.store.snapshot() if t["id"] == task_id), None)
                if task is None:
                    return self._json(404, {"error": "not found"})
                return self._json(200, task)
            self._json(404, {"error": "not found"})

        def do_POST(self):
            if self.path.split("?", 1)[0] != "/api/chat":
                return self._json(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length", 0))
            except ValueError:
                return self._json(400, {"error": "bad length"})
            if length > MAX_BODY:
                return self._json(413, {"error": "message too large"})
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except json.JSONDecodeError:
                return self._json(400, {"error": "invalid JSON"})
            reply = handle(str(data.get("message", "")), runner, worker.wake)
            self._json(200, reply)

    return Handler


def build_server(runner, host="127.0.0.1", port=8000):
    """Create the server without starting it. Port 0 picks a free port."""
    worker = Worker(runner)
    server = ThreadingHTTPServer((host, port), make_handler(runner, worker))
    server.worker = worker
    return server
