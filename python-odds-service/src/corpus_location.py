"""Phase 5.2c — WHERE the corpus lives, behind one interface.

The corpus is written once and read in bulk, so its destination is a deployment
decision rather than an architectural one. This module makes it exactly that:
`corpus_location()` returns a backend, and every caller — the exporter, the
fitters, the verifier — speaks to it the same way.

TWO BACKENDS TODAY.

  local   a directory. Works with no credentials, and is a legitimate
          destination rather than a stub: the operator already runs
          OddsHarvester and the weekly backup from this machine.

  s3      any S3-compatible object store. Supabase Storage speaks S3, and so
          does Cloudflare R2, so the SAME backend serves both and the choice
          between them is an endpoint string.

WHICH TO CHOOSE, and it is not obvious in the way it first looked. The original
argument was "Supabase Storage, because it is the same account and skips a
vendor". That still holds for setup, but the egress argument that made R2
attractive got WEAKER, not stronger, once 5.1 landed: the reason to fear egress
was a worker streaming the corpus every hour, and 5.1 removed exactly that. What
remains is a fitter reading the corpus occasionally, mostly from the operator's
own machine.

So: start local, because it needs no credential and the export already works;
move to Supabase Storage when the corpus should outlive this machine; move to R2
only if something starts doing repeated bulk reads from Render. Each move is a
bucket copy and an env var, which is the point of this file.

WHAT IS DELIBERATELY NOT HERE: any delete. This module addresses storage
locations; dropping rows from Postgres is 5.2d and goes through
`corpus_store.deletion_manifest`, which refuses without a verified copy.
"""
from __future__ import annotations

import os
from dataclasses import dataclass

# READ THROUGH `config.env`, NOT `os.environ` DIRECTLY. Real environment
# variables still win -- that is how Render supplies them -- but this also picks
# up `.env.local`, which is where a local operator actually puts a credential
# and which is gitignored. Reading os.environ alone would have meant setting
# CORPUS_S3_* correctly in .env.local and still being told the corpus was not
# configured, with nothing to point at.
try:
    from config import env as _env
except ImportError:                     # importable without the worker's config
    def _env(key, default=None):
        return os.environ.get(key, default)

# Set to a directory path, or to s3://bucket/prefix. Absent means "local, in
# the default directory" so a developer needs no configuration at all.
_PLACEHOLDER_PREFIX = "REPLACE"

CORPUS_URI = _env("CORPUS_URI") or ""
# A bucket still named REPLACE_... is not a bucket.
if _PLACEHOLDER_PREFIX in CORPUS_URI.upper():
    CORPUS_URI = ""

# S3-compatible credentials. For SUPABASE STORAGE these are NOT the anon key and
# NOT the service-role key — Supabase issues separate S3 access keys from
# Storage settings, and the endpoint looks like
# https://<project>.supabase.co/storage/v1/s3 with a region from the dashboard.
# For R2 they are the R2 token's key pair.
# A PLACEHOLDER COUNTS AS UNSET. `.env.local` ships this block with
# REPLACE_* filler so the operator has the right shape to edit, and filler is
# non-empty -- so a plain truthiness check would decide the corpus WAS
# configured and hand `REPLACE_ACCESS_KEY_ID` to S3. The failure would be a
# signature error from boto3 naming nothing useful, instead of the message this
# module wrote specifically to say which key is wanted.

def _cred(key: str, default: str = "") -> str:
    v = (_env(key) or "").strip()
    return "" if v.startswith(_PLACEHOLDER_PREFIX) else (v or default)


CORPUS_S3_ENDPOINT = _cred("CORPUS_S3_ENDPOINT")
CORPUS_S3_REGION = _cred("CORPUS_S3_REGION", "us-east-1")
CORPUS_S3_KEY_ID = _cred("CORPUS_S3_KEY_ID")
CORPUS_S3_SECRET = _cred("CORPUS_S3_SECRET")

DEFAULT_LOCAL_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "corpus")


class CorpusBackend:
    """A place the corpus can live. Two operations: put a file, and name a
    glob that DuckDB can read."""

    def put(self, local_path: str, table: str, filename: str) -> str:
        raise NotImplementedError

    def table_glob(self, table: str) -> str:
        raise NotImplementedError

    def configure_duckdb(self, con) -> None:
        """Whatever the connection needs before it can read `table_glob`."""

    @property
    def describe(self) -> str:
        raise NotImplementedError


