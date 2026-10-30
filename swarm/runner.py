"""Async task runner: concurrency limits, retries, optional timeouts, resumable checkpoints."""

import asyncio
import uuid

from .agent import REGISTRY
from .store import TaskStore, now


class Context:
    """Handed to every agent. Holds the task's saved progress."""

    def __init__(self, task: dict, store: TaskStore):
        self._task = task
        self._store = store
        self.state: dict = dict(task.get("checkpoint", {}))

    def checkpoint(self, **state):
        """Save progress. If the process dies, the next run resumes from here."""
        self.state.update(state)
        self._task["checkpoint"] = dict(self.state)
        self._store.upsert(self._task)

    def log(self, message: str):
        self._task.setdefault("log", []).append(f"{now()} {message}")
        self._store.upsert(self._task)


class Runner:
    def __init__(self, store: TaskStore, concurrency: int = 4,
                 max_retries: int = 3, backoff_base: float = 2.0):
        self.store = store
        self.concurrency = concurrency
        self.max_retries = max_retries
        self.backoff_base = backoff_base

    # ---- submitting -------------------------------------------------------

    def submit(self, agent: str, payload: dict | None = None,
               timeout: float | None = None, max_retries: int | None = None) -> dict:
        if agent not in REGISTRY:
            raise ValueError(f"unknown agent '{agent}'. Available: {', '.join(REGISTRY) or 'none'}")
        task = {
            "id": uuid.uuid4().hex[:12],
            "agent": agent,
            "payload": payload or {},
            "status": "pending",
            "attempts": 0,
            "max_retries": self.max_retries if max_retries is None else max_retries,
            "timeout": timeout,          # None = no limit, so hours-long tasks are fine
            "checkpoint": {},
            "log": [],
            "result": None,
            "error": None,
            "created": now(),
        }
        self.store.upsert(task)
        return task

    # ---- running ----------------------------------------------------------

    async def run_pending(self) -> list:
        """Run every unfinished task to completion. Safe to call again after a crash."""
        for task in self.store.unfinished():
            # Anything marked "running" was interrupted by a previous process.
            task["status"] = "pending"
            self.store.upsert(task)

        sem = asyncio.Semaphore(self.concurrency)
        pending = self.store.unfinished()
        return await asyncio.gather(
            *(self._execute(task, sem) for task in pending),
            return_exceptions=True,
        )

    async def _execute(self, task: dict, sem: asyncio.Semaphore):
        agent_cls = REGISTRY.get(task["agent"])
        if agent_cls is None:
            return self._finish(task, "failed", error=f"unknown agent '{task['agent']}'")

        agent = agent_cls()
        ctx = Context(task, self.store)

        while True:
            try:
                async with sem:
                    task["status"] = "running"
                    self.store.upsert(task)
                    result = await asyncio.wait_for(
                        agent.run(task["payload"], ctx), task.get("timeout")
                    )
                return self._finish(task, "done", result=result)

            except asyncio.CancelledError:
                # Ctrl+C or shutdown: leave the task resumable, not failed.
                task["status"] = "pending"
                self.store.upsert(task)
                raise

            except Exception as exc:  # retry anything the agent raised
                task["attempts"] += 1
                ctx.log(f"attempt {task['attempts']} failed: {exc!r}")
                if task["attempts"] > task["max_retries"]:
                    return self._finish(task, "failed", error=repr(exc))
                await asyncio.sleep(self.backoff_base ** task["attempts"])

    def _finish(self, task: dict, status: str, result=None, error=None):
        task.update(status=status, result=result, error=error)
        self.store.upsert(task)
        return task
