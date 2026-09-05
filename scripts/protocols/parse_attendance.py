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
    קרן דקל
    –
    יועצת בכירה לשר, משרד האוצר
    רישום פרלמנטרי:
    סיגל גורדון
    << נושא >> …body begins…

So this is a section-label parser, not an inference engine — no LLM involved.

Measured over 400 protocols sampled evenly across all 9,135, spanning 2023-02
to 2026-08: header, committee members and chair all found in 100%; of 1,430
member names, 1,428 (99.9%) matched a Person exactly and none ambiguously. The
two misses are source-side — one protocol omits a middle name, another
misspells "יונתן" as "יונן" — and are left unmatched rather than guessed.

This yields attendance, not an official roster: a member who never attends will
not appear. Aggregate across a committee's sittings for its composition.
"""

import re

SECTION_LABELS = {
    # Hebrew inflects these by gender and number, and a one-woman sitting is
    # headed "חברת הוועדה" — omitting that singular feminine form alone
    # accounted for every failure in an early 400-protocol run.
    "members":  ["חברי הוועדה", "חברות הוועדה", "חבר הוועדה", "חברת הוועדה",
                 "חברי הועדה", "חברות הועדה", "חבר הועדה", "חברת הועדה"],
    # The definite article is sometimes dropped ("חברי כנסת:").
    "mks":      ["חברי הכנסת", "חברות הכנסת", "חבר הכנסת", "חברת הכנסת",
                 "חברי כנסת", "חברות כנסת", "חבר כנסת", "חברת כנסת"],
    # "נוכחים" ("present") is a synonym for "מוזמנים" that introduces officials.
    # Not recognising it left the parser in the preceding members section, where
    # it read every official's name *and* job title as committee members —
    # 7% of member names in a 400-protocol sample.
    "invitees": ["מוזמנים", "נוכחים", "נוכחות", "משתתפים",
                 "מוזמנים באמצעים מקוונים", "משתתפים באמצעים מקוונים",
                 "מוזמנים באמצעי תקשורת מקוונים", "נוכחים באמצעים מקוונים"],
    "legal":    ["ייעוץ משפטי", "יעוץ משפטי"],
    "manager":  ["מנהלת הוועדה", "מנהל הוועדה", "מנהל/ת הוועדה",
                 "מנהלת הועדה", "מנהל הועדה"],
    "recorder": ["רישום פרלמנטרי", "קצרנית", "רשמת פרלמנטרית"],
}
LABEL_TO_SECTION = {label: sec for sec, labels in SECTION_LABELS.items() for label in labels}

HEB = r"֐-׿"

# Bare role labels appear on their own lines inside the sections and are not
# people; two of these leaked into an early sample as attendee names.
ROLE_ONLY = re.compile(
    rf'^(?:(?:חבר|חברת|חברי|חברות)\s+(?:הכנסת|הוועדה|הועדה)'
    rf'|(?:יושב|יושבת)[־\- ]ראש(?:\s+.*)?'
    rf'|יו"ר(?:\s+.*)?'
    rf'|נכחו|נוכחים)$'
)

# The body opens with bracketed structure markers — << נושא >>, << יור >>,
# << דובר >> — present in every one of 400 protocols checked. Without a hard
# boundary the parser runs on and swallows the entire transcript: an early
# version produced ~1,000 "attendees" per sitting.
BODY_MARKER = re.compile(r"<<[^>]*>>")
DISCLAIMER = re.compile(r"^רשימת הנוכחים")
# Safety net. The first terminator sat at line 173 in the worst case observed.
MAX_HEADER_LINES = 400

CHAIR = re.compile(r'היו"ר|יו"ר')
# The dash before a role is not reliably spaced ("משה פסל– היו״ר"), so en/em
# dashes need no surrounding space. A plain hyphen does, because Hebrew
# surnames use one ("תמנו-שטה").
ROLE_SPLIT = re.compile(r"\s*[–—]\s*|\s+-\s+")


def _section_for(line):
    match = re.match(r"^(?:<<[^>]*>>\s*)?(.{2,44}?)\s*:\s*$", line)
    return LABEL_TO_SECTION.get(match.group(1).strip()) if match else None


def parse_attendees(paragraphs):
    """-> {members, mks, invitees, legal, manager, recorder, chair} or None.

    Every entry is {"name", "title"}; `title` is the role for a member
    (`היו"ר`) or the job and organisation for an official.
    """
    start = next((i for i, l in enumerate(paragraphs) if re.match(r"^נכחו\s*:?\s*$", l)), None)
    if start is None:
        return None

    out = {key: [] for key in SECTION_LABELS}
    chair = None
    section = None
    pending_name = None

    for line in paragraphs[start + 1 : start + 1 + MAX_HEADER_LINES]:
        if BODY_MARKER.search(line) or DISCLAIMER.match(line):
            break

        found = _section_for(line)
        if found:
            section = found
            pending_name = None
            continue

        # A line ending in a colon is a label, never a person. Section labels
        # were matched just above, so anything reaching here is a variant we do
        # not model — skipping it is right either way, and stops strings like
        # "משתתפים (באמצעים מקוונים):" being stored as attendees.
        if line.endswith(":"):
            section = None
            continue

        if section is None or ROLE_ONLY.match(line) or not re.search(rf"[{HEB}]", line):
            continue

        # Entries come in two layouts: "name – title" on one line, or split
        # across three paragraphs as name / "–" / title. A standalone dash
        # therefore means the next line belongs to the previous entry, and must
        # never start a new one.
        if line in ("–", "—", "-"):
            expect_title = out[section][-1] if out[section] else None
            pending_name = expect_title
            continue

        if pending_name is not None:
            pending_name["title"] = line
            if section == "members" and CHAIR.search(line) and chair is None:
                chair = pending_name["name"]
            pending_name = None
            continue

        name, has_title, title = _split_role(line)
        if not name or ROLE_ONLY.match(name):
            continue
        entry = {"name": name, "title": title if has_title else None}
        out[section].append(entry)
        if section == "members" and has_title and title and CHAIR.search(title) and chair is None:
            chair = name

    return {**out, "chair": chair}


def _split_role(line):
    parts = ROLE_SPLIT.split(line, maxsplit=1)
    name = parts[0].strip(" ,")
    if len(parts) > 1:
        return name, True, parts[1].strip()
    return name, False, None
