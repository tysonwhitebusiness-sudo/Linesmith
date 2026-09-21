"""C0: replace the ineffective @utility override with an unlayered rule. One-off."""

p = 'app/globals.css'
s = open(p, encoding='utf-8').read()
a = s.index("/* C0: the bare `text-good` / `text-bad` / `text-warn` utilities render the INK")
b = s.index("@utility text-warn {\n  color: rgb(var(--warn-ink));\n}\n", a) + len("@utility text-warn {\n  color: rgb(var(--warn-ink));\n}\n")
s = s[:a] + """/* C0: the bare `text-good` / `text-bad` / `text-warn` classes render the INK
   shade, never the fill. In-scope code writes `text-*-ink` (guarded in
   tests/ui-sweep); this catches the frozen Scan files, whose bytes are pinned
   and whose recolour through tokens is approved (plan §9 Q2).
   UNLAYERED ON PURPOSE: unlayered CSS beats Tailwind's utilities layer, so
   these win over the theme-generated `.text-good{color:var(--color-good)}`.
   An `@utility text-good` was tried first and Tailwind kept its own rule. */
.text-good {
  color: rgb(var(--good-ink));
}
.text-bad {
  color: rgb(var(--bad-ink));
}
.text-warn {
  color: rgb(var(--warn-ink));
}
""" + s[b:]
open(p, 'w', encoding='utf-8', newline='').write(s)

t = 'tests/ui-sweep.test.ts'
s = open(t, encoding='utf-8').read()
s = s.replace("css.replace(/\\r/g, '').includes(`@utility text-${t} {\\n  color: rgb(var(--${t}-ink));`)",
              "css.replace(/\\r/g, '').includes(`\\n.text-${t} {\\n  color: rgb(var(--${t}-ink));`)")
open(t, 'w', encoding='utf-8', newline='').write(s)
print('ok')
