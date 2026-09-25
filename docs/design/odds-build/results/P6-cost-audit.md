# P6.0 — the D25 cost audit (2026-09-25)

D25: **$50/month all-in** (Supabase Pro $25 + at most $25 more) across
Supabase, Render and, later, Vercel. It is enforced by caps in our own code.
Before anything that can raise a bill ships, this audit pulls every provider's
live price and usage into one monthly total. **The P6 bridge is the first such
thing.**

Rules: every number is measured, with its source. **Unmeasured** means exactly
that; nothing is estimated in its place.

## Live prices (fetched 2026-09-25)

| provider | item | price | source |
|---|---|---|---|
| Supabase | Pro plan | $25/month, includes $10/month compute credits | supabase.com/pricing |
| Supabase | compute | Micro $10, Small $15, Medium $60 (/month) | supabase.com/pricing |
| Supabase | disk | 8 GB included, then $0.125/GB/month | supabase.com/pricing |
| Supabase | egress | 250 GB included, then $0.09/GB | supabase.com/pricing |
| Supabase | file storage | 100 GB included, then $0.0213/GB | supabase.com/pricing |
| Render | Starter instance (worker) | $7/month (512 MB, 0.5 CPU) | render.com/pricing (embedded price table) |
| Render | cron job run time | Starter $0.00016/min, Standard $0.00058/min, Pro $0.00197/min; **minimum $1/month per cron service**; billed per second of run time | render.com/pricing; render.com/docs/cronjobs |
| Render | bandwidth | Hobby 5 GB, Pro 25 GB included; then $0.15/GB | render.com/pricing |
| Vercel | — | not used (the app is not hosted yet) | — |

## Usage (measured 2026-09-25)

| item | measured | source | monthly cost |
|---|---|---|---|
| Supabase plan | Pro | operator (D25) | **$25.00** |
| Supabase compute | `max_connections` 60, `shared_buffers` 256 MB, `max_worker_processes` 6 | `pg_settings` | covered by the $10 credit **if** this is Micro. **Not confirmed**: the size is on the billing page |
| Supabase disk | provisioned 27 GB; used 3.64 GB DB + 1.07 GB WAL | operator (P4) / `pg_database_size`, `pg_ls_waldir` | (27 − 8) × $0.125 = **$2.38**. `diskGuardJob` holds use under 85% of 27 GB, so it never autoscales |
| Supabase storage | 0.445 GB (585 objects) | S3 listing of `linesmith-corpus` | **$0** (100 GB included) |
| Supabase egress | **unmeasured** | Postgres counts rows, not bytes (`measure_egress_rate.py`); bytes are only on Supabase's usage page or the Management API | **unmeasured** |
| Render worker | Starter, 1 instance | Render API `/services` | **$7.00** |
| Render cron | Starter, every 15 min | Render API | run time **unmeasured** until the cron logs it (below); ≥ **$1.00** minimum |
| Render bandwidth | the worker's `bandwidth` metric: 148,128 MB for 2026-09-01…25 (~300 MB/hour) | Render API `/metrics/bandwidth` | **unmeasured as billed**: the metric does not separate inbound (not billed) from outbound, and Render has no billing endpoint (`/invoices` → 404) |
| Render workspace plan | "My Workspace" (team) | Render API `/owners` | tier not exposed by the API |

**Measured total so far:** $25.00 + $2.38 + $7.00 + ≥ $1.00 = **≥ $35.38/month**.

**Not yet known:** billed Supabase egress, billed Render bandwidth, and the
Supabase compute size. Your D25 note put today's extra at "Render about $10
(one $7 service + about $3 usual overage)". That fits, but it isn't a
measurement, and this audit does not use it.

## What the bridge adds, and where it lands on the bill

| cost | from the bridge | capped by |
|---|---|---|
| Supabase disk | up to 8.1M rows/day × 101 B/row (P5) × 10 days ≈ 8.2 GB of history | `diskGuardJob`, at 85% of the fixed 27 GB. The disk bill cannot move |
| Supabase egress | its own reads: prior-price lookups and codes. Every byte is metered by the bridge itself (below) | the cost guard's brake |
| Supabase storage | the corpus grows by the Parquet of each day (6.53 B/row measured in P5, i.e. ~53 MB/day at 8.1M rows) | 100 GB included |
| Render cron | the mover's daily export (89 s for 0.82M rows, measured in P5) | the cost guard (below) |
| Render bandwidth | none: the bridge runs on the laptop | — |

## Meters, alerts and brakes (built in P6.0)

- **`cost_prices.json`:** the table above as data, each price with its
  source and date. The meters never hard-code a price.
- **Meters:**
  - the bridge counts the bytes it receives from Supabase (its egress) and
    its rows written, per day;
  - the cron logs its own run time per run;
  - `costGuardJob` (worker, hourly) reads those, plus disk, storage and the
    Render services, and writes `cost_guard_state`:
    - the month-to-date and projected total per provider;
    - which inputs are measured and which are not.
- **Alerts:** `health_check.check_cost_guard` is unhealthy when:
  - the projected month is > $45 (90% of $50);
  - a required input has gone unmeasured for more than 7 days;
  - the state is stale.
- **Brakes:**
  - projected > $48 → `cost_guard_state.brake = true`. The bridge stops
    writing to Supabase (the laptop keeps everything, as with the disk
    guard's pause), and the mover defers exports that are not needed for
    disk.
  - Supabase egress past 90% of its 250 GB → brake.

## The two numbers you need to provide

Until these are measured, the cost guard treats them as **unknown** and alerts
on them. It does not guess.

1. **Supabase egress (and the compute size):** a Supabase personal access
   token as `SUPABASE_ACCESS_TOKEN` in `.env.local` and on the worker. The
   meter then reads usage through the Management API. Alternatively, the
   current month's egress figure from the Supabase usage page.
2. **Render's billed bandwidth and plan tier:** Render's API has no billing
   endpoint. Either the current month's numbers from the Render billing
   page, or connect Claude in Chrome so they can be read there (read-only).
