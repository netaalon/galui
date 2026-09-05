---
name: hebrew-and-rtl
description: Hebrew text and right-to-left layout in Galui — name matching across spelling variants, gendered and inflected labels in source documents, PDF extraction quirks, and the CSS traps. Read before matching Hebrew names, parsing Hebrew documents, or laying out a page. Triggers on "Hebrew", "RTL", "name matching", "dir=rtl", "overflow", "parse protocol", "extract PDF".
---

# Hebrew and RTL

Every dataset here is Hebrew and the interface is right-to-left. This has caused
more bugs than any other single factor, in three distinct areas.

## Matching Hebrew names

The same person is written several ways across sources. Matching must tolerate
that **without ever guessing**.

Real cases encountered:

| Variation | Example |
|---|---|
| Optional matres lectionis | `מלביצקי` / `מילביצקי`, `עטיה` / `עטייה` |
| Middle name present or absent | `מיכל וולדיגר` / `מיכל מרים וולדיגר` |
| Partial compound surname | `אפרת רייטן` / `אפרת רייטן מרום` |
| Compound written as one word | `אלהואשלה` / `אל הואשלה` |
| Hyphen or maqaf | `רם בן ברק` / `רם בן-ברק`, `תמנו-שטה` |
| Nickname | `יוסי` / `יוסף`, `בני` / `בנימין` |
| Outright typo in the source | `יונן` for `יונתן` |

The ladder used in `scripts/load-attendance.ts`, each rung unique-or-nothing:

1. Exact on a normalised full name (hyphens to spaces, quotes stripped).
2. First token plus last name, for a dropped middle name.
3. First token plus any one surname token, for a partial compound surname.
4. A single-character difference on a key with doubled yod/vav collapsed and
   spaces removed.

**Ambiguity always drops.** 98.8% of 52,455 names resolved this way, and the
residue is source-side typos, which should stay unmatched rather than be
guessed into the wrong person.

A full name spans two database columns, so `contains` on the whole string
matches nothing — split the query into words and require each to appear in some
name field. That bug made searching "עופר כסיף" return zero results.

## Parsing Hebrew documents

- **Labels inflect by gender and number.** A committee section header is
  `חברי הוועדה`, `חברות הוועדה`, `חבר הוועדה` or `חברת הוועדה` depending on who
  is present. Missing only the singular feminine form caused every failure in a
  400-protocol sample. The definite article is sometimes dropped too
  (`חברי כנסת` for `חברי הכנסת`). Enumerate all forms.
- **Synonyms exist.** `נוכחים:` and `מוזמנים:` both introduce officials.
- **Word-final tsadi is always `ץ`, never `צ`.** So a `צ` at a word boundary in
  extracted PDF text is not a letter — it is the period, which the Knesset's
  font maps to that codepoint. That rule makes an otherwise unreadable
  extraction deterministic.
- **PDF word order varies by document family.** `הצעת חוק לדיון מוקדם` extracts
  in visual order (the heading reads `הסבר דברי`, reversed); `לקריאה הראשונה`
  extracts logically. Detect, do not assume.
- Directional marks (`‎`, `‏`) and BOMs appear mid-line and must be
  stripped before matching. Knesset OOXML uses `﻿` as a word separator.
- Dashes are unreliable: `משה פסל– היו"ר` has no space before the dash. Allow
  en/em dashes without surrounding space, but require space around a plain
  hyphen, since Hebrew surnames contain one.

## RTL layout

- Use logical properties everywhere: `ms-`/`me-`, `ps-`/`pe-`, `start-`/`end-`,
  `border-s`. Never `left`/`right`.
- **Long Hebrew strings overflow constantly.** Faction names run past 60
  characters (`התאחדות הספרדים שומרי תורה תנועתו של מרן הרב עובדיה יוסף זצ"ל`).
  Two recurring fixes: `min-w-0` on grid and flex children, which do not shrink
  below their content by default; and `whitespace-normal` plus `h-auto` on
  badges, which default to `nowrap` and `shrink-0`.
- Always check `scrollWidth` against `clientWidth` at 390px. The smoke suite
  does this; overflow has appeared three separate times.
- **Charts stay LTR.** Recharts positions axes physically, and time reading
  left-to-right is the convention in Hebrew dashboards. Wrap the plot in
  `dir="ltr"` and set the tooltip to `direction: rtl`.
- Recharts writes `fill` as an SVG attribute, which beats a Tailwind class — pass
  theme colours through the `tick` prop or labels stay a hardcoded grey that is
  unreadable in dark mode.

## Formatting

All dates render in **UTC** deliberately: the API sends no zone offset, so
rendering in UTC preserves the wall-clock time the Knesset published. Use the
helpers in `src/lib/format.ts` rather than `toLocaleString` directly, and
`countLabel()` for counts — Hebrew needs "סעיף אחד", not "1 סעיפים".
