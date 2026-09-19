#!/usr/bin/env python3
"""Regression check: every passage a human verified as correct must survive.

The 28 passages in fixture.json were checked by eye against the printed
gazette. 24 were marked exact; those strings are ground truth and must still
appear verbatim in the extractor's output. The 4 that were marked wrong or
partial carry the defect the reviewer described, and must NOT.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_pdf as extract

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = os.path.join(HERE, 'fixtures')
# The PDFs are not committed: they are fetched on demand into a cache dir.
CACHE = os.environ.get('GALUI_PDF_CACHE', '/tmp/galui-pdf-cache')
VERDICTS = json.load(open(f'{FIX}/verdicts.json'))
fixture = {f['id']: f for f in json.load(open(f'{FIX}/verified-passages.json'))}
SOURCES = json.load(open(f'{FIX}/sources.json'))


def pdf(bill):
    import urllib.request
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f'{bill}.pdf')
    if not os.path.exists(path):
        req = urllib.request.Request(SOURCES[bill], headers={
            'User-Agent': 'galui/0.1 (Knesset legislative tracker; https://github.com/netaalon/galui)'})
        open(path, 'wb').write(urllib.request.urlopen(req, timeout=90).read())
    return path

cache = {}
def full(bill):
    if bill not in cache:
        lines, _ = extract.explanation(extract.paragraphs(pdf(bill)))
        cache[bill] = ' '.join(l['t'] for l in lines)
    return cache[bill]

ok = bad = 0
misses = []
for pid, verdict in sorted(VERDICTS.items()):
    f = fixture.get(pid)
    if not f or verdict != 'ok':
        continue
    bill = pid.split('-')[0]
    if f['text'] in full(bill):
        ok += 1
    else:
        bad += 1
        misses.append(pid)
print(f"human-verified passages still reproduced: {ok}/{ok+bad}")

# The four defects the reviewer found, each asserted directly.
def lines_of(bill):
    return extract.explanation(extract.paragraphs(pdf(bill)))[0]

checks = []
t = full('2189889')
checks.append(("column flow: notes continue into the left column, not the page top",
               'כמפורט להלן: ראשית, בפסקה' in t and 'כמפורט להלן: (26 בספטמבר' not in t))
checks.append(("percent sign sits after its number",
               'ב-50%' in t and 'ב-%50' not in t))
checks.append(("a bare 'סעיף N' is tagged as a sub-heading",
               any(l['kind'] == 'heading' and l['t'].strip() == 'סעיף 3' for l in lines_of('2220910'))))
checks.append(("footnote citations stay out of the notes",
               'דיני מדינת ישראל, נוסח חדש' not in full('2221130')))
print()
for label, passed in checks:
    print(f"  {'PASS' if passed else 'FAIL'}  {label}")
bad += sum(1 for _, p_ in checks if not p_)
if misses:
    print("  regressions:", misses)
    for pid in misses[:3]:
        print(f"\n  {pid} expected:\n    {fixture[pid]['text'][:160]}")
sys.exit(1 if bad else 0)
