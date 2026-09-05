"""Re-run the attendance-parser verification.

    python3 scripts/protocols/verify.py [sample.tsv]

Downloads each protocol in the sample (cached), parses its attendance header and
reports the yield. Name matching against the Person table is not done here — it
needs the database; see the numbers recorded in parse_attendance.py.
"""
import collections
import concurrent.futures
import os
import statistics
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract_text import paragraphs
from parse_attendance import parse_attendees

SAMPLE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "verification-sample.tsv")
CACHE = os.environ.get("PROTOCOL_CACHE", "/tmp/galui-protocols")
os.makedirs(CACHE, exist_ok=True)

rows = [l.split("\t") for l in open(SAMPLE, encoding="utf-8").read().split("\n") if l]


def fetch(row):
    doc_id, url = row[0], row[1]
    path = os.path.join(CACHE, f"{doc_id}.bin")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    try:
        with urllib.request.urlopen(url, timeout=120) as r, open(path, "wb") as f:
            f.write(r.read())
        return path
    except Exception:
        return None


print(f"{len(rows)} protocols; cache: {CACHE}")
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as ex:
    paths = list(ex.map(fetch, rows))

stats = collections.Counter()
member_counts = []
for row, path in zip(rows, paths):
    if not path:
        stats["download failed"] += 1
        continue
    parsed = parse_attendees(paragraphs(path))
    if parsed is None:
        stats["no נכחו header"] += 1
        continue
    stats["header found"] += 1
    if parsed["members"]:
        stats["members found"] += 1
        member_counts.append(len(parsed["members"]))
    if parsed["chair"]:
        stats["chair found"] += 1
    if parsed["invitees"]:
        stats["invitees found"] += 1

n = len(rows)
for key, value in stats.most_common():
    print(f"  {key:<20} {value:>4}  ({round(100 * value / n)}%)")
if member_counts:
    print(f"  members/protocol: median {statistics.median(member_counts):.0f}, max {max(member_counts)}")
