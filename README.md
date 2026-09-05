# גלוי / Galui

Tracks what the Knesset is actually doing: bills and their progress through
committee and plenum, the members who sponsor them, and the sittings where they
get discussed.

This is the MVP. It covers the **25th Knesset** (the current term) and reads
**exclusively** from the official Knesset OData v3 service:

```
https://knesset.gov.il/Odata/ParliamentInfo.svc/
```

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
npm run ingest               # pull real data from the Knesset API (~4 min)
npm run dev
```

`npm run ingest` is safe to re-run — every write is an upsert on the OData
primary key.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run ingest` | ETL from the Knesset OData API |
| `npm run ingest -- --knesset=25 --bills=500 --sessions=300 --plenum=200` | Widen the sample |
| `npm run photos` | Fetch MK headshots from Wikimedia Commons |
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
| `KNS_Status`, `KNS_ItemType`, `KNS_Faction` | `Status`, — , `Faction` | Label lookups |

Things worth knowing, all verified against the live service:

- **`KNS_MkIndividual` does not exist** in this service, despite being widely
  referenced. "Is this person an MK" is derived from `KNS_PersonToPosition`
  rows with `PositionID` 43 (חבר הכנסת) or 61 (חברת הכנסת); faction comes from
  the `PositionID` 54 row. The ETL denormalises this onto `Person.isMk`,
  `factionName` and `roleDesc`.
- **The service caps every response at 100 rows**, whatever `$top` says. All
  paging goes through `$skip` in steps of 100.
- **A session item is a bill** when `ItemTypeID = 2`; then `ItemID` is a
  `BillID`. This junction is what the bill timeline is built from.
- **Dates carry no timezone.** They are stored as UTC standing in for the
  Israeli wall-clock time the Knesset published, and rendered in UTC, so the
  displayed time matches the source on any machine.
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
- The upstream primary key of `KNS_PlmSessionItem` is **`plmPlenumSessionID`**,
  which despite the name identifies the *item*; `PlenumSessionID` is the sitting.
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
- **Government bills have no MK initiators** — they are submitted by a ministry,
  so `KNS_BillInitiator` is legitimately empty for them (100% of private bills
  have sponsors; only 10% of government bills do). The bill page says so rather
  than showing a blank card.
- The ETL is **idempotent**: every step that needs "all bills" reads the set back
  from the database instead of reusing the in-run backfill list, which is empty
  on a re-run. Two consecutive runs produce identical row counts.

## Views

- `/` — counts, 5 most recently updated bills, 5 most recent committee sessions,
  plus upcoming sessions.
- `/bills`, `/bills/[id]` — bill metadata, summary, sponsors, and a vertical
  list of its own texts (what was laid before the Knesset at each reading, in
  every published format), and a vertical timeline interleaving, in date order:
  plenum tablings and readings (labelled
  with their stage, and flagged when actually debated), every committee
  discussion, publication in the gazette, and current status — each with direct
  links to the relevant protocol or transcript files.
- `/plenum`, `/plenum/[id]` — plenum sittings, and per sitting the bills on its
  agenda with the stage each reached, other agenda items, and its transcripts.
- `/members`, `/members/[id]` — member cards showing faction, coalition or
  opposition, and any role in the sitting government; sortable by name, faction,
  bloc, bills sponsored or seniority, with a serving-only filter. Detail pages
  add a Recharts bar chart of bills sponsored per month (split lead vs.
  co-signed), committees, and recent bills.
- `/search` — across bills, members and sessions in the local mirror.

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

Coverage is **120 of 151 members, 94 of 120 serving**. The rest fall back to
initials, which is a normal state rather than a failure.

## Phase 2 — who spoke in committee (stub)

The API publishes protocol *files* but never says who spoke. That gap is filled
by an LLM pass writing into the `CommitteeParticipant` table.

```bash
# protocols are legacy .doc — convert one first
curl -sL "<SessionDocument.filePath>" -o p.doc
libreoffice --headless --convert-to txt p.doc

npx tsx scripts/extract_participants_llm.ts --session=2244838 --file=p.txt --dry-run
```

`--provider` accepts `openai` | `gemini` | `anthropic`; set the matching
`*_API_KEY`. The system prompt lives in `prompts/extract-participants.he.txt`.
Extracted speakers are matched to `Person` rows by exact full name; anything
ambiguous is stored unmatched rather than guessed.

**Status:** parsing, MK name-matching and persistence are tested and working.
The provider HTTP calls are written to each vendor's documented shape but have
**never been executed** — no API key was available. Treat the first live run as
the integration test ([#5](https://github.com/netaalon/galui/issues/5)).

## What's next

Planned work is tracked in [issues](https://github.com/netaalon/galui/issues) —
extracting the דברי הסבר explanatory notes from bill PDFs (#1), ingesting the
full Knesset 25 corpus (#2), incremental ingestion (#3) and full-text search (#4).
