"""Run with: python -m unittest discover -s tests -v"""

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swarm import Agent, Runner, TaskStore, register  # noqa: E402
import agents  # noqa: E402,F401  (registers built-ins)


@register("_always_fails")
class AlwaysFails(Agent):
    calls = 0

    async def run(self, payload, ctx):
        AlwaysFails.calls += 1
        raise RuntimeError("boom")


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "tasks.json"

    def tearDown(self):
        self.tmp.cleanup()

    def make_runner(self, **kw):
        kw.setdefault("backoff_base", 0)
        return Runner(TaskStore(self.path), **kw)

    def test_echo_task_completes(self):
        r = self.make_runner()
        task = r.submit("echo", {"hi": 1})
        asyncio.run(r.run_pending())
        done = r.store.get(task["id"])
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["result"], {"echo": {"hi": 1}})

    def test_unknown_agent_rejected(self):
        with self.assertRaises(ValueError):
            self.make_runner().submit("nope")

    def test_counter_resumes_from_checkpoint(self):
        r = self.make_runner()
        task = r.submit("counter", {"steps": 5, "delay": 0})
        # Simulate a crash after 3 steps were saved.
        task["checkpoint"] = {"i": 3}
        task["status"] = "running"
        r.store.upsert(task)

        asyncio.run(r.run_pending())
        done = r.store.get(task["id"])
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["checkpoint"]["i"], 5)
        self.assertTrue(any("resuming from step 3" in line for line in done["log"]))

    def test_dining_does_not_rebook_after_crash(self):
        r = self.make_runner()
        task = r.submit("dining_booking", {"restaurant": "Cafe", "party_size": 2, "when": "19:00"})
        task["checkpoint"] = {"booking": {"confirmed": True, "confirmation_id": "ABC"}}
        r.store.upsert(task)

        asyncio.run(r.run_pending())
        done = r.store.get(task["id"])
        self.assertEqual(done["result"]["confirmation_id"], "ABC")

    def test_failing_agent_retries_then_fails(self):
        AlwaysFails.calls = 0
        r = self.make_runner(max_retries=2)
        task = r.submit("_always_fails")
        asyncio.run(r.run_pending())
        done = r.store.get(task["id"])
        self.assertEqual(done["status"], "failed")
        self.assertEqual(AlwaysFails.calls, 3)  # 1 try + 2 retries

    def test_store_survives_reload(self):
        r = self.make_runner()
        task = r.submit("echo", {"x": 1})
        reloaded = TaskStore(self.path)
        self.assertIsNotNone(reloaded.get(task["id"]))


if __name__ == "__main__":
    unittest.main()
