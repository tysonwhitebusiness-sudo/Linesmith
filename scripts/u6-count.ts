/**
 * U6's measuring stick: per file in scope, hand-typed `text-[Npx]` (outside
 * components/charts/), native `title=`, and hex literals. Run with
 * `npx tsx scripts/u6-count.ts`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { OUT_OF_SCOPE, code } from '../tests/ui-scope';

const files: string[] = [];
const walk = (d: string) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name)) files.push(p);
  }
};
walk('components');
walk('app');

export function measure(src: string, path: string): [number, number, number] {
  const body = code(src);
  const px = path.startsWith('components/charts/') ? 0 : (body.match(/text-\[\d+(\.\d+)?px\]/g) ?? []).length;
  const title = (body.match(/\stitle=[{"']/g) ?? []).length;
  const hex = (body.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).length;
  return [px, title, hex];
}

const rows: Array<[string, [number, number, number]]> = [];
for (const p of files.filter((f) => !OUT_OF_SCOPE.includes(f))) {
  const m = measure(readFileSync(p, 'utf8'), p);
  if (m[0] || m[1] || m[2]) rows.push([p, m]);
}
rows.sort((a, b) => b[1][0] + b[1][1] + b[1][2] - (a[1][0] + a[1][1] + a[1][2]));
const t = [0, 0, 0];
for (const [p, [a, b, c]] of rows) {
  t[0] += a;
  t[1] += b;
  t[2] += c;
  console.log(String(a).padStart(4), String(b).padStart(4), String(c).padStart(4), p);
}
console.log('TOTAL px/title/hex', t.join(' / '), 'files', rows.length);
