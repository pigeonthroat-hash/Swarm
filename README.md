# Swarm

Swarm is a lightweight framework for deploying **autonomous bots** that run
tasks on your own machine, work offline, and keep going for hours. It's
built for everyday, API-driven jobs such as booking a table, monitoring a
price, or processing a queue of items.

- **Zero dependencies.** Pure Python standard library.
- **Offline-first.** Tasks and their progress are stored in a local JSON file.
- **Built for long runs.** Every agent can checkpoint its progress. If the
  process stops, a restart resumes from the last checkpoint instead of starting over.
- **Pluggable.** Write an agent in one file and register it with a decorator.

---

## Requirements

- Python **3.10+**
- Git (to clone the repository)

No `pip install` is needed for the core framework.

## Quick start

```bash
git clone https://github.com/pigeonthroat-hash/Swarm.git
cd Swarm

python main.py init                 # interactive setup wizard
python main.py agents               # see what bots are available
python main.py submit echo --payload '{"hello": "world"}'
python main.py run                  # execute queued tasks
python main.py status               # check results
```

## The setup wizard

`python main.py init` asks a few questions and writes `swarm.config.json`:

| Setting | Meaning | Default |
|---|---|---|
| Swarm name | A label for this install | `my-swarm` |
| Data directory | Where `tasks.json` is stored | `data` |
| Concurrency | How many tasks run at once | `4` |
| Max retries | Retries before a task is marked `failed` | `3` |

Press Enter to accept any default. You can edit `swarm.config.json` by hand later.

## Running bots offline

Once the swarm is set up and the agents you need are installed, nothing
else requires a network connection. The task queue, checkpoints and results
all live in `data/tasks.json`.

1. **Queue work** while you're online or offline:
   ```bash
   python main.py submit counter --payload '{"steps": 3600, "delay": 1}'
   ```
2. **Run it** in a terminal, a `tmux` session, or as a background service:
   ```bash
   python main.py run
   ```
3. **Stop at any time** with `Ctrl+C`. Progress is saved.
4. **Resume** later with the same `python main.py run` command. Tasks that were
   running pick up from their last checkpoint.

For a process that should keep running after you close the terminal:

```bash
nohup python main.py run > swarm.log 2>&1 &
# or inside tmux / screen
```

Agents that call remote APIs will obviously need a connection when they make
those calls. Their queued work and saved progress still survive a loss of connectivity: a
failed call is retried with backoff, and the task waits for you to run it again if the
process has stopped.

## Commands

| Command | What it does |
|---|---|
| `python main.py init` | Setup wizard |
| `python main.py agents` | List registered agents and their descriptions |
| `python main.py submit <agent> [--payload JSON] [--timeout SECS]` | Queue a task |
| `python main.py run` | Run every unfinished task until it finishes or fails |
| `python main.py status` | Table of all tasks, their status and attempts |

`--timeout` sets a per-attempt limit. It's off by default, so long-running
tasks aren't cut short unless you ask for a limit.

## Built-in agents

| Agent | Payload | Purpose |
|---|---|---|
| `echo` | any JSON | Returns its input. Use it to test your install. |
| `counter` | `steps` (int), `delay` (seconds) | Long-running example that checkpoints every step. Use it to see resume behaviour. |
| `dining_booking` | `restaurant`, `party_size`, `when` | Books a table through a pluggable provider. **Uses a simulated provider by default**, so no real reservation is made. See below. |

Try the resume behaviour:

```bash
python main.py submit counter --payload '{"steps": 60, "delay": 1}'
python main.py run          # press Ctrl+C after about 20 seconds
python main.py run          # it resumes near step 20, not step 0
```

### Connecting a real booking API

`dining_booking` separates the workflow (validation, retries, a "don't book twice"
checkpoint) from the API call itself. To connect a real service, subclass
`BookingProvider` and set it on the agent. Put this in a file you import at startup,
such as `agents/my_provider.py`:

```python
from agents.dining import DiningAgent, BookingProvider

class MyRestaurantAPI(BookingProvider):
    async def book(self, restaurant, party_size, when):
        # call the real API here, using your own credentials from env vars
        # return a dict describing the confirmed booking
        ...

DiningAgent.provider = MyRestaurantAPI()
```

Keep API keys in environment variables, not in the repository.

## Web chat interface

Prefer a browser? Start the local web UI:

