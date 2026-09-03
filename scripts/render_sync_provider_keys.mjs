/**
 * Push the five missing provider keys from .env.local to the Render worker.
 *
 * WHY THIS IS A SCRIPT YOU RUN, rather than something the assistant did for you:
 * setting these through an agent's tool calls would put five API keys in
 * plaintext into a conversation transcript. Run locally, the values go straight
 * from your .env.local to Render and are never printed, logged, or echoed —
 * this script only ever reports KEY NAMES.
 *
 * WHAT IT FIXES. Verified against the live Render API on 2026-09-02, the worker
 * is missing exactly five env vars that config.py requires:
 *
 *     SPORTSGAMEODDS_MULTISPORT_KEY   PARLAYAPI_NFL_KEY   PARLAYAPI_CFB_KEY
 *     PARLAYAPI_SOCCER_KEY            PARLAYAPI_NBA_KEY
 *
 * A provider is live only if `env_bool(FLAG, default=True) && Boolean(KEY)`, and
 * env_bool defaults to true — so it is the missing KEY that disables, silently,
 * with the job still reporting healthy. Cost of the omission: NFL, CFB and NBA
 * have had no live odds since 2026-08-21. ParlayAPI cannot produce game lines
 * (its endpoint is /props), so sportsgameodds_multisport is their only
 * game-line source and its absence removed them with no fallback.
 *
 * THE DANGEROUS ENDPOINT THIS DELIBERATELY AVOIDS. Render's
 * `PUT /v1/services/{id}/env-vars` REPLACES THE ENTIRE LIST. Called with just
 * these five, it would delete the 21 vars already set — including DATABASE_URL.
 * This script uses the single-key form, `PUT .../env-vars/{key}`, which
 * creates-or-updates one variable and touches nothing else.
 *
 * Usage, from the repo root:
 *     node scripts/render_sync_provider_keys.mjs            # dry run, default
 *     node scripts/render_sync_provider_keys.mjs --apply    # actually write
 *     node scripts/render_sync_provider_keys.mjs --apply --deploy
 *
 * The deploy is separate and opt-in because the worker is `autoDeploy: no` on
 * purpose — see render.yaml's own comment on why starting it is a deliberate
 * act, not a side effect.
 */
import fs from 'fs';

const SERVICE_ID = 'srv-da36bm2bkg8c73fqrdeg'; // line-buddy-odds-worker
const KEYS = [
  'SPORTSGAMEODDS_MULTISPORT_KEY',
  'PARLAYAPI_NFL_KEY',
  'PARLAYAPI_CFB_KEY',
  'PARLAYAPI_SOCCER_KEY',
  'PARLAYAPI_NBA_KEY',
];

const apply = process.argv.includes('--apply');
const deploy = process.argv.includes('--deploy');

const envText = fs.readFileSync('.env.local', 'utf8');
const readLocal = (k) => {
  const line = envText.split('\n').find((l) => l.startsWith(k + '='));
  if (!line) return null;
  const v = line.slice(k.length + 1).trim().replace(/^["']|["']$/g, '');
  return v || null;
};

const RENDER_KEY = readLocal('RENDER_API_KEY');
if (!RENDER_KEY) {
  console.error('RENDER_API_KEY is not in .env.local — cannot continue.');
  process.exit(1);
}
const H = {
  Authorization: `Bearer ${RENDER_KEY}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const existing = await (
  await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/env-vars?limit=100`, { headers: H })
).json();
const present = new Set((Array.isArray(existing) ? existing : []).map((x) => (x.envVar || x).key));

console.log(`\nworker ${SERVICE_ID} currently has ${present.size} env vars`);
console.log(apply ? 'MODE: apply\n' : 'MODE: dry run — pass --apply to write\n');

let wrote = 0;
let missingLocally = [];

for (const key of KEYS) {
  const value = readLocal(key);
  if (!value) {
    missingLocally.push(key);
    console.log(`  SKIP    ${key.padEnd(30)} not in .env.local either — must be registered with the vendor first`);
    continue;
  }
  if (present.has(key)) {
    console.log(`  ok      ${key.padEnd(30)} already set on Render`);
    continue;
  }
  if (!apply) {
    console.log(`  WOULD   ${key.padEnd(30)} set from .env.local (${value.length} chars)`);
    continue;
  }
  // SINGLE-KEY endpoint. The collection PUT would wipe every other var.
  const res = await fetch(
    `https://api.render.com/v1/services/${SERVICE_ID}/env-vars/${encodeURIComponent(key)}`,
    { method: 'PUT', headers: H, body: JSON.stringify({ value }) },
  );
  if (res.ok) {
    wrote++;
    console.log(`  SET     ${key.padEnd(30)} ok`);
  } else {
    console.log(`  FAILED  ${key.padEnd(30)} HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
}

if (missingLocally.length) {
  console.log(`\n${missingLocally.length} key(s) exist nowhere and must be registered with the vendor:`);
  for (const k of missingLocally) console.log(`  - ${k}`);
  console.log('  ParlayAPI keys are free; register another account and add it to .env.local first.');
}

if (deploy && apply) {
  const res = await fetch(`https://api.render.com/v1/services/${SERVICE_ID}/deploys`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  const body = await res.json().catch(() => ({}));
  console.log(res.ok ? `\ndeploy triggered: ${body.id || '(no id returned)'}` : `\ndeploy FAILED: HTTP ${res.status}`);
} else if (apply && wrote) {
  console.log('\nKeys are set but NOT deployed. Re-run with --deploy, or trigger from the dashboard.');
}

console.log(`
VERIFY AFTER DEPLOYING — the point is live odds, not a green deploy:

  1. provider_usage should show fresh spend for sportsgameodds_multisport,
     parlayapi_nfl and parlayapi_cfb. All three last spent 2026-08-21.
  2. game_odds_book_lines should gain rows for nfl and cfb from a source other
     than oddsharvester. That table is the gate out of Phase 1.
  3. python src/health_check.py — refreshNflJob and refreshCfbJob should still
     report healthy, but now while actually producing rows. Note they report
     healthy either way today, which is finding 1g.
`);
