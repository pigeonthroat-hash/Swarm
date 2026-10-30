#!/usr/bin/env python3
"""Swarm command line interface.

    python main.py init                          interactive setup wizard
    python main.py agents                        list available agents
    python main.py submit <agent> [--payload JSON] [--timeout SECS]
    python main.py run                           run all unfinished tasks
    python main.py status                        show every task
"""

import argparse
import asyncio
import json
import sys

from swarm import REGISTRY, Runner, TaskStore
from swarm.config import CONFIG_PATH, DEFAULTS, load_config, save_config
import agents  # noqa: F401  (registers the built-in agents)

BANNER = r"""
 ____  _
/ ___|| |_ __ _ _ __ _ __ ___
\___ \| __/ _` | '__| '_ ` _ \
 ___) | || (_| | |  | | | | | |
|____/ \__\__,_|_|  |_| |_| |_|
   autonomous bots, offline-first
"""


def _ask(prompt: str, default):
    raw = input(f"{prompt} [{default}]: ").strip()
    return raw or default


def _store_and_runner(cfg):
    store = TaskStore(f"{cfg['data_dir']}/tasks.json")
    runner = Runner(store, concurrency=cfg["concurrency"], max_retries=cfg["max_retries"])
    return store, runner


def cmd_init(_args):
    print(BANNER)
    print("Let's set up your swarm. Press Enter to accept the defaults.\n")
    cfg = dict(DEFAULTS)
    cfg["name"] = _ask("Swarm name", cfg["name"])
    cfg["data_dir"] = _ask("Where should task data be stored", cfg["data_dir"])
    cfg["concurrency"] = int(_ask("How many tasks may run at once", cfg["concurrency"]))
    cfg["max_retries"] = int(_ask("Retries before a task is marked failed", cfg["max_retries"]))
    save_config(cfg)
    TaskStore(f"{cfg['data_dir']}/tasks.json")
    print(f"\nSaved {CONFIG_PATH}. Next try:")
    print("  python main.py submit echo --payload '{\"hello\": \"world\"}'")
    print("  python main.py run")


def cmd_agents(_args):
    if not REGISTRY:
        print("No agents registered.")
        return
    for name, cls in sorted(REGISTRY.items()):
        doc = (cls.__doc__ or "").strip().splitlines()
        print(f"  {name:<16} {doc[0] if doc else ''}")


def cmd_submit(args):
    cfg = load_config()
    store, runner = _store_and_runner(cfg)
    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError as exc:
        sys.exit(f"--payload is not valid JSON: {exc}")
    try:
        task = runner.submit(args.agent, payload, timeout=args.timeout)
    except ValueError as exc:
        sys.exit(str(exc))
    print(f"queued task {task['id']} ({args.agent}). Run `python main.py run` to execute.")


def cmd_run(_args):
    cfg = load_config()
    store, runner = _store_and_runner(cfg)
    pending = store.unfinished()
    if not pending:
        print("Nothing to run.")
        return
    print(f"Running {len(pending)} task(s). Ctrl+C is safe: progress is saved.")
    try:
        asyncio.run(runner.run_pending())
    except KeyboardInterrupt:
        print("\nStopped. Run again to resume.")
        return
    counts = {}
    for t in store.all():
        counts[t["status"]] = counts.get(t["status"], 0) + 1
    print("Finished. " + ", ".join(f"{k}: {v}" for k, v in sorted(counts.items())))


def cmd_status(_args):
    cfg = load_config()
    store, _ = _store_and_runner(cfg)
    tasks = store.all()
    if not tasks:
        print("No tasks yet.")
        return
    print(f"{'ID':<14}{'AGENT':<16}{'STATUS':<10}{'ATTEMPTS':<9}UPDATED")
    for t in tasks:
        print(f"{t['id']:<14}{t['agent']:<16}{t['status']:<10}{t['attempts']:<9}{t['updated']}")


def build_parser():
    p = argparse.ArgumentParser(prog="swarm", description="Run autonomous bot tasks.")
    sub = p.add_subparsers(dest="command", required=True)

    sub.add_parser("init", help="interactive setup wizard").set_defaults(func=cmd_init)
    sub.add_parser("agents", help="list available agents").set_defaults(func=cmd_agents)
    sub.add_parser("run", help="run all unfinished tasks").set_defaults(func=cmd_run)
    sub.add_parser("status", help="show all tasks").set_defaults(func=cmd_status)

    s = sub.add_parser("submit", help="queue a task for an agent")
    s.add_argument("agent")
    s.add_argument("--payload", default="{}", help="JSON payload for the agent")
    s.add_argument("--timeout", type=float, default=None,
                   help="optional per-attempt timeout in seconds (default: none)")
    s.set_defaults(func=cmd_submit)
    return p


def main():
    args = build_parser().parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
