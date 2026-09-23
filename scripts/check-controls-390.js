// C6.3's guard, finally automated (C8 closeout B3, 2026-09-23): on a 390px
// phone the props controls occupy AT MOST THREE ROWS.
//
// HOW TO RUN IT. This is not a `node --test` file: that runner cannot drive a
// browser, and the repo holds no Playwright package. It is a Playwright
// function, and it runs through the Playwright MCP — the same tool every render
// check in this project uses:
//
//     browser_run_code_unsafe({ filename: "scripts/check-controls-390.js" })
//
// against a running app on :3000 (`linesmith-prod`). It returns PASS or FAIL
// per sport with the controls it counted. Adding `@playwright/test` as a
// devDependency would let it run headless in CI; that is a separate decision
// (a ~150MB browser download), not made here.
//
// WHAT COUNTS AS A CONTROL: the children of the props section's controls row
// (search, status, watchlist, density, the overflow menu, the sidebar toggle)
// plus the phone-only "Filters" button. Two controls whose tops are within 8px
// share a row.
//
// Measured when written: 3 rows on /mlb, /nfl, /nba, /soccer/mls and
// /tennis/atp — exactly at the limit, so a single new control in that row will
// fail this, which is the point.
async (page) => {
  const LIMIT = 3;
  const routes = ['/mlb', '/nfl', '/nba', '/soccer/mls', '/tennis/atp'];
  await page.setViewportSize({ width: 390, height: 844 });
  const results = [];
  for (const r of routes) {
    await page.goto('http://localhost:3000' + r, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000);
    const m = await page.evaluate(() => {
      const props = document.getElementById('slate-props');
      if (!props) return null;
      const rowBlock = props.querySelector('div.mb-3.mt-3.flex-wrap');
      const filtersBlock = [...props.children].find((e) => e.classList.contains('sm:hidden'));
      const visible = (e) => {
        const b = e.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && getComputedStyle(e).display !== 'none';
      };
      const items = [...(rowBlock ? rowBlock.children : []), ...(filtersBlock ? filtersBlock.children : [])].filter(visible);
      const tops = items.map((e) => Math.round(e.getBoundingClientRect().top)).sort((a, b) => a - b);
      const rows = [];
      for (const t of tops) if (!rows.length || t - rows[rows.length - 1] > 8) rows.push(t);
      return {
        rows: rows.length,
        controls: items.length,
        overflow: items.some((e) => e.getBoundingClientRect().right > window.innerWidth),
      };
    });
    if (!m) {
      results.push(`FAIL ${r}: no props section rendered`);
      continue;
    }
    const ok = m.rows <= LIMIT && m.controls > 0 && !m.overflow;
    results.push(`${ok ? 'PASS' : 'FAIL'} ${r}: ${m.rows} rows (limit ${LIMIT}), ${m.controls} controls${m.overflow ? ', OVERFLOWS the viewport' : ''}`);
  }
  return results.join('\n');
}
