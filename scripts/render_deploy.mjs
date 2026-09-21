/**
 * Deploy the Python worker from the pushed branch, wait for it, print the result.
 *
 * The worker is `autoDeploy: false` on purpose (render.yaml says why), so a
 * deploy is a deliberate act. The unattended run (docs/design/
 * unattended-run-2026-09-21.md, A1) authorises one per Python phase, after
 * its tests pass and a local run against the database succeeds. Record each
 * one in docs/CURRENT.md's Deploys table.
 *
 * Reads RENDER_API_KEY from .env.local and never prints it. Render builds the
 * commit at the tip of the connected branch, so PUSH FIRST: this prints the
 * commit Render actually deployed, and warns if it is not your local HEAD.
 *
 * Usage, from the repo root:
 *     node scripts/render_deploy.mjs                   # the worker
 *     node scripts/render_deploy.mjs --service srv-…   # another service
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const WORKER = 'srv-da36bm2bkg8c73fqrdeg'; // line-buddy-odds-worker
const i = process.argv.indexOf('--service');
const SERVICE_ID = i > 0 ? process.argv[i + 1] : WORKER;

const envText = fs.readFileSync('.env.local', 'utf8');
const line = envText.split('\n').find((l) => l.startsWith('RENDER_API_KEY='));
const KEY = line ? line.slice('RENDER_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : '';
if (!KEY) {
  console.error('RENDER_API_KEY is not in .env.local — cannot continue.');
  process.exit(1);
}
const H = { Authorization: `Bearer ${KEY}`, Accept: 'application/json', 'Content-Type': 'application/json' };
const api = (path, init) => fetch(`https://api.render.com/v1${path}`, { headers: H, ...init });

const head = execSync('git rev-parse HEAD').toString().trim();
const res = await api(`/services/${SERVICE_ID}/deploys`, { method: 'POST', body: JSON.stringify({ clearCache: 'do_not_clear' }) });
if (!res.ok) {
  console.error(`deploy FAILED to start: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  process.exit(1);
}
const { id } = await res.json();
console.log(`deploy ${id} started for ${SERVICE_ID}`);

const DONE = new Set(['live', 'build_failed', 'update_failed', 'canceled', 'deactivated', 'pre_deploy_failed']);
const started = Date.now();
let d = {};
while (Date.now() - started < 20 * 60_000) {
  await new Promise((r) => setTimeout(r, 15_000));
  const r = await api(`/services/${SERVICE_ID}/deploys/${id}`);
  if (!r.ok) continue;
  d = await r.json();
  process.stdout.write(`  ${Math.round((Date.now() - started) / 1000)}s ${d.status}\n`);
  if (DONE.has(d.status)) break;
}

const commit = d.commit?.id ?? '(unknown)';
console.log(`\nstatus: ${d.status ?? 'timed out'}\ncommit: ${commit}${commit.startsWith(head.slice(0, 7)) || commit === head ? '' : `  (local HEAD is ${head} — was it pushed?)`}`);
console.log(`finished: ${d.finishedAt ?? '—'}`);
process.exit(d.status === 'live' ? 0 : 1);
