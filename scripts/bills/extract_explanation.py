#!/usr/bin/env python3
"""Extract דברי הסבר (explanatory notes) from a bill's tabled text.

Two paths, and which one ran is recorded per bill:

1. **Structural** — private bills are published as OOXML (with a `.docx` or a
   misleading `.doc` extension), and the layout is fixed: a paragraph that is
   exactly "דברי הסבר" separates the proposed clauses from the notes. No model
   needed, and nothing to hallucinate.

2. **Model** — for the rest. Government bills exist only as PDFs of the official
   gazette, and their text layer is not trustworthy: pypdf maps every ל to a ת
   ("כלי רכב" comes out "כתי רכב") while pymupdf drops the דברי הסבר heading
   altogether. Feeding either to a model invites it to "repair" the Hebrew into
   something plausible and wrong, so for PDFs the file itself is sent, not our
   extraction of it.

Usage:
  python3 scripts/bills/extract_explanation.py --sample 10          # structural only
  python3 scripts/bills/extract_explanation.py --bills 2225221,2201624
  python3 scripts/bills/extract_explanation.py --sample 10 --model  # adds the model pass
  python3 scripts/bills/extract_explanation.py --sample 10 --model --dry-run

  ANTHROPIC_API_KEY must be set for --model. Default model: claude-sonnet-5.
"""

import argparse
import io
import json
import os
import re
import sqlite3
import sys
import urllib.request

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "protocols"))
from extract_text import paragraphs  # noqa: E402

UA = {"User-Agent": "galui/0.1 (Knesset legislative tracker; https://github.com/netaalon/galui)"}
DB = "prisma/dev.db"
PROMPT = "prompts/extract-bill-explanation.he.txt"

# The heading, and the variants seen in the corpus. Matched on a whole
# paragraph, not a substring: the phrase also appears inside notes that
# reference another bill's explanation.
HEADINGS = ("דברי הסבר", "דברי הסבר לסעיפים", "הסבר")

# Trailing boilerplate that follows the notes in the tabled text.
TAIL = re.compile(r"^(-{3,}|_{3,}|הוגש[הו] ליו|הצעות חוק מטעם|מספר פנימי)")


def bills(conn, ids=None, sample=0):
    """Bills with a tabled text, government and private, newest first."""
    sql = """
      SELECT b.billId, b.subTypeDesc, b.statusId, b.name, d.groupTypeDesc, d.filePath
        FROM Bill b JOIN BillDocument d ON d.billId = b.billId
       WHERE d.groupTypeDesc IN ('הצעת חוק לדיון מוקדם', 'הצעת חוק לקריאה הראשונה')
    """
    if ids:
        sql += " AND b.billId IN (%s)" % ",".join("?" * len(ids))
        rows = conn.execute(sql, ids).fetchall()
    else:
        # A deliberate mix: the two kinds are published in different formats.
        # Sample bill *ids* first — a bill usually has both a Word and a PDF
        # copy of the same text, so limiting the document query returns half
        # the bills asked for.
        priv = (sample * 6) // 10 or 1
        rows = []
        for sub, kind, n in (
            ("פרטית", "הצעת חוק לדיון מוקדם", priv),
            ("ממשלתית", "הצעת חוק לקריאה הראשונה", sample - priv),
        ):
            picked = [r[0] for r in conn.execute(
                """SELECT DISTINCT b.billId FROM Bill b JOIN BillDocument d ON d.billId = b.billId
                    WHERE b.subTypeDesc = ? AND d.groupTypeDesc = ?
                    ORDER BY b.billId DESC LIMIT ?""", (sub, kind, n)).fetchall()]
            if picked:
                rows += conn.execute(
                    sql + " AND b.billId IN (%s) AND d.groupTypeDesc = ?" % ",".join("?" * len(picked)),
                    picked + [kind]).fetchall()
    # One document per bill: prefer OOXML, which is the trustworthy path.
    best = {}
    for r in rows:
        prev = best.get(r[0])
        if prev is None or (r[5].endswith((".docx", ".doc")) and not prev[5].endswith((".docx", ".doc"))):
            best[r[0]] = r
    return list(best.values())


def fetch(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90).read()


