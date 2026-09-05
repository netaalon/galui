"""Extract committee attendance from protocol documents.

    python3 scripts/protocols/extract_attendance.py            # everything
    python3 scripts/protocols/extract_attendance.py --limit 200
    python3 scripts/protocols/extract_attendance.py --committee 4186

Reads the protocol list straight from the SQLite mirror (read-only), downloads
each document, parses its `נכחו:` header and appends one JSON object per
protocol to a JSONL cache. scripts/load-attendance.ts then loads that into the
database through Prisma.

The documents are NOT kept. At ~148 KB each, all 9,133 protocols would be about
1.4 GB, and only the header is wanted — so each is parsed in memory and
discarded. The JSONL cache is a few MB and makes re-runs nearly free.
"""

import argparse
import concurrent.futures
import gzip
import io
import json
import os
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_text import paragraphs
from parse_attendance import parse_attendees

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DB = os.path.join(ROOT, "prisma", "dev.db")
OUT = os.path.join(ROOT, "data", "attendance.jsonl")
# The documents themselves are ~1.4 GB and are never kept, but re-parsing after
# a parser change then means downloading all 9,135 again — which cost two full
# passes before this cache existed. Only the header region is retained, gzipped;
# a parser change can then be replayed offline with --from-cache.
HEADERS = os.path.join(ROOT, "data", "protocol-headers.jsonl.gz")
HEADER_LINES = 260
UA = "galui/0.1 (Knesset legislative tracker; https://github.com/netaalon/galui)"

parser = argparse.ArgumentParser()
parser.add_argument("--limit", type=int)
parser.add_argument("--committee", type=int)
parser.add_argument("--refresh", action="store_true", help="re-parse documents already in the cache")
parser.add_argument("--from-cache", action="store_true",
                    help="re-parse the stored header text without downloading anything")
parser.add_argument("--workers", type=int, default=4)
args = parser.parse_args()

os.makedirs(os.path.dirname(OUT), exist_ok=True)

done = set()
if os.path.exists(OUT) and not args.refresh:
    with open(OUT, encoding="utf-8") as f:
        for line in f:
            try:
                done.add(json.loads(line)["documentId"])
            except Exception:
                pass

con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
sql = """
  SELECT d.id, d.filePath, d.committeeSessionId, cs.committeeId
    FROM SessionDocument d
    JOIN CommitteeSession cs ON cs.committeeSessionId = d.committeeSessionId
   WHERE d.groupTypeDesc LIKE '%פרוטוקול%' AND d.filePath IS NOT NULL
"""
params = []
if args.committee:
    sql += " AND cs.committeeId = ?"
    params.append(args.committee)
sql += " ORDER BY cs.startDate DESC"
rows = [r for r in con.execute(sql, params) if r[0] not in done]
con.close()
if args.limit:
    rows = rows[: args.limit]

print(f"{len(rows)} protocols to parse ({len(done)} already cached) → {OUT}")
if not rows:
    sys.exit(0)


def replay_from_cache():
    """Re-run the parser over cached header text. No network."""
    if not os.path.exists(HEADERS):
        print(f"no header cache at {HEADERS} — run a normal pass first")
        return 1
    parsed = failed = people = 0
    with gzip.open(HEADERS, "rt", encoding="utf-8") as src, open(OUT, "w", encoding="utf-8") as dst:
        for line in src:
            rec = json.loads(line)
            attendees = parse_attendees(rec["lines"])
            if attendees is None:
                failed += 1
                continue
            out = {
                "documentId": rec["documentId"],
                "committeeSessionId": rec["committeeSessionId"],
                "committeeId": rec["committeeId"],
                "chair": attendees["chair"],
                "sections": {k: attendees[k] for k in
                             ("members", "mks", "invitees", "legal", "manager", "recorder")},
            }
            people += sum(len(v) for v in out["sections"].values())
            dst.write(json.dumps(out, ensure_ascii=False) + "\n")
            parsed += 1
    print(f"replayed {parsed} protocols from cache, {people} attendee rows, {failed} without a header")
    return 0


if args.from_cache:
    sys.exit(replay_from_cache())

lock = threading.Lock()
counts = {"parsed": 0, "no_header": 0, "failed": 0, "people": 0}
errors = {}


def fetch(url, attempts=4):
    """Download with backoff.

    Sustained concurrency against fs.knesset.gov.il draws transient resets and
    throttling: a first run without retries lost 6,108 of 9,135 documents, and
    every one of them succeeded on a later attempt. Failures here are almost
    never permanent.
    """
    last = None
    for attempt in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001 - recorded and retried
            last = exc
            time.sleep(1.5 * (2 ** attempt))
    raise last
out_file = open(OUT, "w" if args.refresh else "a", encoding="utf-8")
header_file = gzip.open(HEADERS, "wt" if args.refresh else "at", encoding="utf-8")


def handle(row):
    doc_id, url, session_id, committee_id = row
    try:
        blob = fetch(url)
    except Exception as exc:  # noqa: BLE001 - surfaced in the summary
        with lock:
            counts["failed"] += 1
            key = type(exc).__name__
            errors[key] = errors.get(key, 0) + 1
        return

    try:
        # Parsed straight from memory; the document is never written to disk.
        paras = paragraphs(io.BytesIO(blob))
        attendees = parse_attendees(paras)
    except Exception as exc:  # noqa: BLE001 - surfaced in the summary
        with lock:
            counts["failed"] += 1
            key = f"parse:{type(exc).__name__}"
            errors[key] = errors.get(key, 0) + 1
        return

    if attendees is None:
        with lock:
            counts["no_header"] += 1
        return

    record = {
        "documentId": doc_id,
        "committeeSessionId": session_id,
        "committeeId": committee_id,
        "chair": attendees["chair"],
        "sections": {k: attendees[k] for k in ("members", "mks", "invitees", "legal", "manager", "recorder")},
    }
    n = sum(len(v) for v in record["sections"].values())
    with lock:
        out_file.write(json.dumps(record, ensure_ascii=False) + "\n")
        header_file.write(json.dumps(
            {"documentId": doc_id, "committeeSessionId": session_id,
             "committeeId": committee_id, "lines": paras[:HEADER_LINES]},
            ensure_ascii=False) + "\n")
        counts["parsed"] += 1
        counts["people"] += n
        total = counts["parsed"] + counts["no_header"] + counts["failed"]
        if total % 100 == 0:
            out_file.flush()
            print(f"  … {total}/{len(rows)}  parsed={counts['parsed']} people={counts['people']} "
                  f"noHeader={counts['no_header']} failed={counts['failed']}", flush=True)


with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as ex:
    list(ex.map(handle, rows))
out_file.close()
header_file.close()

print(f"\nparsed {counts['parsed']} protocols, {counts['people']} attendee rows")
print(f"  no נכחו header: {counts['no_header']}")
print(f"  download/parse failures: {counts['failed']}")
for key, n in sorted(errors.items(), key=lambda kv: -kv[1]):
    print(f"    {key}: {n}")
