"""Built-in agents. Importing this package registers them.

Add your own by creating a module here (or anywhere you import from) and
decorating an Agent subclass with @register("your_name").
"""

from . import echo, counter, dining  # noqa: F401
