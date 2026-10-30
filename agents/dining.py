"""Dining booking agent.

The agent handles validation, retries and checkpointing. The actual API call
is delegated to a BookingProvider, so you can plug in any restaurant booking
API without touching the agent.

By default a SimulatedProvider is used, which returns a fake confirmation.
Replace it with a real provider once you have API credentials:

    from agents.dining import DiningAgent, BookingProvider

    class OpenTableProvider(BookingProvider):
        async def book(self, restaurant, party_size, when):
            ...  # call the real API here and return a dict

    DiningAgent.provider = OpenTableProvider()
"""

import asyncio
import uuid

from swarm import Agent, register


class BookingProvider:
    """Subclass this and implement `book` for a real booking API."""

    async def book(self, restaurant: str, party_size: int, when: str) -> dict:
        raise NotImplementedError


class SimulatedProvider(BookingProvider):
    async def book(self, restaurant, party_size, when):
        await asyncio.sleep(0.1)
        return {
            "confirmed": True,
            "restaurant": restaurant,
            "party_size": party_size,
            "when": when,
            "confirmation_id": uuid.uuid4().hex[:8].upper(),
            "simulated": True,
        }


@register("dining_booking")
class DiningAgent(Agent):
    """Books a table via a pluggable provider (simulated by default)."""

    provider: BookingProvider = SimulatedProvider()

    async def run(self, payload, ctx):
        restaurant = payload.get("restaurant")
        party_size = payload.get("party_size")
        when = payload.get("when")

        if not restaurant or not party_size or not when:
            raise ValueError("payload needs 'restaurant', 'party_size' and 'when'")

        if ctx.state.get("booking"):
            ctx.log("booking already confirmed in a previous attempt")
            return ctx.state["booking"]

        ctx.log(f"booking {party_size} at {restaurant} for {when}")
        booking = await self.provider.book(restaurant, int(party_size), when)
        ctx.checkpoint(booking=booking)  # never book twice after a crash
        return booking
