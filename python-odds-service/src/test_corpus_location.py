"""Phase 5.2c — the corpus's location is configuration, not architecture.

No credentials needed: the S3 backend is exercised for its CONFIGURATION and
its REFUSALS, which is where the dangerous behaviour lives. The bytes-moving
path is not mocked, because a mock of boto3 would only prove this file agrees
with itself.

THE REFUSAL IS THE POINT. If an s3:// corpus is configured without credentials
and this fell back to a local directory, a fitter would read a stale local copy
and produce a confident number from the wrong data. That is the exact failure
this phase exists to prevent, so it raises.
"""
import os
import sys
import tempfile

sys.path.insert(0, "src")
import corpus_location as cl


def check(name, got, want):
    assert got == want, f"FAIL {name}: got {got!r}, want {want!r}"
    print(f"PASS  {name}")


def test_no_uri_is_local_and_needs_nothing():
    b = cl.corpus_location("")
    assert isinstance(b, cl.LocalCorpus), b
    print(f"PASS  an unset CORPUS_URI works with no configuration ({b.describe[:40]}...)")


def test_plain_path_is_local():
    d = tempfile.mkdtemp()
    b = cl.corpus_location(d)
    assert isinstance(b, cl.LocalCorpus)
    check("a plain path is a local corpus", b.root, d)
    assert b.table_glob("odds_archive").endswith("odds_archive_*.parquet")


def test_s3_without_credentials_refuses():
    """Never a silent fallback — see this module's header."""
    saved = (cl.CORPUS_S3_ENDPOINT, cl.CORPUS_S3_KEY_ID, cl.CORPUS_S3_SECRET)
    cl.CORPUS_S3_ENDPOINT = cl.CORPUS_S3_KEY_ID = cl.CORPUS_S3_SECRET = ""
    try:
        cl.corpus_location("s3://bucket/prefix")
        raise AssertionError("FAIL: unconfigured s3 was accepted")
    except cl.CorpusNotConfigured as e:
        msg = str(e)
        assert "CORPUS_S3_ENDPOINT" in msg and "CORPUS_S3_KEY_ID" in msg, msg
        # The message must steer away from the two keys that DO exist in this
        # project and would both be the wrong thing to paste in.
        assert "anon" in msg and "service-role" in msg, msg
        print("PASS  s3 without credentials raises, and names the right key type")
    finally:
        cl.CORPUS_S3_ENDPOINT, cl.CORPUS_S3_KEY_ID, cl.CORPUS_S3_SECRET = saved


def test_s3_with_credentials_builds_a_readable_glob():
    saved = (cl.CORPUS_S3_ENDPOINT, cl.CORPUS_S3_KEY_ID, cl.CORPUS_S3_SECRET)
    cl.CORPUS_S3_ENDPOINT = "https://proj.supabase.co/storage/v1/s3"
    cl.CORPUS_S3_KEY_ID, cl.CORPUS_S3_SECRET = "id", "secret"
    try:
        b = cl.corpus_location("s3://linesmith/v1")
        check("bucket parsed", b.bucket, "linesmith")
        check("prefix parsed", b.prefix, "v1")
        check("glob is an s3 url DuckDB can read",
              b.table_glob("game_result"),
              "s3://linesmith/v1/game_result/game_result_*.parquet")
        check("upload key has no leading slash",
              b._key("game_result", "x.parquet"), "v1/game_result/x.parquet")
    finally:
        cl.CORPUS_S3_ENDPOINT, cl.CORPUS_S3_KEY_ID, cl.CORPUS_S3_SECRET = saved


def test_s3_configures_duckdb_without_the_scheme():
    """DuckDB's `s3_endpoint` is a HOST, not a URL — passing the https:// form
    makes every read fail with an unhelpful connection error."""
    import duckdb

    b = cl.S3Corpus("bkt", "v1", "https://proj.supabase.co/storage/v1/s3",
                    "us-east-1", "id", "secret")
    con = duckdb.connect()
    b.configure_duckdb(con)
    ep = con.execute("SELECT current_setting('s3_endpoint')").fetchone()[0]
    assert not ep.startswith("http"), f"endpoint kept its scheme: {ep!r}"
    check("endpoint is a bare host", ep, "proj.supabase.co/storage/v1/s3")
    check("path-style addressing (Supabase and R2 both require it)",
          con.execute("SELECT current_setting('s3_url_style')").fetchone()[0], "path")
    con.close()


def test_local_put_does_not_copy_a_file_onto_itself():
    """The exporter already writes into the local layout, so `put` must be a
    no-op there — copying a 4.6 GB corpus onto itself would double its cost."""
    d = tempfile.mkdtemp()
    b = cl.LocalCorpus(d)
    os.makedirs(os.path.join(d, "game_result"), exist_ok=True)
    p = os.path.join(d, "game_result", "game_result_mlb_2020.parquet")
    with open(p, "wb") as fh:
        fh.write(b"x" * 32)
    out = b.put(p, "game_result", "game_result_mlb_2020.parquet")
    check("put returns the same path", os.path.abspath(out), os.path.abspath(p))
    check("file untouched", os.path.getsize(p), 32)


for fn in (test_no_uri_is_local_and_needs_nothing, test_plain_path_is_local,
           test_s3_without_credentials_refuses,
           test_s3_with_credentials_builds_a_readable_glob,
           test_s3_configures_duckdb_without_the_scheme,
           test_local_put_does_not_copy_a_file_onto_itself):
    fn()
print("\nall corpus-location checks passed")
