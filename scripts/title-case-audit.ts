/**
 * Title Case audit — T1 of docs/design/title-case-plan.md. DRY RUN: reads the
 * source, writes docs/design/title-case/audit.json, changes nothing.
 *
 *   node --import tsx scripts/title-case-audit.ts
 *
 * What is a label is decided by WHERE the string sits (plan §4), never by
 * guessing from the words:
 *   - a property or JSX attribute named in LABEL_KEYS          → titleCase
 *   - a property or JSX attribute named in SUB_KEYS            → sentenceStart
 *   - every string value of a `*_LABEL(S)` / `*_NAMES` map     → titleCase
 *   - text directly inside a Button, Chip, th, heading, link…  → titleCase
 *   - the title argument of Python's RankingDef                → titleCase
 * A proposed change that might not be a label (the string also appears
 * somewhere it is compared or looked up, or it reads like a sentence, or it
 * sits under `name`) is marked for a look rather than decided here.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { sentenceStart, titleCase } from '../lib/text/titleCase';

const ROOT = path.resolve(__dirname, '..');
const DIRS = ['app', 'components', 'lib'];
const SKIP_FILES = new Set(['lib/text/titleCase.ts']);
/** /kit is a dev-only showcase: its words are demo text ("sm pill"), not labels anyone reads. */
const SKIP_DIRS = new Set(['app/kit']);

const LABEL_KEYS = new Set(['label', 'title', 'header', 'heading', 'navLabel', 'tabLabel', 'shortLabel', 'headerLabel', 'groupLabel', 'emptyTitle', 'aLabel', 'bLabel', 'word']);
const SUB_KEYS = new Set(['sub', 'subtitle', 'subLabel']);
const ASK_KEYS = new Set(['name']);
const MAP_NAME = /(^|_)(LABELS?|NAMES?|TITLES?)(_|$)/;
const TEXT_TAGS = new Set(['Button', 'Chip', 'Tag', 'th', 'button', 'h1', 'h2', 'h3', 'h4', 'label', 'legend', 'dt', 'a', 'Link', 'option', 'BackLink', 'SelectItem', 'ListBoxItem']);

type Kind = 'label' | 'sub' | 'map' | 'jsx-text' | 'jsx-attr' | 'python';
interface Entry {
  id: string;
  file: string;
  line: number;
  key: string;
  kind: Kind;
  surface: string;
  old: string;
  new: string;
  flags: string[];
  start: number;
  end: number;
}

const entries: Entry[] = [];
/** Every string literal in the tree, by text → where, to spot a label that is also a key. */
const seen = new Map<string, string[]>();

