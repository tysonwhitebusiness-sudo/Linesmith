# P0 · Keep the data flowing

**Lane:** laptop (odds-scraper repo). **Deploys:** none. **Needs:** the
operator's green light.
**Goal:** the scraper can never again stop silently, and its only full
history has an off-machine copy.
**Audit findings covered:** F1 (the stall), G6 / S3 (the backup).

---

## Background (measured 2026-09-24)

- At 17:38:10 UTC the collector stopped: `/api/status` kept answering with
  `running: true`, `last_poll_at` 17:38:10, `last_cycle.pending_writes` 28,
  `in_flight` 39, `fetching` 3. Nothing was written after that.
  `data/server.err.log` has no error. The watchdog in `run-scraper.ps1` exits
  as soon as port 8000 is listening, so it never restarted anything.
- **Mechanism** (`scraper/collector.py`):
  - `status.last_poll_at` is set only in `_note_poll()`, which is called only
    by the single writer thread (`_writer_loop` → `_handle_batch`) after
    `_store_many()` returns.
  - The dispatcher stops submitting work once the result queue holds
    `MAX_PENDING_RESULTS` (20).
  - So a writer that never returns from a batch freezes the whole pipeline,
    while FastAPI keeps serving.
  - SQLite has `busy_timeout=5000` (`db.py:354`), so a database lock raises
    within 5 s rather than hanging.
  - The block is therefore in Python: a thread deadlock, a file operation in
    `RawStore.write()`, or a store that never returns. **The cause is not yet
    known**; step 2 exists to catch it.
- Parquet history lives in `data/archive/<table>/[source=<s>/]date=<d>/part.parquet`
  (`archive._part_path`). Each file has a row in `archive_manifest` with
  `rows`, `id_sum`, `bytes` and `pruned_at`. On 2026-09-24 it held
  2026-09-22 and 09-23: offers 28.1M rows / 200.5 MB, prop_markets 5.5M /
  38.1 MB, events 27k, snapshots 145k. Only complete UTC days are exported,
  the archiver runs hourly (`ARCHIVE_INTERVAL_SECONDS` 3600), and SQLite keeps
  `HOT_DAYS` = 3. So only the current, unfinished UTC day is outside Parquet.
