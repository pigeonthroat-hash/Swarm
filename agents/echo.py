"""The simplest possible agent. Use it to check your install works."""

import asyncio

from swarm import Agent, register


@register("echo")
class EchoAgent(Agent):
    """Returns whatever payload it receives. Good for testing your install."""

    async def run(self, payload, ctx):
        ctx.log("echoing payload")
        await asyncio.sleep(0)
        return {"echo": payload}