function surfaceOf(file: string): string {
  const f = file.replace(/\\/g, '/');
  if (/Scan(Table|Card)\.tsx$|FilterBar|FilterSidebar|PlayerFilterDrawer|DateGameStrip/.test(f)) return 'Scan';
  if (/marketLabels|MarketLabel|rareMarket/.test(f)) return 'Market names (every page)';
  if (/lib\/slate\/|components\/slate\/|Slate|Spotlight|ResearchFlags/.test(f)) return 'Slate, Specials and flags';
  if (/components\/ui\/|app\/kit\//.test(f)) return 'Kit (every page)';
  if (/components\/odds\/|lib\/odds\//.test(f)) return 'Odds';
  if (/[Gg]ame(Research|Detail)|gameResearch|GameResearch|lineScore|\/game\//.test(f)) return 'Game page';
  if (/[Tt]eam(Research|Detail)|teamResearch|\/team\//.test(f)) return 'Team page';
  if (/[Pp]layer(Detail|Research)|playerResearch|playerDetail|\/player\//.test(f)) return 'Player page';
  if (/components\/charts\//.test(f)) return 'Charts';
  if (/^app\//.test(f)) return 'Other pages (app/)';
  return 'Shared (lib/ and components/)';
}

function looksLikeSentence(s: string): boolean {
  // A value (`${…}`, `{…}` or a template hole) counts as one word of its own.
  const t = s.replace(/\$\{[^}]*\}|\{[^}]*\}|\u0001\d+\u0001/g, ' X ').replace(/\s+/g, ' ').trim();
  return /[.!?]$/.test(t) || /\. /.test(t) || /, /.test(t) || t.split(' ').length > 8;
}

function propName(n: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return null;
}

/** String leaves of an initializer: a literal, a template, or the branches of a ternary / `??` / `||`. */
function leaves(e: ts.Expression): Array<ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression> {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e)) return [e];
  if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isSatisfiesExpression(e)) return leaves(e.expression);
  if (ts.isConditionalExpression(e)) return [...leaves(e.whenTrue), ...leaves(e.whenFalse)];
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(e.operatorToken.kind)) return [...leaves(e.left), ...leaves(e.right)];
  if (ts.isJsxExpression(e as unknown as ts.Node) && (e as unknown as ts.JsxExpression).expression) return leaves((e as unknown as ts.JsxExpression).expression!);
  return [];
}

const MARK = (i: number) => `\u0001${i}\u0001`;

/** Apply `fn` to a literal's text; a template's `${…}` holes are kept as opaque words. */
function transform(lit: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression, fn: (s: string) => string, sf: ts.SourceFile) {
  if (!ts.isTemplateExpression(lit)) return { old: lit.text, new: fn(lit.text) };
  let joined = lit.head.text;
  lit.templateSpans.forEach((sp, i) => (joined += MARK(i) + sp.literal.text));
  const out = fn(joined);
  const show = (s: string) => s.replace(/\u0001(\d+)\u0001/g, (_, i) => '${' + lit.templateSpans[Number(i)].expression.getText(sf) + '}');
  return { old: show(joined), new: show(out) };
}

function add(sf: ts.SourceFile, file: string, node: ts.Node, key: string, kind: Kind, before: string, after: string, extra: string[] = []) {
  if (before === after) return;
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const flags = [...extra];
  if (looksLikeSentence(before) && kind !== 'sub') flags.push('reads like a sentence');
  if (/^[a-z]+$/.test(before.trim())) flags.push('was all lowercase: a key?');
  entries.push({ id: `${file}:${line + 1}:${node.getStart(sf)}`, file, line: line + 1, key, kind, surface: surfaceOf(file), old: before, new: after, flags, start: node.getStart(sf), end: node.getEnd() });
}

function visitFile(file: string) {
  const abs = path.join(ROOT, file);
  const text = fs.readFileSync(abs, 'utf8');
  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const taken = new Set<ts.Node>();

  const doLeaves = (init: ts.Expression, key: string, kind: Kind, fn: (s: string) => string, extra: string[] = []) => {
    for (const lit of leaves(init)) {
      taken.add(lit);
      const r = transform(lit, fn, sf);
      add(sf, file, lit, key, kind, r.old, r.new, extra);
    }
  };

  const walk = (node: ts.Node, inMap: string | null) => {
    // `const MARKET_LABELS = { … }` — every string value is a name.
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && MAP_NAME.test(node.name.text) && node.initializer) {
      let init: ts.Expression = node.initializer;
      while (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init)) init = init.expression;
      if (ts.isObjectLiteralExpression(init)) {
        ts.forEachChild(node, (c) => walk(c, node.name.getText(sf)));
        return;
      }
    }
    if (ts.isPropertyAssignment(node)) {
      const k = propName(node.name);
      if (k && LABEL_KEYS.has(k)) doLeaves(node.initializer, k, 'label', titleCase);
      else if (k && SUB_KEYS.has(k)) doLeaves(node.initializer, k, 'sub', sentenceStart);
      else if (k && ASK_KEYS.has(k)) doLeaves(node.initializer, k, 'label', titleCase, ['under `name`: a label or a real name?']);
      else if (inMap && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) doLeaves(node.initializer, `${inMap}[${k ?? '?'}]`, 'map', titleCase);
    }
    if (ts.isJsxAttribute(node) && node.initializer) {
      const k = propName(node.name);
      const init = node.initializer;
      const expr = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) && init.expression ? init.expression : null;
      if (k && expr) {
        if (LABEL_KEYS.has(k)) doLeaves(expr, k, 'jsx-attr', titleCase);
        else if (SUB_KEYS.has(k)) doLeaves(expr, k, 'sub', sentenceStart);
      }
    }
    if (ts.isJsxElement(node) && TEXT_TAGS.has(node.openingElement.tagName.getText(sf)) && node.children.some((c) => ts.isJsxExpression(c)) && node.children.some((c) => ts.isJsxText(c) && /[a-z]/.test(c.getText(sf)))) {
      const tag = node.openingElement.tagName.getText(sf);
      const kids = node.children.filter((c) => ts.isJsxText(c) || ts.isJsxExpression(c));
      if (kids.length === node.children.length) {
        const holes: string[] = [];
        let joined = '';
        for (const c of kids) {
          if (ts.isJsxText(c)) joined += c.getText(sf).replace(/\s+/g, ' ');
          else { joined += MARK(holes.length); holes.push(c.getText(sf)); }
        }
        joined = joined.trim();
        const show = (t: string) => t.replace(/(\d+)/g, (_, i) => holes[Number(i)]);
        const out = titleCase(joined);
        for (const c of kids) if (ts.isJsxText(c)) taken.add(c);
        if (out !== joined) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          const flags = looksLikeSentence(joined) || joined.replace(/\d+/g, ' ').trim().split(/\s+/).length > 5 ? ['reads like a sentence'] : [];
          if (/^[^A-Za-z]*[a-z]/.test(joined)) flags.push('starts lowercase on purpose?');
          entries.push({ id: `${file}:${line + 1}:${node.getStart(sf)}`, file, line: line + 1, key: `<${tag}>`, kind: 'jsx-text', surface: surfaceOf(file), old: show(joined), new: show(out), flags, start: node.children[0].getStart(sf), end: node.children[node.children.length - 1].getEnd() });
        }
      }
    }
    if (ts.isJsxText(node) && !taken.has(node) && node.parent && ts.isJsxElement(node.parent)) {
      const tag = node.parent.openingElement.tagName.getText(sf);
      const raw = node.getText(sf);
      const inner = raw.trim();
      if (TEXT_TAGS.has(tag) && /[a-z]/.test(inner) && !/^[{}]/.test(inner)) {
        const out = raw.replace(inner, titleCase(inner.replace(/\s+/g, ' ')));
        if (titleCase(inner.replace(/\s+/g, ' ')) !== inner.replace(/\s+/g, ' ')) add(sf, file, node, `<${tag}>`, 'jsx-text', inner.replace(/\s+/g, ' '), titleCase(inner.replace(/\s+/g, ' ')));
        void out;
      }
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && !taken.has(node) && node.text.length > 2) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const where = `${file}:${line + 1}`;
      const list = seen.get(node.text) ?? [];
      list.push(where);
      seen.set(node.text, list);
    }
    ts.forEachChild(node, (c) => walk(c, inMap));
  };
  walk(sf, null);
}

