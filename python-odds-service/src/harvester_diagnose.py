"""Diagnostic-only, not part of the real scrape pipeline. Two real runs from
GitHub Actions (workflows 89031661351, 89034061055 — the second AFTER the
Docker/CI Chromium-flag fix, same commit confirmed via the checkout log)
both failed identically: odds-format dropdown timeout, page height 0, 0
event rows. The flag fix made no observable difference, so guessing a third
fix blind isn't warranted — this captures what OddsPortal is ACTUALLY
serving to a GitHub Actions runner's IP (HTTP status + headers + a
screenshot + the raw HTML), the same real-page-content approach OddsHarvester's
own docs recommend (`--headless=false` locally) adapted for a headless CI
runner with no display, where that option doesn't exist.

Run via the workflow's diagnose-on-failure step; artifacts are uploaded so
they can be inspected without needing a live GitHub Actions terminal.
"""
import asyncio
import json
import os

# Relies on `pip install ./oddsharvester` already having happened (the same
# workflow step the real scrape depends on) — no sys.path hack needed.
from oddsharvester.core.playwright_manager import PlaywrightManager

URL = "https://www.oddsportal.com/baseball/usa/mlb/"
OUT_DIR = os.environ.get("HARVESTER_DIAGNOSE_OUT", "diagnose-out")


async def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    manager = PlaywrightManager()
    result: dict = {"url": URL}
    try:
        await manager.initialize(headless=True)
        response = await manager.page.goto(URL, timeout=30_000, wait_until="domcontentloaded")
        result["status"] = response.status if response else None
        result["status_text"] = response.status_text if response else None
        result["headers"] = dict(response.headers) if response else None
        result["final_url"] = manager.page.url

        # Give the SPA a real window to hydrate before capturing — same
        # ballpark the real scraper waits before concluding the page is
        # empty (its scroller polls for up to ~6s across 3 attempts).
        await manager.page.wait_for_timeout(8_000)

        result["title"] = await manager.page.title()
        result["body_text_length"] = len(await manager.page.inner_text("body"))
        result["viewport_height_scrollHeight"] = await manager.page.evaluate("document.body.scrollHeight")

        html = await manager.page.content()
        with open(os.path.join(OUT_DIR, "page.html"), "w", encoding="utf-8") as f:
            f.write(html)

        await manager.page.screenshot(path=os.path.join(OUT_DIR, "screenshot.png"), full_page=True)

        print(f"[harvester_diagnose] {json.dumps(result, indent=2)}", flush=True)
    finally:
        with open(os.path.join(OUT_DIR, "result.json"), "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2)
        await manager.cleanup()


if __name__ == "__main__":
    asyncio.run(main())
