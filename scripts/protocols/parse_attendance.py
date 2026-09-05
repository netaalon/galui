"""Parse the attendance header of a Knesset committee protocol.

Committee membership is not published by the OData service — the position types
"יו״ר ועדה" (41) and "חבר ועדה" (42) are defined in KNS_Position but have zero
rows in KNS_PersonToPosition, and no row there carries a CommitteeID. The
protocols do carry it, in a structured header:

    נכחו:
    חברי הוועדה:
    דוד ביטן – היו"ר, יו"ר ועדת הכלכלה
    אלי דלל
    חברי הכנסת:
    עודד פורר
    מוזמנים:
    קרן דקל – יועצת בכירה לשר, משרד האוצר

So this is a section-label parser, not an inference engine — no LLM involved.

Measured on 400 protocols sampled evenly across all 9,135, spanning 2023-02 to
2026-08:

    header found            400/400   100%
    committee members found 400/400   100%
    chair identified        400/400   100%
    names extracted         1,430
      matched to a Person   1,428     99.9%
      ambiguous                 0
    chairs matched          399/400    99.8%

The two unmatched names are source-side, not parser-side: one protocol omits a
member's middle name, another misspells "יונתן" as "יונן". Both are left
unmatched rather than guessed.

Note this yields attendance-derived membership — who actually sat in the room —
not an official roster. For a committee's real composition, aggregate across its
sittings.
"""
import re

SECTION_LABELS = {
    # Hebrew inflects these by gender and number, and a one-woman committee
    # sitting is labelled "חברת הוועדה" — omitting that singular feminine form
    # alone accounted for every failure in a 400-protocol sample.
    "members":  ["חברי הוועדה", "חברות הוועדה", "חבר הוועדה", "חברת הוועדה",
                 "חברי הועדה", "חברות הועדה", "חבר הועדה", "חברת הועדה"],
    "mks":      ["חברי הכנסת", "חברות הכנסת", "חבר הכנסת", "חברת הכנסת"],
    "invitees": ["מוזמנים", "מוזמנים באמצעים מקוונים", "משתתפים באמצעים מקוונים",
                 "מוזמנים באמצעי תקשורת מקוונים"],
    "legal":    ["ייעוץ משפטי", "יעוץ משפטי"],
    "manager":  ["מנהלת הוועדה", "מנהל הוועדה", "מנהל/ת הוועדה", "מנהלת הועדה"],
    "recorder": ["רישום פרלמנטרי", "קצרנית", "רשמת פרלמנטרית"],
}
LABEL_TO_SECTION = {lab: sec for sec, labs in SECTION_LABELS.items() for lab in labs}

HEB = r"֐-׿"
# Role phrases that appear on their own line inside an attendance section and
# are not people: "חבר הכנסת" as a bare label, a committee chair's title with
# no name attached, and so on. Two of these leaked into a 351-name sample.
ROLE_ONLY = re.compile(
    rf'^(?:(?:חבר|חברת|חברי|חברות)\s+(?:הכנסת|הוועדה|הועדה)'
    rf'|(?:יושב|יושבת)[־\- ]ראש(?:\s+.*)?'
    rf'|יו"ר(?:\s+.*)?'
    rf'|נכחו|נוכחים|קרן|—|–)$'
)
# A body speaker heading, e.g. `היו"ר ינון אזולאי:` or `נעמה לזימי (העבודה):`.
SPEAKER = re.compile(rf'^(?:<<[^>]*>>\s*)?(?:היו"ר\s+)?[{HEB}\'"׳״ \-]{{2,40}}(?:\s*\([^)]{{1,40}}\))?\s*:$')
CHAIR = re.compile(r'היו"ר|יו"ר')


def _label(line):
    m = re.match(r"^(?:<<[^>]*>>\s*)?(.{2,40}?)\s*:\s*$", line)
    if not m:
        return None
    return LABEL_TO_SECTION.get(m.group(1).strip())


def parse_attendees(paragraphs):
    """-> {section: [entries]} plus `chair`, or None if there is no header."""
    start = next((i for i, l in enumerate(paragraphs) if re.match(r"^נכחו\s*:?\s*$", l)), None)
    if start is None:
        return None

    out = {k: [] for k in SECTION_LABELS}
    chair = None
    section = None
    pending = None  # invitee name awaiting its "–" title

    for line in paragraphs[start + 1:]:
        sec = _label(line)
        if sec:
            section = sec
            pending = None
            continue

        # An unlabelled `name:` line means the body has started.
        if line.endswith(":") and SPEAKER.match(line):
            break
        if re.match(r"^(סדר[- ]היום|פרוטוקול|הכנסת)\b", line):
            continue

        if section is None:
            continue

        if section in ("members", "mks"):
            # `NAME – ROLE` or just `NAME`; the chair is flagged in the role.
            # The dash is not reliably spaced ("משה פסל– היו״ר"), so en/em
            # dashes need no surrounding space. A plain hyphen does, because
            # Hebrew surnames use one ("תמנו-שטה").
            parts = re.split(r"\s*[–—]\s*|\s+-\s+", line, maxsplit=1)
            name = parts[0].strip(" ,")
            role = parts[1].strip() if len(parts) > 1 else None
            if not name or not re.search(rf"[{HEB}]", name):
                continue
            # A bare role label is not an attendee.
            if ROLE_ONLY.match(name):
                continue
            out[section].append({"name": name, "role": role})
            if section == "members" and role and CHAIR.search(role) and chair is None:
                chair = name
        else:
            # Invitees often span paragraphs: name / "–" / title.
            if line in ("–", "—", "-"):
                continue
            if pending is not None:
                out[section].append({"name": pending, "title": line})
                pending = None
                continue
            parts = re.split(r"\s+[–—]\s+", line, maxsplit=1)
            if len(parts) > 1:
                out[section].append({"name": parts[0].strip(), "title": parts[1].strip()})
            else:
                pending = line.strip()
                out[section].append({"name": pending, "title": None})
                # keep `pending` so a following title line can attach
                pending = None if len(out[section]) == 0 else pending
    return {**out, "chair": chair}
