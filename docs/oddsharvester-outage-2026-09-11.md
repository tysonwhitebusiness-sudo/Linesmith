# OddsHarvester: ten days of silent zero, and why

**Audited 2026-09-11.** Folded into Phase 5 at the operator's request.

## What was wrong

Every OddsHarvester sport returned **0 records on every run since 2026-09-01**.
`harvester-scrape-mlb.log`: the last run with `records > 0` was
`Tue 09/01/2026 03:04:41`; the 78 runs after it all log
`No match links found for upcoming matches`. Same for tennis, cfb, nfl,
soccer_epl, soccer_mls.

The job returns `{'ok': True}` on those runs, because from its own point of
view it completed. Nothing raised, nothing paged, and the scraper kept running
on schedule for ten days producing nothing.

## The diagnosis, and it is NOT what the check said

The health record read *"possible anti-bot block"*. That is wrong, and the
wrongness is expensive: it points at proxies and residential IPs, which is a
fortnight of work in the wrong direction.

Measured from the operator's own machine and IP, 2026-09-11:

| check | result |
|---|---|
| `GET /matches/baseball/20260911/` | **HTTP 200**, 698,907 bytes |
| `GET /baseball/2026-09-11/` | **HTTP 200**, 698,907 bytes |
| `GET /baseball/usa/mlb/` | **HTTP 200**, 576,137 bytes |
| team names in that HTML | Astros, Dodgers, Guardians, Mariners, Yankees |
| `data-testid` occurrences | **0** |
| `game-row` occurrences | **0** |

**The site is serving us the fixtures perfectly well.** What changed is the
markup: OddsPortal rebuilt its frontend (Next.js App Router, Tailwind utility
classes, `self.__next_f` streaming payload) and **removed every `data-testid`
attribute**. The vendored scraper keys its entire selector layer on those —
`LISTING_ROW_SELECTOR = "div[data-testid='game-row']"` and 28 more. It loads a
good page full of matches and finds nothing, because it is looking for markup
that no longer exists.

A URL change happened too — `/matches/{sport}/{YYYYMMDD}/` now redirects to
`/{sport}/{YYYY-MM-DD}/` — but the redirect is followed and returns 200, so it
is not the cause on its own.

## The fix: upgrade the vendored package

**Upstream already did this work.** `jordantete/OddsHarvester`:

| | vendored | upstream |
|---|---|---|
| version | **0.10.0** (2026-08-07) | **v0.12.0** (2026-09-03) |
| `LISTING_ROW_SELECTOR` | `div[data-testid='game-row']` | `a[href*="/h2h/"]` |
| `data-testid` uses | **29** | **1** |

The timeline is the whole story: we broke on **09-01**, upstream shipped
**v0.11.0 on 09-02** and **v0.12.0 on 09-03**. They hit the same site change and
rewrote the selectors away from `data-testid` onto structural/href hooks.

**The upgrade is low-risk because our coupling is four imports**, and all four
still exist at v0.12.0 (verified, HTTP 200 on each path):

```
oddsharvester.core.playwright_manager          PlaywrightManager
oddsharvester.core.market_extraction.line_tokens  line_name_to_token
oddsharvester.core.scraper_app                 run_scraper
oddsharvester.utils.command_enum               CommandEnum
```

`run_scraper`'s signature is **identical** across 0.10.0 and v0.12.0 for all 23
parameters we pass, including `CommandEnum.UPCOMING_MATCHES` with `match_links`.

### Steps

1. Re-vendor `oddsharvester/` at tag `v0.12.0`, preserving the existing
   `.gitignore` exclusions (`oddsharvester/.venv/`,
   `oddsharvester/tests/integration/fixtures/**/*.har`).
2. Run one sport by hand and confirm non-zero records:
   `.venv/Scripts/python.exe src/harvester_scrape.py mlb`
3. Check `job_health_checks` flips `oddsharvester_scrape_mlb` to healthy.
4. Repeat for one weekly sport (nfl or cfb) — those exercise the
   `kickoff_within_hours` path rather than same-day.

### If the upgrade is not enough

The fallback is better than the current selectors and worth knowing about:
**the listing pages carry schema.org JSON-LD**. Parsed from
`/baseball/usa/mlb/` on 2026-09-11 it yielded **32 `SportsEvent` records**, each
with exactly what link-discovery needs:

```
2026-09-11T18:20:00.000Z  Chicago Cubs - Pittsburgh Pirates
  https://www.oddsportal.com/baseball/h2h/chicago-cubs-.../pittsburgh-pirates-.../
```

That is `startDate`, `name` and the match `url` — kickoff time and link, over
plain HTTP with no browser at all. Structured data exists for SEO, so it is far
more stable than presentational markup.

Two caveats, both measured:
- It appears on **league** pages (`/baseball/usa/mlb/`), not date pages
  (`/baseball/2026-09-11/` yields 0). `SCRAPE_CONFIG` already declares
  `leagues=[...]` per sport, so the config already has what is needed.