```bash
python main.py serve            # opens at http://127.0.0.1:8000
python main.py serve --port 9000
```

Plain text is sent to the `echo` agent. Slash commands reach the rest of the framework:

| Command | Does |
|---|---|
| `/agents` | list agents |
| `/submit <agent> [json]` | queue a task, e.g. `/submit counter {"steps": 5}` |
| `/status` | recent tasks |
| `/task <id>` | details for one task |
| `/help` | command list |

When you queue a task, the chat watches it and posts the result when it finishes.

The server listens on `127.0.0.1` (this machine only) by default. Only use
`--host 0.0.0.0` on a trusted network: there is no login yet, so anyone who can reach
the port can submit tasks.

## Writing your own agent

Create a file in `agents/` and register a class:

```python
# agents/price_watch.py
import asyncio
from swarm import Agent, register

@register("price_watch")
class PriceWatch(Agent):
    """Checks a price every N minutes and records the lowest value seen."""

    async def run(self, payload, ctx):
        item = payload["url"]
        lowest = ctx.state.get("lowest")          # saved by earlier attempts
        for _ in range(payload.get("checks", 100)):
            price = await fetch_price(item)        # your code
            if lowest is None or price < lowest:
                lowest = price
                ctx.checkpoint(lowest=lowest)      # survives a crash
                ctx.log(f"new low: {price}")
            await asyncio.sleep(payload.get("interval", 300))
        return {"lowest": lowest}
```

Then import it in `agents/__init__.py`:

```python
from . import echo, counter, dining, price_watch  # noqa: F401
```

### Rules for agents

1. **Raise an exception to signal failure.** The runner retries it with
   exponential backoff, up to `max_retries`.
2. **Save progress with `ctx.checkpoint(**state)`** before doing anything expensive
   or irreversible. Read it back from `ctx.state` on the next attempt.
3. **Return a JSON-serialisable dict** as the result.
4. **Use `ctx.log(message)`** for a human-readable history. It appears in `data/tasks.json`.
5. **Don't block the event loop.** Use `await asyncio.sleep` and async I/O. For CPU-heavy
   or blocking library calls, wrap them in `await asyncio.to_thread(fn, ...)`.

## How it works

```
main.py ──► Runner ──► asyncio tasks (bounded by concurrency)
              │             │
              │             └─► Agent.run(payload, ctx)
              │                     │
              │                     └─ ctx.checkpoint() / ctx.log()
              ▼
          TaskStore  ◄──────────────┘
        data/tasks.json   (atomic writes, survives crashes)
```

- **`swarm/agent.py`**: the `Agent` base class and the `@register` registry.
- **`swarm/runner.py`**: the async runner. Handles the concurrency limit, retries with
  backoff, timeouts, and cancellation (Ctrl+C leaves tasks resumable).
- **`swarm/store.py`**: a JSON task store. Writes go to a temporary file and are then
  swapped in, so a crash never corrupts the data.
- **`swarm/config.py`**: reads and writes `swarm.config.json`.
- **`main.py`**: the command-line interface and setup wizard.

Task states: `pending` → `running` → `done` or `failed`. A task that is interrupted
goes back to `pending` and is picked up by the next `run`.

## Running the tests

```bash
python -m unittest discover -s tests -v
```

The tests cover completion, unknown agents, checkpoint resume, no double booking,
retry limits, store persistence, chat commands, and the live HTTP endpoints.

## Roadmap

- Authentication for the web UI before exposing it beyond localhost
- Cron-style scheduling for recurring tasks ("every weekday at 7am")
- A `swarm logs <id>` command to tail a task's log
- Optional SQLite backend for very large queues
- Sandboxed secrets handling via a `.env` loader

## Project layout

```
Swarm/
├── main.py              # CLI and setup wizard
├── swarm/               # the framework
│   ├── agent.py         # Agent base class and registry
│   ├── runner.py        # async runner, retries, checkpoints
│   ├── store.py         # durable JSON task store
│   ├── chat.py          # chat command handling
│   ├── server.py        # local HTTP server and background worker
│   └── config.py        # swarm.config.json handling
├── agents/              # your bots (built-ins + yours)
├── web/index.html       # single-file chat interface
├── tests/               # unit tests
├── README.md
└── LICENSE
```

## License

See [LICENSE](LICENSE).
