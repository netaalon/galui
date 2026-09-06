# גלוי / Galui

Tracks what the Knesset is actually doing: bills and their progress through
committee and plenum, the members who sponsor them, and the sittings where they
get discussed.

This is the MVP. It covers the **25th Knesset** (the current term) and reads
**exclusively** from the official Knesset OData v4 service:

```
https://knesset.gov.il/OdataV4/ParliamentInfo/
```

> The older `/Odata/ParliamentInfo.svc` (v2/v3) still answers, and most code on
> the internet is written against it, but the Knesset's developer manual says it
> is on the way out and v4 publishes ten entity sets it never had — votes among
> them. One table, `KNS_MkSiteCode`, is still read from v2 because v4's copy
> carries person ids that resolve to nobody; see the `knesset-odata` skill.

> `oknesset.org` and `hasadna/knesset-data-pipelines` are **not** used anywhere in
> this project — their data is years stale. There are also no HTML scrapers; the
> OData service is the only source.

## Stack

Next.js 16 (App Router, RSC) · TypeScript · Tailwind v4 · shadcn/ui · Recharts ·
Prisma 7 + SQLite (via `better-sqlite3` driver adapter).

The UI is Hebrew and right-to-left, because every string in the dataset is
Hebrew. Database columns are English throughout, per the schema convention.

## Getting started

```bash
npm install
cp .env.example .env         # DATABASE_URL="file:./prisma/dev.db"
npx prisma migrate dev       # create the SQLite database
npm run ingest               # mirror the whole term (~8 min)
npm run dev
```

