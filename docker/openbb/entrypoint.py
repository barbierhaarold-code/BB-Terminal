"""OpenBB API launcher that survives a slow or failing external source at boot.

Why: openbb-cftc registers a FastAPI lifespan hook (`build_choices`) that does a
live network fetch of the CFTC contract list while the app is starting. When
that request timed out, the exception aborted app startup and openbb-api exited.

What this does: replaces that one startup hook with a version that
  1. gives the fetch a hard timeout,
  2. on any failure logs a warning and lets the API come up anyway
     (the CFTC choices list is only a Workspace UI convenience; this terminal
     never uses it), and
  3. retries in the background with growing delays, so it fills in later.
Nothing else is changed. Docker's `restart: unless-stopped` still covers any
other crash.
"""
import asyncio
import logging
import os
import sys

log = logging.getLogger("openbb-entrypoint")
logging.basicConfig(level=logging.INFO, format="[openbb-entrypoint] %(message)s")

FIRST_TIMEOUT_S = float(os.environ.get("CFTC_BOOT_TIMEOUT_S", "15"))
RETRY_DELAYS_S = [30, 60, 120, 300, 600, 900]

_tasks: set = set()  # keep references so background retries are not garbage-collected


def _patch_cftc() -> None:
    try:
        import openbb_cftc.cftc_router as cftc
    except Exception as exc:  # extension not installed: nothing to patch
        log.info("openbb_cftc not importable (%s); nothing to patch", exc)
        return

    original = cftc.build_choices

    async def _retry_later() -> None:
        for delay in RETRY_DELAYS_S:
            await asyncio.sleep(delay)
            try:
                await asyncio.wait_for(original(), timeout=60)
                log.info("CFTC contract list loaded on retry")
                return
            except Exception as exc:
                log.warning("CFTC retry failed (%s: %s); next try later", type(exc).__name__, exc)
        log.warning("giving up on CFTC contract list; API keeps running without it")

    async def resilient_build_choices() -> None:
        try:
            await asyncio.wait_for(original(), timeout=FIRST_TIMEOUT_S)
        except Exception as exc:
            log.warning(
                "CFTC contract fetch failed at boot (%s: %s); starting anyway, retrying in background",
                type(exc).__name__, exc,
            )
            task = asyncio.get_running_loop().create_task(_retry_later())
            _tasks.add(task)
            task.add_done_callback(_tasks.discard)

    # The lifespan calls build_choices() by module-global name at startup, so rebinding it is enough.
    cftc.build_choices = resilient_build_choices
    log.info("CFTC boot hook made failure-tolerant")


if __name__ == "__main__":
    _patch_cftc()
    # openbb_platform_api.main parses sys.argv at IMPORT time, so set it first.
    sys.argv = ["openbb-api", *sys.argv[1:]]
    from openbb_platform_api.main import main

    sys.exit(main())
