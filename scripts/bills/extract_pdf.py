"""Deterministic extraction of Hebrew text from the Knesset gazette PDFs.

Government bills are published only as PDFs of רשומות, and every naive route
into them is wrong in a different way:

  * pypdf returns the right word order with a broken glyph map — every ל
    becomes ת ("כלי רכב" reads "כתי רכב") — and the damage differs per file,
    so no single remapping fixes it.
  * poppler's pdftotext gets the characters right and interleaves the two
    columns line by line, so consecutive words end up a whole column apart.
  * pymupdf's get_text() has the characters right too but reverses runs.

What works is pymupdf's per-glyph data — Unicode *and* a bounding box — plus
four corrections, each of which was wrong until a human checked the output
against the printed page (scripts/bills/verify_extraction.py):

  1. bidi: sort glyphs right-to-left, then flip each digit/Latin run back.
     Do NOT mirror parentheses; the paint order already stores them logically.
  2. columns: right column before left, and drop lines too wide to be either,
     which is the amended-law text set full width above the notes.
  3. layout: drop footnotes by font size and running heads by position.
  4. spelling: unify dash variants, the Hebrew maqaf U+05BE among them.

Sub-headings ("לסעיף קטן (ב)", "סעיף 3") are tagged rather than flattened, so
the notes keep the shape the printed page gives them.

Requires pymupdf, unlike the rest of the Python here, which is standard
library only.
"""
import json, re, statistics, sys, unicodedata, urllib.request
import pymupdf

MARKS = re.compile(r'[‎‏‪-‮﻿]')
# '%' rides with the number it belongs to: without it, "ב-50%" comes out
# "ב-%50" — the percent lands on the wrong side of the digits.
LTR = re.compile(r'[0-9A-Za-z%]')
# The documents use the Hebrew maqaf U+05BE, not a hyphen.
DASH = str.maketrans({'‐':'-','‑':'-','‒':'-','–':'-','—':'-','−':'-','­':'','־':'-'})

def clean(t):
    return ' '.join(unicodedata.normalize('NFC', MARKS.sub('', t)).translate(DASH).split())

def line_logical(chars):
    """Glyphs right-to-left, with each LTR run flipped back to logical order."""
    seq = [c for _, c in sorted(chars, key=lambda t: -t[0])]
    out, i = [], 0
    while i < len(seq):
        if LTR.match(seq[i]):
            j = i
            while j < len(seq) and (LTR.match(seq[j]) or
                  (seq[j] in '.,:/-' and j + 1 < len(seq) and LTR.match(seq[j + 1]))):
                j += 1
            out.extend(reversed(seq[i:j])); i = j
        else:
            out.append(seq[i]); i += 1
    return ''.join(out)

# Explanatory notes carry run-in sub-headings — "לסעיף קטן (ב)", "כללי" —
# set bold on their own short line. They are extracted correctly, but joining
# lines with a space swallows them mid-sentence: "…מסורת הדלקה ארוכת שנים.
# לסעיף קטן (ב) בסעיף קטן (ב) מוצע לקבוע…" reads as a stutter. Tagging them
# keeps the structure, and the notes gain the shape the printed page has.
HEADING = re.compile(
    r'^\)?\s*('
    r'לסעיף|לסעיפים|לפסקה|לפסקאות|לפרט|לתוספת|כללי'
    # Singular and plural spelled out: 'סעיפים?' would mean 'סעיפי' plus an
    # optional ם, which never matches סעיף — the final pe is a different letter.
    r'|סעיף\s+\d|סעיפים\s+\d'
    r')\b')

def is_heading(spans, width, text):
    """Bold, short, and opening with a section reference.

    Boldness is weighed by character, not by span: "סעיף 3" arrives as a bold
    span plus a Medium one holding the space, so requiring every span to be
    bold missed a whole class of sub-heading.
    """
    if not spans or width >= 120 or not HEADING.match(text):
        return False
    bold = sum(len(sp.get('text', '') or ''.join(c['c'] for c in sp.get('chars', [])))
               for sp in spans if 'Bold' in sp['font'])
    total = sum(len(sp.get('text', '') or ''.join(c['c'] for c in sp.get('chars', [])))
                for sp in spans) or 1
    return bold / total >= 0.6


