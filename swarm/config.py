"""Reads and writes swarm.config.json. Missing keys fall back to defaults."""

import json
from pathlib import Path

CONFIG_PATH = Path("swarm.config.json")

DEFAULTS = {
    "name": "my-swarm",
    "data_dir": "data",
    "concurrency": 4,
    "max_retries": 3,
}


def load_config(path=CONFIG_PATH) -> dict:
    cfg = dict(DEFAULTS)
    p = Path(path)
    if p.exists():
        cfg.update(json.loads(p.read_text()))
    return cfg


def save_config(cfg: dict, path=CONFIG_PATH):
    Path(path).write_text(json.dumps(cfg, indent=2) + "\n")