- An off-machine store already exists: line-buddy's corpus uses Supabase
  Storage over S3, bucket `linesmith-corpus`, credentials `CORPUS_URI`,
  `CORPUS_S3_ENDPOINT`, `CORPUS_S3_REGION`, `CORPUS_S3_KEY_ID` and
  `CORPUS_S3_SECRET` in `line-buddy/.env.local`, code in
  `python-odds-service/src/corpus_location.py` (the S3 backend's `put`).
- `boto3` is installed in line-buddy's `python-odds-service/.venv`, **not**
  in the scraper's `.venv`. duckdb and pyarrow are in both.

---

## Build

### 0. Restart now ⚑ (operator)

The builder cannot stop processes (the permission system refuses). The
operator runs:

```powershell
Stop-Process -Id <the two run.py python.exe PIDs> -Force; Start-ScheduledTask -TaskName OddsScraper
```

Find the PIDs with:

```powershell
Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ? CommandLine -like '*run.py*' | select ProcessId
```

Then confirm `/api/status` shows `last_poll_at` advancing (startup takes about
3 minutes to load ~810k dedup keys).

### 1. Thread-stack dump on demand — `scraper/server.py`

Add a route that returns every thread's current stack as plain text:

```python
@app.get("/api/debug/threads", response_class=PlainTextResponse)
def api_debug_threads():
    import sys, threading, traceback
    names = {t.ident: t.name for t in threading.enumerate()}
    out = [f"# {datetime.now(timezone.utc).isoformat()}  pid={os.getpid()}"]
    for ident, frame in sys._current_frames().items():
        out.append(f"\n--- thread {names.get(ident, '?')} ({ident}) ---")
        out.extend(traceback.format_stack(frame))
    out.append("\n--- status ---\n" + json.dumps(collector.status, default=str, indent=1))
    return "".join(out)
```

Local only: the server binds 127.0.0.1.

### 2. Writer heartbeat and self-dump — `scraper/collector.py`

- Add to `Collector.__init__`:
  - `self._writer_stage = "idle"`
  - `self._writer_stage_at = time.time()`
  - `self._writer_batch_done_at = time.time()`
- Add a helper `_stage(name)` that sets both fields. Call it at each step of
  the writer:
  - `_writer_loop`: `"wait"` before `get`, `"collect"` after the batch is
    taken;
  - `_handle_batch`: `"store"` before `_store_many`, `"post"` after it;
  - `_refresh_latest`: `"latest"`;
  - `_maybe_prune_raw`: `"prune_raw"`;
  - inside `_write` per result: `"raw:<source>:<kind>"` before
    `self.raw.write`, `"rows:<source>:<kind>"` after it.
- Set `self._writer_batch_done_at` at the end of each batch.
- Expose them in `status` (set inside `_note_poll`, under the existing lock):
  `"writer": {"stage": ..., "stage_age_s": ..., "last_batch_s_ago": ...}`.
- **Stall monitor thread** (`name="stall-monitor"`, started in `start()`):
  - It wakes every 30 s.
  - If `self._results.qsize() > 0` and `time.time() - self._writer_batch_done_at > STALL_DUMP_SECONDS`,
    it writes the same text as `/api/debug/threads` to
    `data/stalls/stall-<UTC yyyymmdd-HHMMSS>.txt`, then records
    `status["stalled_since"]`.
  - It dumps at most once per stall. It re-arms when a batch completes.
- Config (`scraper/config.py`): `STALL_DUMP_SECONDS = float(os.environ.get("SCRAPER_STALL_DUMP", "180"))`.
  180 s is about 2.5× the slowest direct-book interval (60–75 s + 15 s
  jitter) and well above the slowest measured store (covers ~26 s mean on
  2026-09-24).
- Add `stalls/` to the data dir creation in `config.ensure_dirs()`.

### 3. Freshness watchdog — `run-scraper.ps1` (rewrite)

It stays the script the `OddsScraper` task runs at logon and every 5 min.
New logic:

1. If nothing listens on 8000, start the scraper as today and exit.
2. If something listens, `Invoke-RestMethod http://127.0.0.1:8000/api/status -TimeoutSec 15`.
   - **Healthy** if `last_poll_at` parses and is ≤ `$StaleSeconds` (300) old
     → exit 0.
   - **Starting** if `last_poll_at` is null and the listening process started
     < 600 s ago (state load is ~3 min) → exit 0.
   - Otherwise **stalled**. A status call that fails twice, 10 s apart, also
     counts as stalled.
3. On stalled:
   1. `Invoke-WebRequest http://127.0.0.1:8000/api/debug/threads -TimeoutSec 20`
      → save to `data\stalls\watchdog-<ts>.txt` (ignore failure).
   2. Append one line to `data\watchdog.log`: time, `last_poll_at`,
      `pending_writes`, `in_flight`, `writer.stage`, `writer.stage_age_s`.
   3. Find the process on 8000
      (`Get-NetTCPConnection -LocalPort 8000 -State Listen`), its parent (the
      `.venv\Scripts\python.exe run.py` launcher, via
      `Win32_Process.ParentProcessId`), and any other `python.exe` whose
      command line matches `*run.py*` in this folder. `Stop-Process -Force`
      each one.
   4. Wait up to 20 s for port 8000 to close, then start as in step 1.
- Parameters at the top: `$StaleSeconds = 300`, `$StartupGraceSeconds = 600`.
- The scheduled task's settings do not change.

### 4. Find the cause (with the first dump)

- On the first stall dump (or before the restart in step 0, if the operator
  prefers to install `py-spy` — ⚑, it is a download), read the writer
  thread's stack. It names the blocking call.
- Fix it at that call. Record the cause and the fix in the scraper
  `HANDOFF.md` and in this file's "Result" section.
- If no stall recurs within the background window, record "not reproduced",
  and the watchdog is the protection.

### 5. Off-machine backup (S3) — `odds-scraper/tools/backup_archive.py` (new)

- **Runs with line-buddy's Python** (it has boto3):
  `C:\Users\occy3\Documents\line-buddy\python-odds-service\.venv\Scripts\python.exe tools\backup_archive.py [--verify-day YYYY-MM-DD]`.
- **Credentials:** reads `CORPUS_S3_ENDPOINT`, `CORPUS_S3_REGION`,
  `CORPUS_S3_KEY_ID` and `CORPUS_S3_SECRET` from `line-buddy/.env.local` (a
  small `KEY=VALUE` parser; placeholder values starting `REPLACE` count as
  unset, the same rule as `corpus_location._cred`). The bucket is the one in
  `CORPUS_URI` (`linesmith-corpus`).
- **Object key:** `scraper-archive/<relative path under data/archive>`, e.g.
  `scraper-archive/offers/source=comparenbet/date=2026-09-23/part.parquet`.
- **What it uploads:**
  - every `archive_manifest` row with `path != ''`, read read-only
    (`file:data/scraper.db?mode=ro`);
  - every file under `data/archive/ref/`.
- **Ledger:** `data/backup_ledger.json`, mapping `path → {bytes, sha256,
  uploaded_at, etag}`.
  - A file whose sha256 matches the ledger is skipped.
  - A file whose bytes changed (the archiver rewrites a day it re-exports) is
    uploaded again.
- **Upload:** `put_object` with `Metadata={"sha256": ...}`. Then a
  `head_object` must return the same `ContentLength` before the ledger is
  written.
- **Verify mode** (`--verify-day`): downloads every object for that day to a
  temp dir, then checks two things:
  - the sha256 matches the ledger;
  - `duckdb.sql("select count(*), sum(id) from read_parquet(?)")` equals the
    manifest's `rows` and `id_sum`.

  It exits 0 on a full match and prints each mismatch.
- **Schedule:** a new Windows scheduled task `OddsScraperBackup`, daily at
  04:30 local, running `tools\run-backup.ps1`. The script calls the command
  above and appends to `data\backup.log`. The operator creates the task ⚑
  (same account, "run whether user is logged on or not" off, like
  `OddsScraper`).
- **Deletes nothing**, locally or remotely.
- **Budget:** about 100 MB a day at today's volume (200 MB for the two
  archived days). The operator's plan includes 100 GB of Storage. The
  backup log prints the running total so growth is visible.