# A line much wider than a column is not part of the two-column notes: the
# amended-law text above them is set full width (308pt against a 189pt
# column). Assigning such a line to a column by its midpoint dropped it into
# the middle of the notes — which is how a sentence from the top of page 3
# arrived immediately after "כמפורט להלן:".
#
# Bands derived from each column's min/max were tried and are wrong: they
# overlap (left [36,353], right [181,443]), so a narrow sub-heading at
# [184,229] satisfies both and lands in whichever is tested first, which
# separated "לסעיף קטן (ג)" from its own paragraph.
COLUMN_SLACK = 1.3


def paragraphs(path):
    doc = pymupdf.open(path)
    sizes = [round(sp['size'], 0) for p in doc for b in p.get_text('dict')['blocks']
             if b.get('type') != 1 for l in b.get('lines', []) for sp in l['spans']]
    body = statistics.mode(sizes)
    out = []
    for page in doc:
        top = page.rect.y0 + page.rect.height * 0.055
        bot = page.rect.y1 - page.rect.height * 0.075
        rows = []
        med = statistics.median([ln['bbox'][2] - ln['bbox'][0]
                                 for b in page.get_text('dict')['blocks'] if b.get('type') != 1
                                 for ln in b.get('lines', [])] or [1])
        for blk in page.get_text('rawdict')['blocks']:
            if blk.get('type') == 1: continue
            for ln in blk.get('lines', []):
                # Footnotes run 8.0pt against a 9.0pt body — `>= body - 1`
                # let them through by exactly zero margin, and citation lines
                # ("דיני מדינת ישראל, נוסח חדש…") landed mid-sentence.
                spans = [sp for sp in ln['spans'] if sp['size'] > body - 0.75]
                ch = [(c['bbox'][0], c['c']) for sp in spans for c in sp['chars']]
                y = ln['bbox'][1]
                if not ch or y < top or y > bot: continue
                t = clean(line_logical(ch))
                x0, x1 = ln['bbox'][0], ln['bbox'][2]
                rows.append({'mid': (x0 + x1) / 2, 'x0': x0, 'w': x1 - x0,
                             'y': y, 'x1': x1, 't': t,
                             'kind': 'heading' if is_heading(spans, ln['bbox'][2] - ln['bbox'][0], t)
                                     else 'body',
                             'med': med, 'page': page.number + 1})
        # The same line is sometimes painted twice; keep the first.
        seen, uniq = set(), []
        for r in rows:
            key = (r['t'], round(r['y'], 1))
            if key in seen: continue
            seen.add(key); uniq.append(r)
        rows = uniq

        rows = [r for r in rows if r['w'] <= r['med'] * COLUMN_SLACK]
        mid = (page.rect.x0 + page.rect.x1) / 2
        right = [r for r in rows if r['mid'] >= mid]
        left = [r for r in rows if r['mid'] < mid]
        for col in (right, left):
            out += [r for r in sorted(col, key=lambda r: (round(r['y'], 1), -r['x1'])) if r['t']]
    return out

def explanation(lines):
    """Everything after the heading, which is letter-spaced for emphasis."""
    for i, r in enumerate(lines):
        if r['t'].replace(' ', '').startswith('דבריהסבר'):
            return lines[i + 1:], r['page']
    return [], None

def assemble(lines):
    """Join body lines into paragraphs, keeping sub-headings as their own block."""
    out, buf = [], []
    for r in lines:
        if r['kind'] == 'heading':
            if buf: out.append({'kind': 'body', 'text': ' '.join(buf)}); buf = []
            out.append({'kind': 'heading', 'text': r['t']})
        else:
            buf.append(r['t'])
    if buf: out.append({'kind': 'body', 'text': ' '.join(buf)})
    return out


if __name__ == '__main__':
    print(json.dumps([r for r in paragraphs(sys.argv[1])], ensure_ascii=False))
