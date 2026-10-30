"""Run with: python -m unittest discover -s tests -v"""

import json
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from swarm import Runner, TaskStore  # noqa: E402
from swarm.chat import handle  # noqa: E402
from swarm.server import build_server  # noqa: E402
import agents  # noqa: E402,F401


class ChatTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runner = Runner(TaskStore(Path(self.tmp.name) / "t.json"), backoff_base=0)
        self.woken = []
        self.wake = lambda: self.woken.append(True)

    def tearDown(self):
        self.tmp.cleanup()

    def test_help_and_agents(self):
        self.assertIn("/submit", handle("/help", self.runner, self.wake)["text"])
        self.assertIn("echo", handle("/agents", self.runner, self.wake)["text"])

    def test_plain_text_queues_echo_and_wakes_worker(self):
        reply = handle("hello there", self.runner, self.wake)
        self.assertTrue(reply["text"].startswith("Queued echo"))
        self.assertIn("task_id", reply)
        self.assertEqual(self.runner.store.get(reply["task_id"])["payload"], {"message": "hello there"})
        self.assertTrue(self.woken)

    def test_submit_with_json_payload(self):
        reply = handle('/submit counter {"steps": 2}', self.runner, self.wake)
        task = self.runner.store.get(reply["task_id"])
        self.assertEqual(task["agent"], "counter")
        self.assertEqual(task["payload"], {"steps": 2})

    def test_submit_bad_json_and_unknown_agent(self):
        self.assertIn("not valid JSON", handle("/submit echo {nope", self.runner, self.wake)["text"])
        self.assertIn("unknown agent", handle("/submit ghost", self.runner, self.wake)["text"])

    def test_unknown_command(self):
        self.assertIn("Unknown command", handle("/wat", self.runner, self.wake)["text"])

    def test_empty_message(self):
        self.assertIn("Type a message", handle("   ", self.runner, self.wake)["text"])


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        runner = Runner(TaskStore(Path(cls.tmp.name) / "t.json"), backoff_base=0)
        cls.server = build_server(runner, port=0)
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.tmp.cleanup()

    def _get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return r.status, r.headers.get("Content-Type"), r.read()

    def _post(self, path, obj):
        req = urllib.request.Request(
            self.base + path, data=json.dumps(obj).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read())

    def test_index_served(self):
        status, ctype, body = self._get("/")
        self.assertEqual(status, 200)
        self.assertIn("text/html", ctype)
        self.assertIn(b"<title>Swarm</title>", body)

    def test_chat_round_trip_and_task_completes(self):
        reply = self._post("/api/chat", {"message": "ping"})
        self.assertTrue(reply["text"].startswith("Queued echo"))
        task_id = reply["task_id"]
        for _ in range(50):
            _, _, body = self._get(f"/api/tasks/{task_id}")
            task = json.loads(body)
            if task["status"] == "done":
                break
            time.sleep(0.1)
        self.assertEqual(task["status"], "done")
        self.assertEqual(task["result"], {"echo": {"message": "ping"}})

    def test_agents_and_unknown_routes(self):
        _, _, body = self._get("/api/agents")
        self.assertIn("echo", json.loads(body)["agents"])
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self._get("/nope")
        self.assertEqual(ctx.exception.code, 404)

    def test_invalid_json_rejected(self):
        req = urllib.request.Request(self.base + "/api/chat", data=b"{bad",
                                     headers={"Content-Type": "application/json"}, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 400)


if __name__ == "__main__":
    unittest.main()
