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
   (including Playwright's Chromium), and registers a Windows Scheduled Task
   (`LinesmithOddsHarvester`) that runs the scraper every 20 minutes — whether
   you're logged in or not, without ever storing a Windows password anywhere.

5. **Turn off sleep while plugged in** (Task Scheduler won't fire during full
   sleep, only during idle-but-awake):
   `Settings > System > Power & battery > Screen and sleep > "When plugged in,
   put my device to sleep after" -> Never`

## Verifying it's actually working

Run it once immediately instead of waiting 20 minutes:
```powershell
Start-ScheduledTask -TaskName 'LinesmithOddsHarvester'
Start-Sleep -Seconds 30
Get-ScheduledTaskInfo -TaskName 'LinesmithOddsHarvester'
```
`LastTaskResult` should read `0` (success). Anything else means it exited
non-zero — see Troubleshooting below.

**Confirm real data landed**, without needing DB access on the laptop itself:
open `/diagnostics` on the deployed app and look for `oddsharvester_scrape_mlb`
in the health-checks list (it's the same generic `job_health_checks` table
`health_check.py` already uses — nothing new to build to see it there).
`healthy: true` with a real `matched` count means rows are in
`game_odds_book_lines`.

## Day to day

Nothing to do — it just runs. Re-run the setup script any time you change the
interval or want to reinstall dependencies:
```powershell
.\scripts\harvester-laptop-setup.ps1 -IntervalMinutes 30
.\scripts\harvester-laptop-setup.ps1 -SkipDependencyInstall   # re-register only, skip reinstalling deps
```

Stop it entirely:
```powershell
Unregister-ScheduledTask -TaskName 'LinesmithOddsHarvester' -Confirm:$false
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