- It covers link discovery **only**. Match pages carry no bookmaker names in
  their served HTML (279 KB, zero occurrences of any book) — odds load
  client-side, so odds extraction still needs a browser.

## The two things that let it hide for ten days

Both fixed in this session.

**1. The health message guessed a cause it could not see.** `harvester_scrape.py`
now reports the observable facts — games were scheduled, the scrape parsed
nothing — and gives the one command that separates a block from a markup
change, instead of asserting "anti-bot block".

**2. Nothing read the harvester's health.** It writes per-sport rows to
`job_health_checks` on every run, and had been writing `healthy=false` for ten
days. But `health_check.check_job` walks `JOB_REGISTRY`, and the harvester is
**not in JOB_REGISTRY** — it runs as a Windows scheduled task on the operator's
machine, not on the Render worker. The rows existed; nothing consumed them; the
exit code never saw them. `check_harvester_scrapes` now reads them and covers
both failure shapes: **unhealthy** (ran, parsed nothing) and **stale** (has not
reported in 6h, so the scheduled task itself is dead).

That second one is the more important lesson. This is the same class of gap as
`orphanJobBreadcrumbs`: **monitoring that enumerates one registry cannot see
anything outside it**, and a producer writing diligently into a table nobody
reads is indistinguishable from silence.

## Postscript: the upgrade fixed five sports, and exposed three more things

Measured after re-vendoring at v0.12.0, same day.

| sport | result |
|---|---|
| mlb | 15 records, **15/15 matched** |
| nfl | 15 records, **15/15 matched** |
| soccer_mls | 15 records, **15/15 matched** |
| soccer_epl | 20 records, **20/20 matched** |
| tennis | 18 records, 4 matched, 12 unmatched |
| cfb | **still failing** — `discovery pass exceeded 1800s` |
| nba, nhl | `no games loaded from snapshot` — out of season, expected |

### 1. cfb: narrowing the kickoff window was the wrong fix

An earlier attempt set cfb's `kickoff_hours` to 54.0, expecting fewer page
visits. It bought **nothing**, and the league listing says why:

```
 24h ->  22 matches       54h ->  85 matches
 30h ->  75 matches      168h ->  85 matches
```

The Saturday slate lands inside 30h, so 54h and 168h discover the **identical
85 matches**. The cost is driven by one day's fixture list, not by how far
ahead we look. 85 pages at >21s is ~1,785s against an 1,800s budget.

The real problem is ordering: the discovery pass opens **one page per match
across the whole league** and only *afterwards* discards every match with no
real reference price to aim at. cfb's log is full of `discovery found no lines
close enough to any real reference`, i.e. the expensive pass routinely
completes and produces nothing.

**The fix filters before the cost, not after it.** The league listing page
carries schema.org JSON-LD — one plain HTTP GET, no browser — with `name`,
`url` and `startDate` per match, which is exactly enough to decide whether a
page is worth opening. `_reference_backed_links` now does that, and discovery
receives `match_links` instead of a whole league.

One trap worth recording: **`@type` is the list `["Event", "SportsEvent"]`, not
the string `"SportsEvent"`.** Testing it as a string finds 0 records on a page
carrying 153, which reads exactly like "the site stopped publishing structured
data" — a false negative that looks like a site change.

A second: the league key alone is not unique across sports. `ncaa` exists under
both `american-football` and `basketball`, so the URL lookup must be scoped by
the target's own sport or college football goes looking for its fixtures in a
basketball listing.

### 2. soccer_epl was being served Polish, and nobody could tell

All 10 EPL match pages logged `DOM parse failed for match_date: time data
'13 Wrz 2026 08:00' does not match format '%d %b %Y %H:%M'`. `Wrz` is
*wrzesień* — September. `%b` is C-locale English, so every date failed, fell
back, and the run still reported `ok / 20 matched`. A silent degradation behind
a healthy summary.

Worse, and unrelated to locale: **`timezone_id` was unpinned**, so
`PlaywrightManager` asked the browser what zone it was in and
`_parse_match_date_from_dom` interpreted every scraped wall-clock time in
whatever came back. Kickoff times depended on the operator machine's clock
settings.

Both are now pinned at **our** call sites (`BROWSER_LOCALE = "en-GB"`,
`BROWSER_TIMEZONE = "UTC"` in `harvester_scrape.py`) rather than in the
vendored tree, so the v0.12.0 files stay byte-identical to upstream. `run_scraper`
already exposed `browser_locale_timezone` and `browser_timezone_id`; we were
simply passing neither.

### 3. tennis's 12 unmatched is unproven, not benign

Every tennis run before the upgrade was `records: 0`, so there is **no
pre-outage baseline** to compare against — the 12/18 unmatched rate cannot be
called "pre-existing" on the evidence available. The unmatched names
(`Augusto dos Santos R.`, `Kokkinis T.`, `Khomutsianskaya D.`) are
ITF/challenger-tier, which *suggests* the date-page path scrapes a broader
universe than our 1,400-game reference list covers — a scope mismatch rather
than a parsing failure. That is an inference from the names, not a measurement.
