// Builds self-contained Phase G boards: inlines system.css, ui.js and data/*.json into each src/*.html.
// Usage (from repo root): node docs/design/phase-g/build.mjs
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, 'src', 'system.css'), 'utf8');
const js = readFileSync(join(root, 'src', 'ui.js'), 'utf8');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600;700&family=Source+Sans+3:wght@400;500;600;700&display=swap">';

for (const file of readdirSync(join(root, 'src')).filter((f) => f.endsWith('.html'))) {
  let html = readFileSync(join(root, 'src', file), 'utf8');
  html = html.replace('<!--SYSTEM-->', `${fonts}<style>${css}</style><script>${js}</script>`);
  html = html.replace(/<!--DATA:([\w.-]+)-->/g, (_, name) => {
    const json = readFileSync(join(root, 'data', name), 'utf8').replace(/</g, '\\u003c');
    return `<script type="application/json" id="data-${name.replace(/\.json$/, '')}">${json}</script>`;
  });
  writeFileSync(join(root, file), html);
  console.log(`built ${file} (${Math.round(html.length / 1024)} KB)`);
}
