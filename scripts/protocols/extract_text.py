"""Extract text from a Knesset committee protocol.

The service lists these as `.doc`, but every one sampled (490 across 81
committees) is actually OOXML with a legacy extension, so the standard library
is enough — no antiword, catdoc or LibreOffice needed. Check the magic bytes
before assuming: a real OLE2 `.doc` starts with D0 CF 11 E0, OOXML with "PK".
"""

import html
import re
import zipfile


def is_ooxml(source):
    if hasattr(source, "read"):
        pos = source.tell()
        head = source.read(2)
        source.seek(pos)
        return head == b"PK"
    with open(source, "rb") as f:
        return f.read(2) == b"PK"


def paragraphs(source):
    """Text paragraphs of the document, in order, blanks dropped.

    `source` is a path or any file-like object, so a download can be parsed
    from memory without being written to disk.
    """
    with zipfile.ZipFile(source) as z:
        name = "word/document.xml"
        if name not in z.namelist():
            candidates = [n for n in z.namelist() if n.endswith("document.xml")]
            if not candidates:
                return []
            name = candidates[0]
        xml = z.read(name).decode("utf-8", "replace")

    # Paragraph and break elements become newlines before tags are stripped,
    # otherwise the whole document collapses into one line.
    xml = re.sub(r"</w:p\s*>", "\n", xml)
    xml = re.sub(r"<w:tab\s*/>", "\t", xml)
    xml = re.sub(r"<w:br\s*/>", "\n", xml)
    text = html.unescape(re.sub(r"<[^>]+>", "", xml))

    out = []
    for line in text.split("\n"):
        # Directional marks and BOMs appear mid-line in these files.
        line = re.sub(r"[‎‏﻿]", "", line)
        line = re.sub(r"[ \t]+", " ", line).strip()
        if line:
            out.append(line)
    return out
