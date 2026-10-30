"""Base class and registry for Swarm agents."""

from abc import ABC, abstractmethod

# name -> Agent subclass. Populated by the @register decorator.
REGISTRY: dict = {}


def register(name: str):
    """Class decorator that makes an agent available to the CLI and runner."""

    def decorator(cls):
        if not issubclass(cls, Agent):
            raise TypeError(f"{cls.__name__} must subclass swarm.Agent")
        cls.name = name
        REGISTRY[name] = cls
        return cls

    return decorator


class Agent(ABC):
    """An autonomous worker.

    Implement `run`. Use `ctx.state` to read progress saved by earlier
    attempts, and `ctx.checkpoint(**state)` to save progress as you go.
    Anything saved this way survives crashes and restarts.
    """

    name: str = "base"

    @abstractmethod
    async def run(self, payload: dict, ctx) -> dict:
        """Do the work and return a JSON-serialisable result dict."""
