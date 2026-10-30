"""A long-running agent that checkpoints every step.

Payload:
    steps (int):  how many steps to run (default 10)
    delay (float): seconds per step (default 1.0)

Kill it halfway through and run `python main.py run` again: it picks up at
the last saved step instead of starting over. This is the pattern to use for
tasks that run for hours.
"""

import asyncio

from swarm import Agent, register


@register("counter")
class CounterAgent(Agent):
    """Long-running, checkpointed counter. Resumes after crashes."""

    async def run(self, payload, ctx):
        steps = int(payload.get("steps", 10))
        delay = float(payload.get("delay", 1.0))

        start = ctx.state.get("i", 0)
        if start:
            ctx.log(f"resuming from step {start}")

        for i in range(start, steps):
            await asyncio.sleep(delay)   # stand-in for real work
            ctx.checkpoint(i=i + 1)      # save progress after each step

        return {"completed_steps": steps}
