// Builds self-contained Phase G2 pages: inlines system.css, the kit, sport specs and data/*.json into each src/*.html.
// Usage (from repo root): node docs/design/phase-g2/build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (...p) => readFileSync(join(root, ...p), 'utf8');
const css = read('src', 'system.css');
const sportFiles = readdirSync(join(root, 'src', 'sports')).filter((f) => f.endsWith('.js')).sort((a, b) => (a === 'common.js' ? -1 : b === 'common.js' ? 1 : a.localeCompare(b)));
const js = [read('src', 'kit.js'), read('src', 'kit2.js'), read('src', 'viz-sport.js'), ...sportFiles.map((f) => read('src', 'sports', f))].join('\n;\n');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap">';
const dataTag = (name) => `<script type="application/json" id="data-${name.replace(/\.json$/, '')}">${read('data', name).replace(/</g, '\\u003c')}</script>`;

for (const file of readdirSync(join(root, 'src')).filter((f) => f.endsWith('.html'))) {
  const surface = file.replace(/\.html$/, '');
  let html = read('src', file);
  html = html.replace('<!--SYSTEM-->', `${fonts}<style>${css}</style><script>${js}</script>`);
  html = html.replace('<!--DATA:ALL-->', () => readdirSync(join(root, 'data')).filter((f) => f.startsWith(`${surface}-`) && f.endsWith('.json')).map(dataTag).join('\n'));
  html = html.replace(/<!--DATA:PREFIX:([\w-]+)-->/g, (_, p) => readdirSync(join(root, 'data')).filter((f) => f.startsWith(`${p}-`) && f.endsWith('.json')).map(dataTag).join('\n'));
  html = html.replace(/<!--DATA:([\w.-]+)-->/g, (_, name) => dataTag(name));
  writeFileSync(join(root, file), html);
  console.log(`built ${file} (${Math.round(html.length / 1024)} KB)`);
}
