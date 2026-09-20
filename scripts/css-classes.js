/**
 * U0 guard, part two: the set of class names each stylesheet actually defines.
 *
 * `css-diff.js` compares rule bodies, which is noisy across the Tailwind 3 -> 4
 * move because v4 restructures its output (real `@layer`s, `hover:` wrapped in
 * `@media (hover: hover)`, `space-y` on `:not(:last-child)`, alpha through
 * `color-mix`). The dangerous failure is a different one: a utility that
 * silently stops being generated, so a class in the markup styles nothing.
 * This extracts the class NAMES from both stylesheets and diffs those sets.
 *
 * Usage: node scripts/css-classes.js before.css after.css
 */
const fs = require('fs');

function classNames(css) {
  const set = new Set();
  for (const m of css.matchAll(/\.((?:[\w-]|\\.)+)/g)) {
    const name = m[1]
      // CSS numeric escapes: \2c -> ','
      .replace(/\\([0-9a-fA-F]{1,6}) ?/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
      // literal escapes: \. \/ \[ \! ...
      .replace(/\\(.)/g, '$1');
    set.add(name);
  }
  return set;
}

const [a, b] = process.argv.slice(2);
const A = classNames(fs.readFileSync(a, 'utf8'));
const B = classNames(fs.readFileSync(b, 'utf8'));
const onlyA = [...A].filter((x) => !B.has(x)).sort();
const onlyB = [...B].filter((x) => !A.has(x)).sort();
console.log(`class names: before ${A.size}, after ${B.size}`);
console.log(`\n-- generated BEFORE, missing AFTER (${onlyA.length}) --`);
onlyA.forEach((x) => console.log('  ' + x));
console.log(`\n-- new AFTER (${onlyB.length}) --`);
onlyB.forEach((x) => console.log('  ' + x));
