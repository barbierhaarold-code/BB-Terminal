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

## `openbb_nasdaq-economic-calendar-date-offset.patch`

**Why:** Nasdaq's free `economicevents?date=D` endpoint (the only no-key
economic-calendar provider) files **every** event under `D = its real
release date + 1 calendar day`. Audited feed-wide: ~25 US indicators
(PPI, jobless claims, Treasury auctions, EIA petroleum/gas, Fed H.4.1,
NFIB, Consumer Credit, MBA…) plus non-US anchors that can't legitimately
move (Canada Labour Day, Brazil Independence Day, Bank of Russia rate
decision, CFTC COT, UK ONS monthly GDP, ECB decision) — two weeks
including a non-holiday week, zero exceptions. The offset is inside
Nasdaq's data, not OpenBB and not the app: the raw rows carry no date
field at all, only the query-date bucket. Unpatched, the terminal's Econ
Calendar shows every release a day late, and because upstream also skips
weekend buckets, real Friday releases (monthly jobs report, CPI, Michigan
sentiment) land in Nasdaq's Saturday bucket and are dropped entirely.

**What it does:** in `economic_calendar.py` — (1) subtracts one day from
every row's date in `aextract_data` via a new `_corrected_datetime()`
helper (keeps upstream's All Day / Tentative / 24H handling), (2) fetches
one extra trailing day and no longer excludes weekend buckets, so the
last requested day's events (which live in Nasdaq's next-day bucket) are
recovered, (3) clamps the result back to the caller's requested
`[start_date, end_date]`. Applies to every consumer at once — the UI
panel and the copilot's `get_econ_calendar` tool both go through this
fetcher.

**Applying it:** `setup.sh` runs this automatically after the yfinance
patch, and skips re-applying if the marker (`_corrected_datetime`) is
already present.

**Re-verify after any `openbb` bump:** the audit's negative control
(FOMC Barkin, EIA Crude Oil Inventories) is stale — this audit found EIA
Crude Oil Inventories *is* shifted +1 like everything else. FOMC Barkin
still hasn't been re-checked against a real FOMC week. Do that the next
time an FOMC meeting falls in the queried window, and confirm the offset
is still a uniform +1 (not, say, reverted or doubled) before trusting a
re-generated patch.

**Bumping the `openbb-yfinance` pin:** the patch's line numbers and context
are specific to `1.6.3`. If you bump the pin in `setup.sh`, regenerate the
patch against the new version's `options_chains.py` — pull a pristine copy
(`pip install --no-deps --target=/tmp/pristine "openbb-yfinance==<new-version>"`),
diff it against a re-patched copy, and replace this file. Don't just bump
the version string and assume the old patch still applies cleanly.
