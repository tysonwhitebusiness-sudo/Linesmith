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
