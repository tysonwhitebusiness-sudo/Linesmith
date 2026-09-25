"""P5.1 — hermetic: the id-chunk rules that close the corpus export gap.
Run: python -u src/test_corpus_chunk_rule.py

1. `chunk_is_open`: a chunk is open until max(id) reaches its upper bound.
2. `chunk_object_names`: a chunk is its main file plus `<name>_...` supplements,
   and nothing that merely shares a numeric prefix.
3. `chunk_fingerprints` reads the main file AND every supplement, so a row the
   main file missed is still seen once a supplement holds it.
"""
import os
import sys
import tempfile
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import corpus_store as cs                                     # noqa: E402
from corpus_location import LocalCorpus                       # noqa: E402

FAILS: list[str] = []


def check(name, cond, detail=""):
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + str(detail)) if detail and not cond else ''}")
    if not cond:
        FAILS.append(name)


def main():
    S = cs.ID_CHUNK_SPAN
    print("chunk_is_open")
    check("max id inside the chunk -> open", cs.chunk_is_open((None, 1), S - 5))
    check("max id at the last id of the chunk -> open", cs.chunk_is_open((None, 1), S))
    check("max id past the chunk -> closed", not cs.chunk_is_open((None, 1), S + 1))
    check("no rows at all -> open (nothing to finalise)", cs.chunk_is_open((None, 1), None))

    import pyarrow as pa
    import pyarrow.parquet as pq

    with tempfile.TemporaryDirectory() as root:
        t = "demo_events"
        backend = LocalCorpus(root)
        os.makedirs(os.path.join(root, t))
        part = (None, 500_001)
        name = cs.partition_name(t, part)
        schema = pa.schema([("id", pa.int64()), ("v", pa.string()),
                            ("at", pa.timestamp("us", tz="UTC"))])
        at = datetime(2026, 9, 25, tzinfo=timezone.utc)

        def write(fname, rows):
            pq.write_table(pa.table({"id": [r[0] for r in rows], "v": [r[1] for r in rows],
                                     "at": [at] * len(rows)}, schema=schema),
                           os.path.join(root, t, fname))

        write(f"{name}.parquet", [(500_001, "a"), (500_002, "b")])
        write(f"{name}_s01.parquet", [(500_003, "c")])
        # A different chunk whose number begins with the same digits must not be read.
        write(f"{cs.partition_name(t, (None, 5_000_001))}.parquet", [(5_000_001, "z")])

        print("chunk_object_names")
        names = cs.chunk_object_names(backend, t, part)
        check("main + supplement, nothing else", names == [f"{name}.parquet", f"{name}_s01.parquet"], names)

        print("chunk_fingerprints")
        fps, _ = cs.chunk_fingerprints(backend, t, part, ["id", "v", "at"])
        check("ids from both files", sorted(fps) == [500_001, 500_002, 500_003], sorted(fps))
        check("fingerprint matches the row as Postgres would send it",
              fps[500_003] == cs.fingerprint((500_003, "c", at)))
        check("a changed value would not match", fps[500_003] != cs.fingerprint((500_003, "C", at)))

    print(f"\n{'ALL PASSED' if not FAILS else f'{len(FAILS)} FAILED: {FAILS}'}")
    return 1 if FAILS else 0


if __name__ == "__main__":
    sys.exit(main())
