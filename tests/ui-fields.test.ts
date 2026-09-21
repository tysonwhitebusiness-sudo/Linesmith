import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { OUT_OF_SCOPE, code } from './ui-scope';

/**
 * U3's guard — one field family, and no page builds its own.
 *
 * Before U3 there were 17 raw `<input>` / `<select>` elements in scope, each
 * with its own ring, its own focus color and — the one that mattered on a
 * phone — its own font size: every one under 16px, so iOS zoomed the page when
 * it took focus. And five master/detail lists were buttons with
 * `role="option"`, which announced as a listbox but had none of a listbox's
 * keys. This is a ZERO, not a ratchet: all of them moved.
 */

function sources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) out.push(p);
    }
  };
  walk('components');
  walk('app');
  return out.filter((p) => !p.startsWith('components/ui/') && !OUT_OF_SCOPE.includes(p));
}

test('no raw <input>, <select> or <textarea> outside the kit', () => {
  const hits = sources().filter((p) => /<(input|select|textarea)\b/.test(code(readFileSync(p, 'utf8'))));
  assert.deepEqual(hits, []);
});

test('no hand-built listbox outside the kit', () => {
  const hits = sources().filter((p) => /role="(listbox|option)"/.test(code(readFileSync(p, 'utf8'))));
  assert.deepEqual(hits, []);
});

test('every kit field is 16px below 768px, so iOS does not zoom on focus', () => {
  const css = readFileSync('app/globals.css', 'utf8');
  assert.match(css, /--text-field:\s*16px/);
  const fields = code(readFileSync('components/ui/Fields.tsx', 'utf8'));
  assert.match(fields, /FIELD_TEXT = 'text-field md:text-body'/);
  // Input, Textarea and the ComboBox's input all carry it.
  assert.ok((fields.match(/FIELD_TEXT,/g) ?? []).length >= 3);
});

test("the kit's own select is React Aria's, not a native one", () => {
  const controls = code(readFileSync('components/ui/Controls.tsx', 'utf8'));
  assert.doesNotMatch(controls, /<select\b/);
  assert.match(controls, /<Select<T>/);
  const fields = code(readFileSync('components/ui/Fields.tsx', 'utf8'));
  assert.doesNotMatch(fields, /<select\b/);
  assert.match(fields, /AriaSelect/);
});

test('the field family is exported from the kit and never imported by path', () => {
  const index = readFileSync('components/ui/index.ts', 'utf8');
  for (const name of ['Field', 'Input', 'Textarea', 'Checkbox', 'RadioGroup', 'Toggle', 'Select', 'ComboBox', 'PickList', 'FileTrigger']) {
    assert.ok(index.split(/[\s,{}]+/).includes(name), name);
  }
  const byPath = sources().filter((p) => /from ['"](\.\.?\/)+ui\/Fields['"]|from ['"]@\/components\/ui\/Fields['"]/.test(readFileSync(p, 'utf8')));
  assert.deepEqual(byPath, []);
});
