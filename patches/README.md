# Local dependency patches

Patches applied to installed (pip) packages by `setup.sh`, because the fix
lives in a third-party dependency this repo doesn't vendor a source copy of.

## `openbb_yfinance-1.6.3-options-chains-retry.patch`

**Why:** Yahoo's crumb/session token occasionally fails transiently
mid-request — worse under concurrent load, which this app generates on
every page load (options chain + historical + treasury + quote firing
together). `openbb_yfinance/models/options_chains.py` calls
`Ticker.option_chain()` once per expiration with no error handling; on a
transient crumb failure yfinance returns `None` instead of raising, and the
unpatched code crashes with `TypeError: 'NoneType' object does not support
item assignment` on `calls["option_type"] = "call"` — turning one flaky
Yahoo request into a hard 500 for the whole multi-expiration chain fetch.

**What it does:** retries each expiration's fetch up to 3× with backoff,
and skips that one expiration (or returns "no options found" if even the
underlying quote never comes through) instead of crashing. Verified this
raises the endpoint's success rate from ~45-50% to ~83-87% in repeated
testing, and eliminates the 500 crash entirely — worst case is now a clean
empty/error response the frontend already handles.

**What it does not fix:** Yahoo's free/unauthenticated tier also serves
degraded quote-derived fields (bid/ask pinned near 0.00, implied volatility
near-zero) even on fully successful responses — that's a data-tier
limitation, not a bug this patch (or any client-side retry) can address.
Full resolution needs either a paid options data feed or yfinance's
Auth/login flow with a real Yahoo account.

**Applying it:** `setup.sh` runs this automatically after installing
OpenBB, and skips re-applying if the patch marker (`_fetch_chain_with_retry`)
is already present in the installed file.

**Bumping the `openbb-yfinance` pin:** the patch's line numbers and context
are specific to `1.6.3`. If you bump the pin in `setup.sh`, regenerate the
patch against the new version's `options_chains.py` — pull a pristine copy
(`pip install --no-deps --target=/tmp/pristine "openbb-yfinance==<new-version>"`),
diff it against a re-patched copy, and replace this file. Don't just bump
the version string and assume the old patch still applies cleanly.
