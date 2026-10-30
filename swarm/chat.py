"""Chat command handling for the web UI.

Plain text runs the echo agent. Slash commands expose the rest of the framework:

    /help                    show commands
    /agents                  list agents
    /submit <agent> [json]   queue a task
    /status                  list recent tasks
    /task <id>               show one task
"""

import json

from .agent import REGISTRY

HELP = (
    "/agents                  list agents\n"
    "/submit <agent> [json]   queue a task\n"
    "/status                  recent tasks\n"
    "/task <id>               details for one task\n"
    "/help                    this message\n\n"
    "Plain text is sent to the echo agent."
)


def _summary(task: dict) -> str:
    line = f"{task['id']}  {task['agent']}  {task['status']}"
    if task.get("attempts"):
        line += f"  (attempts: {task['attempts']})"
    return line


def handle(message: str, runner, wake) -> dict:
    """Return a reply dict: {"text": str, "task_id": optional str}.

    `wake` is called after queuing a task so the background worker runs it.
    """
    text = (message or "").strip()
    if not text:
        return {"text": "Type a message, or /help for commands."}

    if text == "/help":
        return {"text": HELP}

    if text == "/agents":
        return {"text": "\n".join(f"{name}" for name in sorted(REGISTRY)) or "No agents registered."}

    if text == "/status":
        tasks = runner.store.all()[-10:]
        if not tasks:
            return {"text": "No tasks yet."}
        return {"text": "\n".join(_summary(t) for t in reversed(tasks))}

    if text.startswith("/task"):
        parts = text.split()
        if len(parts) != 2:
            return {"text": "Usage: /task <id>"}
        task = runner.store.get(parts[1])
        if task is None:
            return {"text": f"No task {parts[1]}."}
        return {"text": _summary(task), "task_id": task["id"]}

    if text.startswith("/submit"):
        parts = text.split(maxsplit=2)
        if len(parts) < 2:
            return {"text": "Usage: /submit <agent> [json payload]"}
        agent = parts[1]
        payload = {}
        if len(parts) == 3:
            try:
                payload = json.loads(parts[2])
            except json.JSONDecodeError as exc:
                return {"text": f"Payload is not valid JSON: {exc.msg}"}
        return _queue(runner, wake, agent, payload)

    if text.startswith("/"):
        return {"text": f"Unknown command. Try /help."}

    return _queue(runner, wake, "echo", {"message": text})


def _queue(runner, wake, agent: str, payload: dict) -> dict:
    try:
        task = runner.submit(agent, payload)
    except ValueError as exc:
        return {"text": str(exc)}
    wake()
    return {"text": f"Queued {agent} as {task['id']}.", "task_id": task["id"]}
