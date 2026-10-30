"""A small durable task store. Plain JSON on disk, no database, works offline."""

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class TaskStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        if self.path.exists():
            self._data = json.loads(self.path.read_text())
        else:
            self._data = {"tasks": {}}

    def _flush(self):
        # Write to a temp file, then swap it in, so a crash never leaves
        # a half-written store behind.
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._data, indent=2))
        os.replace(tmp, self.path)

    def upsert(self, task: dict):
        with self._lock:
            task["updated"] = now()
            self._data["tasks"][task["id"]] = task
            self._flush()

    def get(self, task_id: str):
        return self._data["tasks"].get(task_id)

    def all(self) -> list:
        return list(self._data["tasks"].values())

    def unfinished(self) -> list:
        return [t for t in self.all() if t["status"] in ("pending", "running")]
