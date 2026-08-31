"""Pull config.json from each seeded model's Hugging Face repo.

Adapted from llm-specs-pipeline's ingest/huggingface.py, scoped down to the
repos listed in models.seed.yaml (no epoch/ECI ingest). Configs are cached
under pipeline/.cache/hf_configs/ so re-runs within the cache TTL don't
re-hit the network; build_catalog.py decides what "stale" means for a
model whose pull fails.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from huggingface_hub import hf_hub_download
from huggingface_hub.errors import EntryNotFoundError, RepositoryNotFoundError
from loguru import logger

CACHE_DIR = Path(__file__).resolve().parent.parent.parent / ".cache" / "hf_configs"


def _slugify(repo_id: str) -> str:
    """'meta-llama/Llama-3.1-70B' -> 'meta-llama__Llama-3.1-70B' (filesystem-safe)."""
    return repo_id.replace("/", "__")


class HfPullError(Exception):
    """Raised when a repo's config.json could not be fetched or read."""


def fetch_config(repo_id: str, cache_dir: Path = CACHE_DIR, force: bool = False) -> dict[str, Any]:
    """Fetch and parse one repo's config.json, raising HfPullError on any failure.

    Callers (build_catalog.py) are expected to catch this per-model and
    fall back to the previous catalog entry rather than letting one bad
    repo id abort the whole sync.
    """
    slug = _slugify(repo_id)
    dest = cache_dir / f"{slug}.json"

    if dest.exists() and not force:
        logger.debug("cache hit: {}", repo_id)
        return _read_json(dest)

    try:
        cached_path = hf_hub_download(repo_id=repo_id, filename="config.json")
    except RepositoryNotFoundError as e:
        raise HfPullError(f"repo not found: {repo_id}") from e
    except EntryNotFoundError as e:
        raise HfPullError(f"no config.json in repo: {repo_id}") from e
    except Exception as e:
        raise HfPullError(f"failed to fetch {repo_id}: {type(e).__name__}: {e}") from e

    cache_dir.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(Path(cached_path).read_bytes())
    logger.info("Fetched {}", repo_id)
    return _read_json(dest)


def _read_json(path: Path) -> dict[str, Any]:
    try:
        parsed: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
        return parsed
    except json.JSONDecodeError as e:
        raise HfPullError(f"invalid JSON in cached {path.name}: {e}") from e