def structural(blob):
    """The notes as published, or None if the heading is not there."""
    try:
        paras = list(paragraphs(io.BytesIO(blob)))
    except Exception:
        return None, 0
    for i, p in enumerate(paras):
        if p.strip().rstrip(":") in HEADINGS:
            body = []
            for q in paras[i + 1:]:
                if TAIL.match(q):
                    break
                body.append(q)
            text = "\n".join(body).strip()
            return (text or None), len(paras)
    return None, len(paras)


def model(blob, is_pdf, model_name, dry_run):
    """Send the document to the model. PDFs go as the file, never as our text."""
    prompt = open(PROMPT, encoding="utf-8").read()
    if is_pdf:
        import base64
        content = [
            {"type": "document", "source": {"type": "base64", "media_type": "application/pdf",
                                            "data": base64.b64encode(blob).decode()}},
            {"type": "text", "text": "חלץ את דברי ההסבר מהנוסח המצורף."},
        ]
    else:
        text = "\n".join(paragraphs(io.BytesIO(blob)))
        content = [{"type": "text", "text": "נוסח הצעת החוק:\n\n" + text}]

    body = {"model": model_name, "max_tokens": 4000, "system": prompt,
            "messages": [{"role": "user", "content": content}]}
    if dry_run:
        return {"dry_run": True, "chars": sum(len(c.get("text", "")) for c in content),
                "pdf": is_pdf, "model": model_name}
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return {"error": "ANTHROPIC_API_KEY is not set"}
    req = urllib.request.Request(
        "https://api.anthropic.com/v1/messages",
        data=json.dumps(body).encode(),
        headers={"content-type": "application/json", "x-api-key": key,
                 "anthropic-version": "2023-06-01"},
    )
    try:
        resp = json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        return {"error": f"{e.code} {e.read().decode()[:200]}"}
    text = "".join(b.get("text", "") for b in resp.get("content", []))
    try:
        out = json.loads(re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.M))
    except json.JSONDecodeError:
        return {"error": "model did not return JSON", "raw": text[:300]}
    out["usage"] = resp.get("usage")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=10)
    ap.add_argument("--bills", default="")
    ap.add_argument("--model", action="store_true", help="also run the model pass")
    ap.add_argument("--model-name", default="claude-sonnet-5")
    ap.add_argument("--dry-run", action="store_true", help="build the request, do not send it")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    conn = sqlite3.connect(DB)
    ids = [int(x) for x in args.bills.split(",") if x.strip()] or None
    rows = bills(conn, ids, args.sample)

    results = []
    for billId, sub, status, name, kind, url in rows:
        is_pdf = url.lower().endswith(".pdf")
        rec = {"billId": billId, "subType": sub, "statusId": status, "name": name,
               "docKind": kind, "url": url, "format": "pdf" if is_pdf else "word"}
        try:
            blob = fetch(url)
        except Exception as exc:
            rec["error"] = f"download failed: {exc}"
            results.append(rec)
            continue
        rec["bytes"] = len(blob)
        text, nparas = (None, 0) if is_pdf else structural(blob)
        rec["structuralParagraphs"] = nparas
        rec["structural"] = bool(text)
        rec["explanation"] = text
        rec["explanationChars"] = len(text) if text else 0
        if args.model and not text:
            rec["model"] = model(blob, is_pdf, args.model_name, args.dry_run)
        results.append(rec)

    ok = [r for r in results if r.get("structural")]
    print(f"bills: {len(results)}  ·  structural hit: {len(ok)}  ·  "
          f"word: {sum(1 for r in results if r['format']=='word')}  "
          f"pdf: {sum(1 for r in results if r['format']=='pdf')}")
    for r in results:
        mark = "✓" if r.get("structural") else ("·" if r["format"] == "word" else "pdf")
        print(f"  {mark} {r['billId']} {r['subType']:<8} {r['explanationChars']:>6} chars  {(r['name'] or '')[:52]}")
        if r.get("error"):
            print(f"      error: {r['error']}")
        if r.get("model"):
            print(f"      model: {json.dumps(r['model'], ensure_ascii=False)[:160]}")
    if args.out:
        json.dump(results, open(args.out, "w"), ensure_ascii=False, indent=1)
        print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()
