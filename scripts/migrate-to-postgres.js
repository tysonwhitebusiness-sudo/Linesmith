/**
 * One-off Phase 1 data migration: copies every row from the existing
 * better-sqlite3 database (data/linebuddy.db) into the new Postgres schema
 * (supabase/migrations/20260818201108_initial_schema.sql, already applied).
 *
 * Run once, after the schema migration and before the app is pointed at
 * Postgres for real traffic. Safe to interrupt and resume: before copying a
 * table, its Postgres row count is compared against the SQLite source count
 * — an exact match means that table already finished on a prior run and is
 * skipped entirely, so re-running after a dropped connection only redoes
 * whichever table was actually mid-copy (plus whatever hadn't started yet),
 * not the whole migration from scratch.
 *
 * Usage: node scripts/migrate-to-postgres.js
 * Requires DATABASE_URL in .env.local (same variable the app itself reads).
 */

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');
const { from: copyFrom } = require('pg-copy-streams');
const { Readable } = require('stream');

const DB_PATH = process.env.LINESMITH_DB ?? path.join(__dirname, '..', 'data', 'linebuddy.db');

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.join(__dirname, '..', '.env.local');
  const text = fs.readFileSync(envPath, 'utf8');
  const match = text.match(/^DATABASE_URL=(.+)$/m);
  if (!match) throw new Error('DATABASE_URL not found in .env.local');
  return match[1].trim();
}

// Columns that are INTEGER 0/1 in SQLite but BOOLEAN in Postgres — Postgres
// does not implicitly cast integer -> boolean, so these need an explicit
// JS-level conversion during copy, table by table.
const BOOLEAN_COLUMNS = {
  prop_odds: ['is_delayed'],
  prop_odds_history: ['is_delayed'],
  game_picks: ['ml_initial_late', 'ml_final_late', 'total_initial_late', 'total_final_late'],
  team_elo_history: ['was_home'],
  model_weights: ['active'],
  golf_tournament_results: ['made_cut'],
  golf_model_predictions: ['hit'],
  golf_tournament_predictions: ['actual_won', 'actual_top5', 'actual_top10', 'actual_made_cut'],
};

// Every table, in the same order as the schema migration — no FK
// constraints exist anywhere in this schema (confirmed during the Turso
// migration audit), so order has no functional effect; kept for readable
// progress output only.
const TABLES = [
  'picks', 'bets', 'watchlist', 'pick_history', 'odds_cache', 'snapshot_cache',
  'watch_links', 'prop_odds', 'prop_odds_history', 'game_odds_history',
  'provider_usage', 'odds_unresolved', 'game_picks', 'park_factors',
  'team_hr_rate_allowed', 'game_sim_cache', 'team_elo_history',
  'pitcher_game_score_history', 'model_weights', 'historical_odds',
  'system_events', 'golf_tournaments', 'golf_hole_scores', 'golf_round_scores',
  'golf_tournament_results', 'golf_model_predictions', 'golf_tournament_predictions',
];

function convertRow(table, row) {
  const boolCols = BOOLEAN_COLUMNS[table];
  if (!boolCols) return row;
  const out = { ...row };
  for (const col of boolCols) {
    if (col in out) out[col] = out[col] == null ? null : !!out[col];
  }
  return out;
}

/**
 * CSV field encoding for COPY ... WITH (FORMAT csv). Postgres's CSV format
 * treats an unquoted empty field as NULL by default, and a quoted empty
 * field ("") as a genuine empty string — the two are NOT the same, so a JS
 * `null` and a JS `''` need to be encoded differently, not just "print the
 * value". Anything containing a comma, quote, or newline gets wrapped in
 * quotes with internal quotes doubled, standard CSV escaping. `payload`
 * columns can hold multi-MB JSON blobs full of quotes/commas/newlines, so
 * this has to be exactly right, not approximate.
 */
