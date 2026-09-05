---
name: contributing-to-galui
description: How to do good work on Galui — verify against real data rather than reasoning about it, measure instead of eyeballing, and be honest about what is derived. Read before starting any change. Triggers on "contribute", "add a feature", "how should I", "verify", "test", "before committing".
---

# Contributing to Galui

This is a civic transparency site. A wrong fact on a page is worse than a
missing one: someone will quote it. Most of the rules below exist because
something quietly produced plausible-looking wrong output.

## Check the data before you design

Nearly every assumption about this API has turned out wrong at least once:
`KNS_MkIndividual` does not exist, document ids are not unique, `LastUpdatedDate`
is not when anything happened, committee membership is published nowhere. Probe
the live service with `curl` and look at real rows before writing a schema, a
query or an estimate. Read the `knesset-odata` skill first — it records what has
already been paid for.

If a conclusion rests on a filter returning nothing, **verify the filter works**.
`CommitteeID ne null` returning zero rows and the field genuinely being empty
look identical. The way to be sure was fetching all 11,102 rows and checking
locally.

## Measure, do not eyeball

Looking at one example proves nothing. The attendance parser hit 100% on the
first protocol and was still wrong four different ways.

When adding a parser, matcher or derivation:

1. Sample across the real distribution — by document kind, by committee, by
   date — not whichever record you happened to open. An early sample of bill
   PDFs was 8 government to 6 private, while private bills are 91% of the corpus.
2. Report a yield percentage over a few hundred items, not an impression.
3. **Validate against something independent.** Names extracted from protocols are
   checked against the `Person` table; 99.9% matching is evidence, "it looked
   right" is not.
4. Inspect the failures. Every one so far was either a real bug or a genuine
   source-side quirk worth knowing.
5. Check totals, not just the field you care about. Members and chair were at
   100% while the same parser was inventing ~1,000 attendees per sitting further
   down the document.

## Never guess an identity

Matching a name or an id to a person is the highest-risk operation here, because
a wrong match produces a real person's face or record on someone else's page and
nothing looks broken.

- Match exactly, or through a fallback that resolves to **exactly one** candidate.
- Ambiguous means drop, never pick.
- Where matching is unavoidably fuzzy, put a human in the loop —
  `fetch-photos.ts --propose` writes a contact sheet and nothing reaches the
  database until someone approves it.
- Two id spaces here overlap (`MKSiteCode` and `SiteId`); a wrong join returns
  the wrong person rather than an error.

## Say what is derived

Coalition membership, committee rosters, `firstStepDate` and MK status are all
inferred. Each page that shows them says so, and `src/lib/factions.ts` carries a
verification date. If you derive something new, label it where it is displayed
and record the basis in a comment — the next person cannot tell inference from
API data by looking at the column.

Prefer the honest empty state to a fabricated value. A member with no photo
shows initials; a bill with no committee stage shows none.

## Before committing

```bash
npm run typecheck && npm run lint && npm run build
npm run smoke          # app running; covers charts, controls, RTL overflow
```

The smoke suite exists because server-rendered HTML cannot prove a chart
hydrated, a control held its state, or a page did not overflow at 390px. Add a
check when you add anything interactive. Guard the *bug*, not just the feature:
after the committee card silently rendered empty for every member, the suite now
asserts it is non-empty.

Watch for horizontal overflow on mobile — RTL grids with long Hebrew strings
overflow easily, and `min-w-0` on grid children is usually the fix.

## Commit messages

Explain what was wrong and how it was found, not just what changed. The history
is the main record of why this codebase looks the way it does — that a key was
not unique, that a sample was unrepresentative, that a percentage moved. Include
the numbers.

## When something is not there

Record it. `Votes.svc` holding no Knesset 25 data is an issue (#10) so nobody
re-investigates. If you spend an afternoon proving a dead end, that afternoon is
worth writing down.
