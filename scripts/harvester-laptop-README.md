# Running OddsHarvester on a dedicated laptop

GitHub Actions' shared runner IPs get a hard HTTP 429 from OddsPortal (confirmed
live, 2026-08-25) — not fixable in code, a genuine IP-level block. This runs the
same scraper (`python-odds-service/src/harvester_scrape.py`, unchanged) on a
dedicated machine with a normal residential IP instead.

## One-time setup

On the laptop that will stay on:

1. Install [Python 3.12+](https://www.python.org/downloads/) if it isn't
   already — check "Add python.exe to PATH" during install.
2. Clone this repo onto that machine.
3. Create `.env.local` at the repo root with one line:
   ```
   DATABASE_URL=<the same value your dev machine's .env.local has>
   ```
   Copy it yourself — same Postgres instance every part of this app already
   shares, nothing new.
4. From PowerShell, in the repo root:
   ```powershell
   .\scripts\harvester-laptop-setup.ps1
   ```
   This creates a Python virtual environment, installs dependencies
   (including Playwright's Chromium), and registers **one Windows Scheduled
   Task per sport** (`LinesmithOddsHarvester-mlb`, `-soccer_epl`,
   `-soccer_mls`, `-tennis`, `-nfl`, `-cfb`, `-nba`, `-nhl`), each running
   the scraper for just that one sport every 150 minutes, staggered 15
   minutes apart, while this account is logged in — no Windows password
   stored anywhere, no admin rights needed to register them. One task per
   sport (not one task looping every sport back-to-back) is deliberate:
   running every sport in a single process took ~22 minutes total with only
   4 sports this session, which alone would already exceed a single task's
   execution-time limit, and only grows as more sports are added.

   `nba` and `nhl` are included even though both are genuinely off-season
   right now (NBA preseason starts October, NHL mid-September) — their
   tasks run, find no real games in the current lookahead window, and exit
   in a couple seconds without ever launching Chromium. Nothing further to
   set up once each season's real schedule shows up; the existing task just
   starts finding real games and scraping them.

5. **Two things, or the task silently stops firing:**
   - Turn off sleep while plugged in:
     `Settings > System > Power & battery > Screen and sleep > "When plugged
     in, put my device to sleep after" -> Never`
   - Stay logged in to this account. Locking the screen (Win+L) is fine and
     expected — the task keeps running. Signing all the way out stops it.

## Verifying it's actually working

Run one sport's task once immediately instead of waiting for its staggered
start:
```powershell
Start-ScheduledTask -TaskName 'LinesmithOddsHarvester-mlb'
Start-Sleep -Seconds 30
Get-ScheduledTaskInfo -TaskName 'LinesmithOddsHarvester-mlb'
```
`LastTaskResult` should read `0` (success) — note that `nba`/`nhl` return
`0` even while finding zero games, since "no games right now" is a normal,
expected off-season outcome, not a failure. Anything else means it exited
non-zero — see Troubleshooting below. Swap `mlb` for `soccer_epl`,
`soccer_mls`, `tennis`, `nfl`, `cfb`, `nba`, or `nhl` to check the others;
`Get-ScheduledTask -TaskName 'LinesmithOddsHarvester-*'` lists all of them
at once.

**Confirm real data landed**, without needing DB access on the laptop itself:
open `/diagnostics` on the deployed app and look for `oddsharvester_scrape_mlb`
(and `_soccer_epl`, `_soccer_mls`, `_tennis`, `_nfl`, `_cfb`) in the
health-checks list (it's the same generic `job_health_checks` table
`health_check.py` already uses — nothing new to build to see it there).
`healthy: true` with a real `matched` count means rows are in
`game_odds_book_lines`. `oddsharvester_scrape_nba`/`_nhl` won't appear there
at all until each real season starts — the health-check write only happens
once a scrape actually runs, and "no games loaded" exits before that point.

## Day to day

Nothing to do — it just runs. Re-run the setup script any time you change the
interval/stagger or want to reinstall dependencies:
```powershell
.\scripts\harvester-laptop-setup.ps1 -IntervalMinutes 150 -StaggerMinutes 15
.\scripts\harvester-laptop-setup.ps1 -SkipDependencyInstall   # re-register only, skip reinstalling deps
```

Stop it entirely:
```powershell
Get-ScheduledTask -TaskName 'LinesmithOddsHarvester-*' | Unregister-ScheduledTask -Confirm:$false
```

## Troubleshooting

- **`Register-ScheduledTask` fails with access denied** — re-run the setup
  script from an elevated ("Run as Administrator") PowerShell window.
- **`LastTaskResult` is non-zero** — open a normal PowerShell window and run
  the scraper directly to see the real error output:
  ```powershell
  cd python-odds-service
  .\.venv\Scripts\python.exe src\harvester_scrape.py mlb
  ```
- **`oddsharvester_scrape_mlb` shows `healthy: false` with "possible anti-bot
  block"** — the same 429/challenge risk exists in principle for any IP,
  residential included, just far less likely. If it persists across several
  cycles (not just one), that's worth flagging — a single bad cycle isn't
  significant, OddsPortal's own docs describe intermittent throttling as
  normal even for real traffic.
- **The scheduled task silently stopped running after some days** — check the
  laptop didn't go to sleep despite the power setting above (a Windows Update
  restart, for instance, resets nothing here since the task re-registers
  itself at startup via `-StartWhenAvailable`, but a *sleeping* machine just
  never fires triggers at all).