`npm run ingest` is safe to re-run — every write is an upsert on the OData
primary key.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run ingest` | ETL from the Knesset OData API |
| `npm run ingest -- --bills=100 --sessions=100` | Small slice, for quick local iteration |
| `npm run photos` | Fetch MK headshots from Wikimedia Commons |
| `npm run attendance` | Parse committee attendance from protocols and load it |
| `npm run extract-participants` | Phase 2 LLM protocol extraction (see below) |
| `npm run db:studio` | Browse the local database |
| `npm run typecheck` / `npm run lint` | Checks |
| `npm run smoke` | Browser smoke test (app must be running) |

## Data architecture

The ETL (`scripts/fetch-odata.ts`) mirrors OData entities into local tables:

| OData entity | Local model | Notes |
| --- | --- | --- |
| `KNS_Person` | `Person` | All ~1.2k people, so every sponsorship FK resolves |
| `KNS_PersonToPosition` | `PersonPosition` | Roles, factions, committee seats |
| `KNS_Bill` | `Bill` | |
| `KNS_BillInitiator` | `BillInitiator` | Lead sponsor = `isInitiator` |
| `KNS_Committee` | `Committee` | |
| `KNS_CommitteeSession` | `CommitteeSession` | |
| `KNS_CmtSessionItem` | `SessionItem` | Junction: bill ↔ committee session |
| `KNS_DocumentCommitteeSession` | `SessionDocument` | Protocol DOC/PDF URLs |
| `KNS_DocumentBill` | `BillDocument` | **The bill texts themselves**, per reading |
| `KNS_PlenumSession` | `PlenumSession` | All ~418 sittings of the term |
| `KNS_PlmSessionItem` | `PlenumSessionItem` | Junction: bill ↔ sitting, **with the reading stage** |
| `KNS_DocumentPlenumSession` | `PlenumDocument` | Transcripts ("דברי הכנסת", stenograms) |
| `KNS_JointCommittee` | `JointCommittee` | Which committees make up a joint one |
| `KNS_Query` | `Question` | Written questions to ministers, with both reply dates |
| `KNS_DocumentQuery` | `QuestionDocument` | The question text and the minister's reply |
| `KNS_PlenumVote` | `PlenumVote` | Plenum votes, with tallies counted at ingest |
| `KNS_PlenumVoteResult` | `PlenumVoteResult` | How each member voted. **Standalone** — see below |
| `KNS_GovMinistry` | `GovMinistry` | |
| `KNS_Status`, `KNS_ItemType`, `KNS_Faction` | `Status`, — , `Faction` | Label lookups |

A full run mirrors: 7,587 bills · 17,332 sponsorships · 10,895 committee
sittings · 13,837 agenda items · 418 plenum sittings · 14,752 plenum items ·
1,580 written questions · 52,279 documents. Adding protocol attendance
(`npm run attendance`) contributes a further 52,061 rows. The SQLite file lands
around 50 MB.

Things worth knowing, all verified against the live service:

- **`KNS_MkIndividual` does not exist** in this service, despite being widely
  referenced. "Is this person an MK" is derived from `KNS_PersonToPosition`
  rows with `PositionID` 43 (חבר הכנסת) or 61 (חברת הכנסת); faction comes from
  the `PositionID` 54 row. The ETL denormalises this onto `Person.isMk`,
  `factionName` and `roleDesc`.
- **The service caps every response at 100 rows**, whatever `$top` says. All
  paging goes through `$skip` in steps of 100.
- **Filters are limited to 100 expression nodes**, so a long `Id eq a or Id eq b`
  chain fails at ~25 ids. Child tables are fetched with `Id in (…)` instead,
  which is a single node and lets ~180 ids ride in one request — the only other
  ceiling being an undocumented ~2,100-character URL limit that 404s silently.
- **A session item is a bill** when `ItemTypeID = 2`; then `ItemID` is a
  `BillID`. This junction is what the bill timeline is built from.
- **Dates are Israeli wall-clock times stored as UTC.** v4 tags them with
  Israel's offset (`+03:00`); the ETL drops it and keeps the published wall
  clock, which is then rendered in UTC — so a sitting the Knesset published as
  10:00 shows as 10:00 on any machine, and the month buckets behind the activity
  charts fall on Israeli days.
- After ingesting sessions the ETL **backfills every bill their agendas
  reference**, committee and plenum alike, and then fetches the reading history
  of the bills that backfill brought in. Without it most timelines would be
  empty and most plenum agenda rows would be dead ends: the "recently updated"
  bill window barely overlaps the sittings, so a 100-bill sample expands to
  ~1,155 once agendas are followed. Every junction row is written only after
  that acquisition finishes, so committee and plenum links are both complete.
- **`KNS_PlmSessionItem.StatusID` is the legislative stage**, not a workflow
  state: "הונחה על שולחן הכנסת לקריאה ראשונה", "לדיון במליאה לקראת קריאה
  שלישית", and so on. It resolves against `KNS_Status`, and it is what turns a
  list of sittings into a readable reading history. Its `IsDiscussion` flag
  (an int, not a bool) separates an actual debate from merely being tabled.
- In `KNS_PlmSessionItem`, `Id` identifies the *item* and `PlenumSessionID` the
  sitting. (Under v2 that key was named `plmPlenumSessionID`, which read as the
  opposite of what it was; v4 renamed every primary key to `Id`.)
- Plenum sittings are ingested **in full** (only ~418 per term), but agendas are
  pulled only for the most recent `--plenum` sittings, plus every sitting an
  ingested bill appears in.
- Continuation bills can be read in sittings of an **earlier** term, which is not
  mirrored; those items are skipped rather than dangling.
- **Non-bill plenum items carry no status upstream** — queries, notices and
  actions under law arrive with a null `StatusID` (328 of 2,354 items). Bill
  items always carry one, so the reading history is unaffected.
- The default run mirrors a **sample**, not the whole term: 100 bills, 100
  committee sittings and 100 plenum agendas, expanding to ~1,155 bills once
  agendas are followed, out of 7,491 in Knesset 25. Raise it with `--bills` /
  `--sessions` / `--plenum`. A bill outside the sample still appears on a
  sitting's agenda, just without a link.
- **Document ids are not unique.** `$metadata` declares `DocumentBillID` /
  `DocumentCommitteeSessionID` / `DocumentPlenumSessionID` as entity keys, but
  the same document is published once per format (DOC and PDF) as separate rows
  sharing one id, differing only in `ApplicationID`. Keying on the id alone
  silently drops every alternate format, so rows are stored under a synthetic
  `"<documentId>:<applicationId>"` id.
- **Committee membership is absent from the feed this project reads.** The
  position types "יו״ר ועדה" (41) and "חבר ועדה" (42) have zero rows in
  `KNS_PersonToPosition` here, and no row carries a `CommitteeID`. It is
  recovered from the protocols instead — see below. Note it *is* published in
  the newer v4 feed (12,628 rows, 1,632 for Knesset 25); see #19.
- **`KNS_JointCommittee.JointCommitteeID` is not unique** despite being the
  declared key (the value "1" recurs); the real key is the committee pair.
- **Written questions carry their own accountability data.** `KNS_Query` gives
  both when a reply was due (`ReplyDatePlanned`) and when it arrived
  (`ReplyMinisterDate`), so lateness is arithmetic rather than inference. Of the
  1,580 questions in Knesset 25, **83% of those answered were late**, by a mean
  of 111 days and a maximum of 1,218; 479 are still unanswered. Answered
  questions store `replyDaysLate`; for unanswered ones lateness moves with the
  clock, so it is computed per request instead.
- **The votes service does not cover this Knesset.** `Odata/Votes.svc` exists
  and is well shaped, but its most recent vote is 2021-07-13 and it holds zero
  rows for Knesset 25. Nothing in this project can use it until that changes.
- **`MKSiteCode` and `SiteId` are different ids**, both small integers over
  overlapping ranges — `KNS_MkSiteCode` carries both. `SiteId` is the one
  knesset.gov.il member pages, the Knesset photo archive and Wikidata's P9770
  key on. Confusing them does not fail loudly, it returns the wrong person:
  site code 837 is חנין זועבי, SiteId 837 is חמד עמאר. Both are stored.
- **Coalition/opposition membership is not published anywhere in the service.**
  The only bloc records are two leadership posts, `PositionID` 30
  (יושב–ראש הקואליציה) and 131 (ראש האופוזיציה), one MK each. It cannot be
  inferred from who holds a portfolio either — ש"ס has eleven serving MKs and no
  current ministers, and נעם likewise, so both would come out as opposition.
  The mapping therefore lives in `src/lib/factions.ts`, is **hand-maintained**,
  and is re-applied to `Person.bloc` on every ingest. Government roles, by
  contrast, come straight from `KNS_PersonToPosition`.
- **`LastUpdatedDate` is not a date the bill happened.** The Knesset rewrites it
  in bulk: when an MK resigns, every pending bill they sponsored is restamped
  with that day and given the reason "חה\"כ המציע התפטר". One member's
  resignation put 99 bills into a single month, and 60% of the corpus dates
  differently under the two definitions. Bills therefore carry a derived
  `firstStepDate` — the earliest sitting that had them on its agenda — and every
  list, chart and ordering uses that. 100% of bills have one (1,153 from a
  plenum sitting, 2 from a committee).
- **Knesset 25 spans two governments.** The 36th was still in office when the
  term opened, so its ministers appear in the position data. Only roles whose
  `GovernmentNum` matches the sitting government (37) are shown as current.
- **Votes are deliberately not joined to anything yet.** `PlenumVote` carries
  the sitting id and the item id, and both do match `PlenumSession` and `Bill`.
  `PlenumVoteResult.mkId` does not match anything: it is a **third** Knesset
  person id space, distinct from both `personId` and `siteId` — חנוך דב מלביצקי
  is 30842, 1105 and 34368 respectively. Joining it by number would file one
  member's voting record under another. The vote pages show the names the feed
  writes onto each result row instead, and say so.
- **Government bills have no MK initiators** — they are submitted by a ministry,
  so `KNS_BillInitiator` is legitimately empty for them (100% of private bills
  have sponsors; only 10% of government bills do). The bill page says so rather
  than showing a blank card.
- The ETL is **idempotent**: every step that needs "all bills" reads the set back
  from the database instead of reusing the in-run backfill list, which is empty
  on a re-run. Two consecutive runs produce identical row counts.

## Views

- `/` — counts, the bills most recently tabled, recent committee and plenum
  sittings, and what is scheduled next.
- `/bills`, `/bills/[id]` — bill metadata, summary and sponsors; the bill's own
  texts, being what was laid before the Knesset at each reading in every
  published format; and a vertical timeline interleaving, in date order, plenum
  tablings and readings (labelled with their stage, and flagged when actually
  debated), every committee discussion, publication in the gazette, and current
  status — each with direct links to the relevant files.
- `/plenum`, `/plenum/[id]` — plenum sittings, and per sitting the bills on its
  agenda with the stage each reached, other agenda items, and its transcripts.
- `/members`, `/members/[id]` — member cards showing faction, coalition or
  opposition, and any role in the sitting government; sortable by name, faction,
  bloc, bills sponsored or seniority, with a serving-only filter. Detail pages
  add a Recharts bar chart of bills sponsored per month (split lead vs.
  co-signed), the committees they actually sat in, their written questions with
  how promptly those were answered, and recent bills.
- `/committees`, `/committees/[id]` — the term's committees grouped by type,
  and per committee its membership (derived from protocol attendance, with the
  chair marked), sitting rhythm, the bills it handled, recent sittings,
  subcommittees and — for a joint committee — the committees that make it up.
- `/questions` — written questions (שאילתות) to ministers, sortable by lateness,
  filterable by answered / pending / late, with a per-ministry breakdown.
- `/search` — across bills, members, sittings and sessions in the local mirror.

## Committee attendance

Committee rosters are absent from the API, but every protocol opens with a
structured `נכחו:` header listing who was in the room, under labelled sections,
with the chair marked. `scripts/protocols/` parses that deterministically — no
LLM:

```bash
npm run attendance                    # both stages, ~20 min
python3 scripts/protocols/verify.py   # re-run the accuracy check
```

Over 9,043 protocols: **52,455 member and MK names extracted, 98.8% resolved to
a Person**, giving 52,061 stored rows across 9,104 of 10,895 sittings, and 9,041
chair rows.

Only committee members and visiting MKs are stored, and only when the name
resolves to exactly one Person. Both groups are by definition in the registry,
so requiring a match is what structurally keeps job titles out of the roster —
protocol sections are not perfectly regular. Invitees and legal advisors are
parsed but not stored: they are mostly outside the registry, so nothing would
validate them.

**This is attendance, not an official roster.** Someone who never attends will
not appear, and the long tail of occasional visitors is real — ועדת הכספים has
67 people who attended at least once, so the roster is capped at the 20 most
frequent and the page says so.

The documents are never kept: at ~148 KB each the full set is 1.4 GB and only
the header is wanted. A gzipped cache of the header text is retained so a
parser change can be replayed with `--from-cache` instead of re-downloading —
a lesson learned after paying for two full passes.

## Member photos

The OData service exposes no image, and the Knesset's own archive sits behind a
bot-protected host with no stated licence. The Knesset Archives did, however,
donate a batch of MK portraits to **Wikimedia Commons** under CC BY-SA, credited
to the photographer — so `npm run photos` pulls them from there instead.

The join runs through Wikidata property **P9770** ("Knesset member ID"), which
is `SiteId`. Because a wrong id yields a real photo of the wrong person rather
than a miss, every match is name-checked against the Wikidata label before it is
written, and disagreements are skipped and reported.

Only free licences are accepted (CC*, CC0, public domain); anything else is
skipped. Credit, licence and a link to the Commons file page are stored
alongside the URL and rendered on the member page — CC BY-SA requires it.

Many members' Wikidata items carry a photo but no P9770, so a second, weaker
pass matches on name — behind a review gate, because a wrong name match does not
fail visibly, it puts a real person's face on the wrong MK:

```bash
npm run photos -- --propose        # stages candidates, writes nothing
# open http://localhost:3000/photo-review.html and check every face
npm run photos -- --apply-review   # writes only entries set to approve: true
```

The proposal requires the Wikidata label to equal our name once normalised, the
item to hold the position "Knesset member" (Q4047513), and the name to resolve
to exactly one such item; ambiguity is rejected rather than guessed. Each card
also shows the party Wikidata holds against the faction we hold — a second,
independent signal, though it only flags and cannot catch a swap between two
members of the same party. The faces are the real gate.

Coverage is **138 of 151 members, 108 of 120 serving**. The rest fall back to
initials, which is a normal state rather than a failure.

## Phase 2 — who spoke, and how much (stub)

Attendance is already solved deterministically (above). What the protocol header
does *not* carry is the body: who spoke, how often, and about what.
`scripts/extract_participants_llm.ts` is the stub for that, writing speaking
turns into the same `CommitteeParticipant` table.

```bash
npx tsx scripts/extract_participants_llm.ts --session=2244838 --file=p.txt --dry-run
```

Protocol text comes from `scripts/protocols/extract_text.py`. Note the service
lists protocols as `.doc` but they are **OOXML** — the Python standard library
reads them directly, and no converter (antiword, catdoc, LibreOffice) is needed.

`--provider` accepts `openai` | `gemini` | `anthropic`; set the matching
`*_API_KEY`. The system prompt lives in `prompts/extract-participants.he.txt`.

**Status:** parsing, MK name-matching and persistence are tested and working.
The provider HTTP calls are written to each vendor's documented shape but have
**never been executed** — no API key was available. Treat the first live run as
the integration test ([#5](https://github.com/netaalon/galui/issues/5)).

## For contributors and coding agents

`.claude/skills/` holds four references written from what this project has
already learned the hard way — `knesset-odata` (the API's undocumented limits,
non-unique keys and misleading fields), `galui-architecture` (layout, data flow,
conventions), `contributing-to-galui` (how work here is verified) and
`hebrew-and-rtl` (name matching, document parsing, RTL layout traps).
`AGENTS.md` points at them too.

## What's next

Planned work is tracked in [issues](https://github.com/netaalon/galui/issues).
The nearest are extracting the דברי הסבר explanatory notes from bill PDFs (#1),
which would give 93% of bills the substance they currently lack; linking split
and merged bills (#18); full-text search (#4 over metadata, #17 over document
text); and voting data from protocols (#11).