function csvField(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'boolean' ? (value ? 't' : 'f') : String(value);
  if (str === '') return '""';
  if (/[",\n\r]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function* csvLines(table, columns, rows) {
  for (const raw of rows) {
    const row = convertRow(table, raw);
    yield columns.map((c) => csvField(row[c])).join(',') + '\n';
  }
}

async function copyRows(pg, table, columns, rows) {
  const stream = pg.query(copyFrom(`COPY ${table} (${columns.join(', ')}) FROM STDIN WITH (FORMAT csv)`));
  await new Promise((resolve, reject) => {
    Readable.from(csvLines(table, columns, rows))
      .pipe(stream)
      .on('finish', resolve)
      .on('error', reject);
  });
}

async function copyTable(sqlite, pg, table) {
  const sourceCount = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  if (sourceCount === 0) {
    console.log(`  ${table}: 0 rows, skipping`);
    return 0;
  }

  // Resume check — if a prior run already fully copied this table (row
  // counts match exactly), skip it rather than re-truncating and re-copying
  // rows that are already there. A partial prior copy (counts don't match)
  // falls through to the normal truncate-and-reload path below.
  const destCountRow = await pg.query(`SELECT COUNT(*) AS n FROM ${table}`);
  const destCount = Number(destCountRow.rows[0].n);
  if (destCount === sourceCount) {
    console.log(`  ${table}: already complete (${destCount}/${sourceCount} rows), skipping`);
    return destCount;
  }

  const rows = sqlite.prepare(`SELECT * FROM ${table}`).all();
  const columns = Object.keys(rows[0]);
  // Unlike plain INSERT, COPY accepts an explicit value for a GENERATED
  // ALWAYS AS IDENTITY column with no special clause needed — verified
  // empirically against this exact Postgres instance with a throwaway test
  // row before relying on it here, since the two commands are documented to
  // differ on this and it's not worth guessing wrong on ~837K rows.
  const hasIdColumn = columns.includes('id');
  await pg.query(`TRUNCATE TABLE ${table} RESTART IDENTITY`);

  await copyRows(pg, table, columns, rows);
  process.stdout.write(`  ${table}: ${rows.length}/${rows.length} rows (COPY)\n`);

  // Move the identity sequence past whatever explicit ids were just
  // inserted, so the app's own next INSERT (no explicit id, relying on
  // GENERATED ALWAYS) doesn't collide with a migrated row's id.
  if (hasIdColumn) {
    await pg.query(
      `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1), (SELECT MAX(id) FROM ${table}) IS NOT NULL)`,
    );
  }

  return rows.length;
}

async function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`SQLite database not found at ${DB_PATH}`);
    process.exit(1);
  }

  const sqlite = new Database(DB_PATH, { readonly: true });
  const pg = new Client({ connectionString: loadDatabaseUrl(), ssl: { rejectUnauthorized: false } });
  await pg.connect();
  // The pooler's default statement_timeout (observed: killed a COPY of
  // snapshot_cache — few rows, but some payload blobs run up to ~66MB) is
  // fine for normal app traffic but too tight for this one-off bulk load.
  // Session-scoped, not a database-wide change.
  await pg.query('SET statement_timeout = 0');

  console.log(`Source: ${DB_PATH}`);
  console.log(`Target: ${loadDatabaseUrl().replace(/:[^:@]+@/, ':***@')}`);
  console.log('');

  const summary = [];
  try {
    for (const table of TABLES) {
      const count = await copyTable(sqlite, pg, table);
      summary.push({ table, rows: count });
    }
  } finally {
    sqlite.close();
    await pg.end();
  }

  console.log('\nDone. Rows copied per table:');
  const total = summary.reduce((s, r) => s + r.rows, 0);
  for (const { table, rows } of summary) {
    console.log(`  ${table.padEnd(30)} ${rows}`);
  }
  console.log(`  ${'TOTAL'.padEnd(30)} ${total}`);
}

main().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