---

## Tests (these gate P1)

| test | where | what it proves |
|---|---|---|
| `test_infra.py` group `p0_writer` | scraper root | `_stage()` updates `status.writer`; a batch sets `_writer_batch_done_at` |
| `test_infra.py` group `p0_stall` | scraper root | A collector whose `_store_many` is monkeypatched to block on an Event, with a result queued and `STALL_DUMP_SECONDS=2`, writes exactly one `data/stalls/stall-*.txt` whose text contains `thread writer` and the blocking function's name, then no second file until a batch completes |
| `test_infra.py` group `p0_debug_threads` | scraper root | `/api/debug/threads` through FastAPI's TestClient returns 200 text with `--- thread writer` and `--- status ---` |
| `tools/test_watchdog.ps1` | scraper `tools/` | Runs the watchdog's decision function against canned status JSON: fresh → healthy; null + young → starting; null + old → stalled; 400 s old → stalled; unreachable twice → stalled |
| live stall drill | laptop | With the scraper running, set `SCRAPER_STALL_DUMP=60` and block the writer through a debug-only env switch `SCRAPER_TEST_FREEZE_WRITER=1` (read once at the start of each batch, sleeps forever while set, never set in normal runs). **Result required:** a stall dump appears, and the next watchdog run (run it by hand) restarts the scraper, which resumes polling. |
| backup round trip | laptop | `backup_archive.py` uploads both archived days; `--verify-day 2026-09-22` and `--verify-day 2026-09-23` exit 0; a second run uploads nothing (all skipped by ledger) |

**Exit criteria:**
- the operator's restart is done and `last_poll_at` is advancing;
- all tests above pass;
- the stall drill restarted the scraper by itself;
- both archived days are verified in Storage.

## Background checks (never gate P1)

- 48 h with no gap in `last_poll_at` longer than 300 s. Checked from
  `data\watchdog.log` (no restarts) and `snapshots` (no 5-minute hole in any
  direct source).
- `OddsScraperBackup` lands each day: `data\backup.log` shows a new day
  uploaded and verified.

Written into `docs/CURRENT.md` when started.

## Files touched

