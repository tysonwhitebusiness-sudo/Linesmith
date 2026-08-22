/**
 * One-time backfill: attributes today's pre-auth global picks/bets/watchlist
 * rows (user_id IS NULL) to the operator's own account, per the decision
 * recorded in docs/four-feature-gameplan-2026-08-22.md's Phase 03 section.
 *
 * Run once, after the operator has signed up for real:
 *   node scripts/backfill-operator-account.js you@example.com
 *
 * Safe to re-run — every UPDATE is scoped to `user_id IS NULL`, so a second
 * run against the same account is a no-op once the first has landed.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Loads .env.local without a dotenv dependency, matching scripts/migrate-to-postgres.js's own no-extra-deps posture.
const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/backfill-operator-account.js <operator-email>');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query('SELECT id FROM auth.users WHERE email = $1', [email]);
    if (rows.length === 0) {
      console.error(`No auth.users row for ${email} — sign up first, then re-run.`);
      process.exit(1);
    }
    const userId = rows[0].id;
    console.log(`Backfilling unowned rows to ${email} (${userId})...`);

    for (const table of ['picks', 'bets', 'watchlist']) {
      const res = await client.query(`UPDATE ${table} SET user_id = $1 WHERE user_id IS NULL`, [userId]);
      console.log(`  ${table}: ${res.rowCount} row(s) updated`);
    }
    console.log('Done.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
