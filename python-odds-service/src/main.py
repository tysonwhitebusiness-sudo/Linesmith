"""Entrypoint. Run with: python src/main.py (from python-odds-service/)."""
import asyncio

from jobs import JOB_REGISTRY
from job_queue import SequentialQueue


async def main() -> None:
    print(f"[main] starting sequential queue with {len(JOB_REGISTRY)} jobs: {[n for n, _, _ in JOB_REGISTRY]}", flush=True)
    q = SequentialQueue(JOB_REGISTRY)
    await q.run_forever()


if __name__ == "__main__":
    asyncio.run(main())