function files(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(rel)) out.push(...files(rel)); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.d\.ts$/.test(e.name) && !SKIP_FILES.has(rel)) out.push(rel);
  }
  return out;
}

for (const d of DIRS) for (const f of files(d)) visitFile(f);

// Python: RankingDef("id", (sports,), "Title", "promo in the book's words", …) — the title only.
const pyFile = 'python-odds-service/src/slate_rankings.py';
const py = fs.readFileSync(path.join(ROOT, pyFile), 'utf8');
for (const m of py.matchAll(/RankingDef\(\s*"([^"]+)",\s*\([^)]*\),\s*"([^"]+)"/g)) {
  const line = py.slice(0, m.index).split('\n').length;
  const title = m[2];
  const start = m.index! + m[0].lastIndexOf(`"${title}"`);
  if (titleCase(title) !== title)
    entries.push({ id: `${pyFile}:${line}:${start}`, file: pyFile, line, key: `RankingDef[${m[1]}].title`, kind: 'python', surface: 'Slate, Specials and flags', old: title, new: titleCase(title), flags: [], start, end: start + title.length + 2 });
}

// A proposed change whose old text also appears as a plain string elsewhere (compared, looked up, tested) needs a look.
const testText = files('tests').filter((f) => !f.endsWith('title-case-rule.test.ts')).map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
for (const e of entries) {
  const elsewhere = (seen.get(e.old) ?? []).filter((w) => w !== `${e.file}:${e.line}`);
  if (elsewhere.length) e.flags.push(`also a plain string at ${elsewhere.slice(0, 3).join(', ')}${elsewhere.length > 3 ? ` +${elsewhere.length - 3}` : ''}`);
  if (/ /.test(e.old) && testText.includes(`'${e.old}'`)) e.flags.push('a test names this text');
}

entries.sort((a, b) => a.surface.localeCompare(b.surface) || a.file.localeCompare(b.file) || a.line - b.line);
const outDir = path.join(ROOT, 'docs/design/title-case');
fs.mkdirSync(outDir, { recursive: true });
const summary = {
  builtAt: new Date().toISOString(),
  total: entries.length,
  needsALook: entries.filter((e) => e.flags.length).length,
  bySurface: Object.fromEntries([...new Set(entries.map((e) => e.surface))].map((s) => [s, entries.filter((e) => e.surface === s).length])),
  byKind: Object.fromEntries([...new Set(entries.map((e) => e.kind))].map((k) => [k, entries.filter((e) => e.kind === k).length])),
};
fs.writeFileSync(path.join(outDir, 'audit.json'), JSON.stringify({ summary, entries }, null, 1));
fs.writeFileSync(path.join(outDir, 'audit.js'), `window.AUDIT = ${JSON.stringify({ summary, entries })};\n`);
console.log(JSON.stringify(summary, null, 1));