- odds-scraper: `scraper/server.py`, `scraper/collector.py`,
  `scraper/config.py`, `run-scraper.ps1`, `tools/backup_archive.py` (new),
  `tools/run-backup.ps1` (new), `tools/test_watchdog.ps1` (new),
  `test_infra.py`, `HANDOFF.md`.
- line-buddy: `docs/CURRENT.md`, this file (Result section).

## Result

**Closed 2026-09-24 21:20 UTC.** odds-scraper commits `52ae6b4`, `8afa4d8`
(local only: that repo has no git remote).

- **Restart:** done by the operator at 20:53 UTC. At 21:00 `last_poll_at` was
  3 s old. It was restarted once more at 21:05 to load the P0 code; the old
  processes stopped fine, since the permission system allowed `Stop-Process`.
- **A gap the spec missed, now fixed:** the old `run-scraper.ps1` blocked on
  `python run.py`, so the `OddsScraper` task stayed "Running" for the
  scraper's whole life. With `MultipleInstances=IgnoreNew`, every 5-minute
  trigger was skipped, so a freshness check in that script could never have
  run. The rewrite starts the scraper detached (`Start-Process cmd /c …`) and
  exits. Measured: the scraper survives the task ending, and the task goes
  back to Ready. The task's settings are unchanged, as the spec says.
- **Drill switch:** `SCRAPER_TEST_FREEZE_WRITER=1` **or** a
  `data\TEST_FREEZE_WRITER` file. An environment variable cannot be set on
  a running process, so the file is what the live drill used.
- **Live stall drill** (default 180 s dump threshold, no manual watchdog
  run):
  - 21:07:57: freeze file created;
  - 21:11:02: `stall-20260924-211102.txt` written. Its writer stack ends in
    `_test_freeze → time.sleep`, i.e. it names the blocking call;
  - 21:12:59: **the task's own 5-minute trigger** logged
    `stalled last_poll_at=21:07:57 pending_writes=16 in_flight=35 writer.stage=test_freeze`,
    saved `watchdog-20260924-211259.txt`, stopped the processes and
    restarted;
  - 21:14:19: polling again. **Total gap 6 min 22 s, restarted by itself.**
- **Cause of the 17:38 hang: not yet reproduced.** No freeze has happened
  since the restart. The logs hold no error, and `server.out.log` has no
  timestamps. Reading the code, the writer's only unbounded waits are
  `_store_many` (SQLite with `busy_timeout` 5 s), `RawStore.write` (file I/O)
  and `_maybe_prune_raw` (unlinks thousands of files on the writer thread;
  the first prune after the 20:53 restart freed 472 MB). The next freeze
  leaves `data\stalls\stall-*.txt` with the writer's stack; read it, fix
  that call, and record it here. Until then the watchdog caps any freeze at
  about 5–10 min.
- **Backup:**
  - 62 files (both archived days plus `ref/`), 242.7 MB, in
    `linesmith-corpus/scraper-archive/…`;
  - `--verify-day 2026-09-22`: 26 files, 9,656,725 rows, 0 mismatches;
  - `--verify-day 2026-09-23`: 34 files, 24,095,896 rows, 0 mismatches;
  - the second run skipped all 62.
- **Chunked upload (a deviation):** Supabase refused objects over the
  project's 50 MB per-file limit (the first try failed on a 50.9 MB
  comparenbet day with an empty `PutObject` error, and multipart is held to
  the same limit). Files over 40 MB therefore go up as `.chunkNNN` pieces,
  and `--verify-day` reassembles them before the checks. Raising the limit
  would be an operator setting; it is not needed.
- **`OddsScraperBackup` task:** registered (the permission system allowed
  it): daily 04:30 local, same account, interactive. Run once through the
  scheduler: result 0, `data\backup.log` shows the run and a clean verify of
  09-23. Its output is written by the script itself (`--log`), because
  PowerShell 5.1's redirection wrote UTF-16 into the log.
- **Tests:**
  - `test_infra.py`: all 13 groups pass (10 old, plus `p0_writer`,
    `p0_stall`, `p0_debug_threads`);
  - `tools\test_watchdog.ps1`: 7/7.
- **py-spy:** skipped (a download), per the handoff.
