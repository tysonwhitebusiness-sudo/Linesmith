/**
 * U0 guard: compare two emitted stylesheets rule by rule.
 *
 * The Tailwind 3.4 -> 4 move must not change a single pixel. Screenshots of a
 * handful of pages cannot prove that; the emitted CSS can. This flattens both
 * files into `context || selector -> declarations` and reports every selector
 * whose declarations changed, plus the ones that appear or vanish.
 *
 * Usage: node scripts/css-diff.js before.css after.css [--full]
 */
const fs = require('fs');

function flatten(css) {
  const out = new Map();
  let i = 0;
  const stack = [];
  let buf = '';
  while (i < css.length) {
    const c = css[i];
    if (c === '{') {
      const head = buf.trim();
      buf = '';
      if (head.startsWith('@') && !head.startsWith('@font-face') && !head.startsWith('@page')) {
        stack.push(head.replace(/\s+/g, ' '));
        i++;
        continue;
      }
      // a rule: read to the matching close brace
      let depth = 1;
      let body = '';
      i++;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth++;
        else if (css[i] === '}') { depth--; if (depth === 0) break; }
        body += css[i];
        i++;
      }
      i++;
      const ctx = stack.filter((s) => !s.startsWith('@layer ')).join(' >> ');
      for (const sel of head.split(',')) {
        const key = (ctx ? ctx + ' >> ' : '') + sel.trim().replace(/\s+/g, ' ');
        const decls = body.split(';').map((d) => d.trim().replace(/\s+/g, ' ')).filter(Boolean).sort().join('; ');
        out.set(key, (out.has(key) ? out.get(key) + ' | ' : '') + decls);
      }
      continue;
    }
    if (c === '}') { stack.pop(); buf = ''; i++; continue; }
    buf += c;
    i++;
  }
  return out;
}

const [a, b] = process.argv.slice(2);
const full = process.argv.includes('--full');
const A = flatten(fs.readFileSync(a, 'utf8'));
const B = flatten(fs.readFileSync(b, 'utf8'));
const onlyA = [], onlyB = [], changed = [];
for (const [k, v] of A) {
  if (!B.has(k)) onlyA.push(k);
  else if (B.get(k) !== v) changed.push([k, v, B.get(k)]);
}
for (const k of B.keys()) if (!A.has(k)) onlyB.push(k);

console.log(`rules: before ${A.size}, after ${B.size}`);
console.log(`changed ${changed.length}  removed ${onlyA.length}  added ${onlyB.length}`);
const show = (list) => list.slice(0, full ? 1e9 : 60).forEach((k) => console.log('  ' + k));
if (onlyA.length) { console.log('\n-- only in BEFORE --'); show(onlyA); }
if (onlyB.length) { console.log('\n-- only in AFTER --'); show(onlyB); }
if (changed.length) {
  console.log('\n-- CHANGED --');
  changed.slice(0, full ? 1e9 : 80).forEach(([k, x, y]) => {
    console.log('  ' + k + '\n      before: ' + x + '\n      after:  ' + y);
  });
}