@dataclass
class LocalCorpus(CorpusBackend):
    root: str

    def put(self, local_path: str, table: str, filename: str) -> str:
        # The exporter already writes into this layout, so a local backend is a
        # no-op rather than a copy — moving the bytes twice would double the
        # disk cost of a 4.6 GB corpus for nothing.
        dest = os.path.join(self.root, table, filename)
        if os.path.abspath(dest) == os.path.abspath(local_path):
            return dest
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        import shutil

        shutil.copy2(local_path, dest)
        return dest

    def table_glob(self, table: str) -> str:
        return os.path.join(self.root, table, f"{table}_*.parquet")

    @property
    def describe(self) -> str:
        return f"local:{self.root}"


@dataclass
class S3Corpus(CorpusBackend):
    bucket: str
    prefix: str
    endpoint: str
    region: str
    key_id: str
    secret: str

    def _key(self, table: str, filename: str) -> str:
        parts = [p for p in (self.prefix, table, filename) if p]
        return "/".join(parts)

    def put(self, local_path: str, table: str, filename: str) -> str:
        import boto3

        s3 = boto3.client(
            "s3", endpoint_url=self.endpoint, region_name=self.region,
            aws_access_key_id=self.key_id, aws_secret_access_key=self.secret)
        key = self._key(table, filename)
        s3.upload_file(local_path, self.bucket, key)
        return f"s3://{self.bucket}/{key}"

    def table_glob(self, table: str) -> str:
        parts = [p for p in (self.prefix, table) if p]
        return f"s3://{self.bucket}/{'/'.join(parts)}/{table}_*.parquet"

    def configure_duckdb(self, con) -> None:
        # httpfs is what lets DuckDB read s3:// directly, so a fitter's query is
        # the same query whether the corpus is on disk or in a bucket.
        con.execute("INSTALL httpfs; LOAD httpfs;")
        host = self.endpoint.replace("https://", "").replace("http://", "")
        con.execute(f"SET s3_endpoint='{host}'")
        con.execute(f"SET s3_region='{self.region}'")
        con.execute(f"SET s3_access_key_id='{self.key_id}'")
        con.execute(f"SET s3_secret_access_key='{self.secret}'")
        con.execute("SET s3_url_style='path'")   # Supabase and R2 both want path style

    @property
    def describe(self) -> str:
        return f"s3://{self.bucket}/{self.prefix} @ {self.endpoint}"


class CorpusNotConfigured(RuntimeError):
    """Raised when an s3:// corpus is asked for without credentials.

    Explicit rather than silently falling back to local: a fitter that quietly
    read a stale local copy because a credential was missing would produce a
    confident number from the wrong data, which is the failure mode this whole
    phase has been built to avoid.
    """


def corpus_location(uri: str | None = None) -> CorpusBackend:
    uri = (uri if uri is not None else CORPUS_URI).strip()
    if not uri:
        return LocalCorpus(DEFAULT_LOCAL_DIR)
    if not uri.startswith("s3://"):
        return LocalCorpus(uri)
    rest = uri[len("s3://"):]
    bucket, _, prefix = rest.partition("/")
    missing = [n for n, v in (("CORPUS_S3_ENDPOINT", CORPUS_S3_ENDPOINT),
                              ("CORPUS_S3_KEY_ID", CORPUS_S3_KEY_ID),
                              ("CORPUS_S3_SECRET", CORPUS_S3_SECRET)) if not v]
    if missing:
        raise CorpusNotConfigured(
            f"CORPUS_URI is {uri!r} but {', '.join(missing)} "
            f"{'is' if len(missing) == 1 else 'are'} unset. For Supabase Storage "
            f"these are the S3 access keys from Storage settings — NOT the anon "
            f"key and NOT the service-role key.")
    return S3Corpus(bucket, prefix.strip("/"), CORPUS_S3_ENDPOINT,
                    CORPUS_S3_REGION, CORPUS_S3_KEY_ID, CORPUS_S3_SECRET)


def read_parquet_glob(backend: CorpusBackend, table: str):
    """A configured DuckDB connection plus the glob to read from it."""
    import duckdb

    con = duckdb.connect()
    con.execute("INSTALL json; LOAD json;")
    backend.configure_duckdb(con)
    return con, backend.table_glob(table)
