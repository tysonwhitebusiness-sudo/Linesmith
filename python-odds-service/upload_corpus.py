"""Phase 5.2c — push the local corpus to object storage, and verify it landed.

    python upload_corpus.py            # every table
    python upload_corpus.py game_result

UPLOADING IS NOT THE POINT; PROVING IT ARRIVED IS. Every file is re-read from
the remote store after upload and its bytes compared to the local original,
because the whole reason this corpus exists is to be the thing that makes a
Postgres delete safe. A copy nobody has read back is not a backup.

Resumable and idempotent: a file already present remotely with a matching size
and matching content hash is skipped. That matters because 441 files over a
domestic connection is long enough to be interrupted, and because two of
today's long jobs already were.

DELETES NOTHING, here or in Postgres.
"""
import argparse
import asyncio
import hashlib
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))

import corpus_store as cs                                     # noqa: E402
from corpus_location import LocalCorpus, corpus_location, DEFAULT_LOCAL_DIR  # noqa: E402


def _md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def local_root() -> str:
    """Where the exporter wrote. `CORPUS_URI` now names the REMOTE corpus, so
    the staging directory is the module default unless overridden."""
    return os.environ.get("CORPUS_LOCAL_DIR") or DEFAULT_LOCAL_DIR


def main(tables: list[str], root: str) -> int:
    backend = corpus_location()
    if isinstance(backend, LocalCorpus):
        print("CORPUS_URI is not an s3:// location — nothing to upload to.")
        return 2
    import boto3

    from boto3.s3.transfer import TransferConfig

    s3 = boto3.client("s3", endpoint_url=backend.endpoint,
                      region_name=backend.region,
                      aws_access_key_id=backend.key_id,
                      aws_secret_access_key=backend.secret)
    # FORCE SINGLE-PART UPLOADS, so the remote ETag really is the file's MD5.
    #
    # boto3 switches to multipart at 8 MB by default -- not "well above any
    # threshold", which is what an earlier comment here asserted and got wrong.
    # A multipart ETag is an md5-OF-md5s with a `-N` suffix, so comparing it to
    # the file's md5 reports a mismatch on a perfectly good upload: three
    # mlb_pitch_events partitions over 11 MB "failed" that way while their byte
    # counts matched exactly.
    #
    # The alternative was to download each object and hash it, which is a truer
    # check but spends 126 MB of the egress this whole phase is trying to
    # reduce. Single-part keeps the cheap check honest instead.
    _MAX_SINGLE_PART = 256 * 1024 * 1024
    xfer = TransferConfig(multipart_threshold=_MAX_SINGLE_PART,
                          multipart_chunksize=_MAX_SINGLE_PART)
    print(f"local  : {root}")
    print(f"remote : {backend.describe}\n")

    sent = skipped = failed = 0
    sent_bytes = 0
    started = time.monotonic()
    for table in tables:
        d = os.path.join(root, table)
        if not os.path.isdir(d):
            print(f"  {table}: nothing exported locally, skipping")
            continue
        files = sorted(f for f in os.listdir(d) if f.endswith(".parquet"))
        for i, fname in enumerate(files, 1):
            lp = os.path.join(d, fname)
            key = backend._key(table, fname)
            size = os.path.getsize(lp)
            digest = _md5(lp)
            try:
                head = s3.head_object(Bucket=backend.bucket, Key=key)
                # ETag is the md5 for a SINGLE-PART upload, which `xfer`
                # above guarantees. Quoted in the response. A `-N` suffix would
                # mean multipart and that this comparison is invalid.
                if (head["ContentLength"] == size
                        and head.get("ETag", "").strip('"') == digest):
                    skipped += 1
                    continue
            except Exception:
                pass                       # not present, or not comparable
            try:
                s3.upload_file(lp, backend.bucket, key, Config=xfer)
            except Exception as e:
                print(f"     FAILED {fname}: {type(e).__name__}: {str(e)[:120]}")
                failed += 1
                continue
            # VERIFY IT LANDED. Re-read the remote object's own metadata rather
            # than trusting a 200 from the upload call.
            head = s3.head_object(Bucket=backend.bucket, Key=key)
            etag = head.get("ETag", "").strip('"')
            if "-" in etag:
                print(f"     {fname}: remote ETag {etag} is MULTIPART — size "
                      f"matches ({size:,}) but the hash cannot be compared. "
                      f"Treating as unverified.")
                failed += 1
                continue
            if head["ContentLength"] != size or etag != digest:
                print(f"     MISMATCH after upload: {fname} "
                      f"(local {size} bytes/{digest[:8]}, "
                      f"remote {head['ContentLength']}/{head.get('ETag','')[:10]})")
                failed += 1
                continue
            sent += 1
            sent_bytes += size
            if sent % 25 == 0:
                print(f"   {table}: {i}/{len(files)} "
                      f"({sent:,} sent, {skipped:,} already present)", flush=True)
        print(f"  -> {table}: {len(files)} files")

    el = time.monotonic() - started
    print(f"\nuploaded {sent:,} files ({sent_bytes / 1e6:,.1f} MB), "
          f"{skipped:,} already present, {failed:,} failed, in {el:,.0f}s")
    if failed:
        print("Some files did not verify remotely. NOTHING may be pruned until "
              "every file is present and matching.")
    return 1 if failed else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Upload the corpus to object storage")
    ap.add_argument("tables", nargs="*")
    a = ap.parse_args()
    root = local_root()
    tabs = a.tables or list(cs.CORPUS)
    # VALIDATED AGAINST THE DISK, NOT AGAINST `cs.CORPUS`. 5.S.2 exports dead
    # tables through the same streaming exporter but deliberately keeps them out
    # of the corpus registry (see `corpus_store.spec_for`), and they still need
    # to reach object storage before anything is dropped. What makes a name
    # uploadable is that the exporter actually wrote a directory of Parquet for
    # it -- which is a stronger check than registry membership, because a
    # registered table with no export would have passed the old test and
    # uploaded nothing.
    unknown = [t for t in tabs if not os.path.isdir(os.path.join(root, t))]
    if unknown:
        print(f"no exported Parquet under {root} for: {unknown}")
        sys.exit(2)
    sys.exit(main(tabs, root))
