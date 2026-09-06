---
name: knesset-odata
description: Hard-won facts about the Knesset OData API (OdataV4/ParliamentInfo) — its undocumented limits, keys that are not unique, fields that are empty, and data that is not there at all. Read before writing or changing any ingestion code, or before concluding that something is missing. Triggers on "OData", "KNS_", "ParliamentInfo", "ingest", "ETL", "Knesset API".
---

# The Knesset OData API

The Knesset OData service is the **only** sanctioned source for legislative data
in this project. Do not add HTML scrapers for knesset.gov.il, and do not pull
from oknesset.org or hasadna/knesset-data-pipelines — their data predates changes
the Knesset has since made, which is exactly how you end up publishing something
that is confidently wrong.

Reading the hasadna *pipeline code* to discover which official endpoint they
call is fine. Using their data is not.

## Which feed, and which services exist

**This project reads v4: `https://knesset.gov.il/OdataV4/ParliamentInfo`** —
with exactly one deliberate exception, `KNS_MkSiteCode`, whose v4 rows are
corrupt. See "Where v4 is worse than v2".

The older `/Odata/ParliamentInfo.svc` (v2/v3) still answers, and much of the
internet — including this project until the migration — is written against it.
Do not go back to it. The Knesset's own developer manual is explicit: *"מעתה
מומלץ למשתמשים להשתמש בפיד החדש. הכנסת מתעתדת להפסיק לפרסם את המידע בפורמט של
ODATA-v2"*. v4 also carries ten entity sets v2 never had, and fixes real defects
(see "What v4 changed").

Official manual:
`https://main.knesset.gov.il/Activity/Info/documents/KnessetOdataManual.docx`
(a .docx; `scripts/protocols/extract_text.py` reads it).

Under `/Odata/` there were exactly two services, `ParliamentInfo.svc` and
`Votes.svc` — seventeen other plausible names were swept and everything else
302s. `Votes.svc` is well shaped but its most recent vote is **2021-07-13**, with
**zero rows for Knesset 25**; current voting data is v4's `KNS_PlenumVote` /
`KNS_PlenumVoteResult`.

That sweep is also a cautionary tale: it tried many *service names* under one
path and concluded from the silence that no other data existed. The data did
exist, one path segment away. When an API seems to be missing something, vary
the shape of the guess, not just its contents.

## Limits that are not documented

- **Every response is capped at 100 rows**, whatever `$top` says. Verified with
  `$top=500`: 100 rows and an `@odata.nextLink` offering the rest. Paging is
  mandatory.
- **Filters are limited to 100 expression nodes.** A chain of `Id eq a or Id eq
  b or …` dies at about 25 ids with `"The node count limit of '100' has been
  exceeded"` — a 400, not a 404, and nothing to do with length. **Use the `in`
  operator**: `Id in (a,b,c)` is one node however long the list, so it sidesteps
  the ceiling entirely and is four times terser. `inList()` in
  `scripts/lib/odata.ts` builds it.
- **Long request URLs 404** — silently, with no hint that length is the problem.
  Bisected on `KNS_DocumentCommitteeSession`: 200 ids succeeded at 2,129 encoded
  characters and 201 failed at 2,149. `chunkForFilter()` budgets by length; use
  it rather than a constant. With `in` that works out to ~180 ids per request,
  against ~48 under v2's `or` chains.
- **Sustained concurrency draws transient failures.** Four to six parallel
  requests is fine, but always retry with backoff — a protocol download pass
  without retries lost 6,108 of 9,135 files, every one of which succeeded later.
- **Do not retry a 4xx, and do read the body.** A malformed query fails the same
  way forever, so retrying costs a minute and buries the cause under four
  backoffs. The service explains itself precisely in the response body — a
  filter naming a property that does not exist says so — and that text is worth
  far more than the status line. `fetchJson()` fails fast on 4xx other than 408
  and 429, and surfaces the body; that is what identified both the node-count
  limit and two filters still using v2 key names.
- `$count=true` returns `@odata.count` as a number. (v2 spelled this
  `$inlinecount=allpages` and returned a string.)
- **Single-row key access mostly does not work.** `KNS_Bill(2206637)` and
  `KNS_PlenumSession(...)` answer, but `KNS_Committee(4190)`, `KNS_Faction(1)`,
  `KNS_Status(81)` and `KNS_CommitteeSession(...)` all 404 while the rows are
  plainly there under `$filter`. Link to a row as `?$filter=Id eq <n>`; that is
  what `src/lib/odata-link.ts` does.

## Entities that do not contain what their name implies

| Expectation | Reality |
|---|---|
| `KNS_MkIndividual` | **Does not exist**, in either feed. MK status is derived from `KNS_PersonToPosition` rows with `PositionID` 43 (חבר הכנסת) or 61 (חברת הכנסת); faction comes from the `PositionID` 54 row. |
| A bill's explanation | `KNS_Bill.SummaryLaw` is populated **only after a bill passes third reading** (7% of bills). For everything else the explanation is in the PDF. |
| Member photos | **No image field in either feed, still.** Re-checked against v4: not one of the 48 entity types has a property matching image/photo/picture/img/avatar/portrait, `KNS_Person` is byte-identical to v2's eight columns, and the old `GetMkImage` paths 404. Photos come from Wikimedia Commons; see `scripts/fetch-photos.ts`. |
| Coalition / opposition | **Not published per MK, in either feed.** Only the two leadership posts exist (`PositionID` 30 and 131, one row each for Knesset 25). The curated map in `src/lib/factions.ts` is the source, and it needs re-checking as coalitions shift. |

Committee membership **is** published — `KNS_PersonToPosition` rows carry a
`CommitteeID` in v4 (12,628 rows, 1,632 for Knesset 25) where in v2 not one of
11,102 rows did. The ETL stores them. For Knesset 25, by `PositionID`:

| id | role | rows | currently serving |
|---|---|---|---|
| 41 | יו"ר ועדה | 143 | 72 |
| 42 | חבר ועדה | 1,000 | 477 |
| 66 | חברת ועדה | 285 | 199 |
| 67 | מ"מ חבר ועדה | 204 | 83 |

Chairs come with their history — a committee shows its former chairs with
`IsCurrent` false — so 86 committees have had a chair and 72 have one now.

The committee and member pages still show attendance-derived rosters from
`scripts/protocols/`, and the two are **not interchangeable**: attendance counts
everyone who turned up, so it runs 2–3x larger than the appointed membership
(ועדת החוץ והביטחון: 31 official, 78 attended; ועדת החינוך: 18 against 62).
Attendance answers "who actually shows up", the official roster answers "who is
on this committee". Do not present one as the other, and do not describe
attendance as the only thing obtainable.

**The attendance pipeline is not superseded by the official roster and must not
be removed.** The gap between the two is the point: subtracting the appointed
membership from the people who attended leaves the visitors, guests and
substitutes, which no OData table gives you and which is the intended basis for
a future "who came to this committee" view. Keep `scripts/protocols/` and
`CommitteeParticipant`.

## Keys, and where the metadata lies

`$metadata` declares an entity key that is sometimes a lie, and in v4 it
declares an entity **set** that is not there at all: both the metadata and the
service document advertise `KNS_DocumentQuerie`, and every URL under that name
404s (see "Question documents" below). **Check before trusting either.** v4
renamed every primary key to `Id` and fixed two of the three key defects below.

- `KNS_DocumentBill`, `KNS_DocumentCommitteeSession`, `KNS_DocumentPlenumSession`
  — in v2 the same document was published once per format (DOC and PDF) as two
  rows sharing one id, differing only in `ApplicationID`; keying on the id alone
  silently dropped every alternate format. **v4 issues a distinct `Id` per row.**
  We still store `"<documentId>:<applicationId>"`, because changing the key
  format would strand every document row already in a database as an
  un-updatable duplicate.
- `KNS_JointCommittee` — `JointCommitteeID` was `"1"` on many rows in v2. **v4
  issues a real unique `Id`.** Rows are still keyed on the committee pair, which
  is what makes a re-run idempotent, and the same pair can appear twice upstream.
- `KNS_PlmSessionItem` — v2's key was `plmPlenumSessionID`, which despite the
  name identified the *item*. In v4 it is `Id`, and `PlenumSessionID` is the
  sitting.
- `KNS_BillSplit` and `KNS_BillUnion` — declared keys verified unique.

Only the *own* key moved. Foreign keys kept their names, so `KNS_BillInitiator`
still filters on `BillID` while `KNS_CommitteeSession` — the table that key
points at — now wants `Id`. Filtering a parent table by its legacy name is a
400, and it is easy to miss because the field name lives in a string argument
that no compiler checks. `fetchByIds()` carries the warning at its parameter.

## Document rows: identity lives in the file path, not the id

The two feeds number the same document completely differently, and this is the
single most disruptive difference between them.

- **Ids were renumbered wholesale.** A protocol v2 called 552478 is 625948 in
  v4. These are not de-duplicated ids; they are a different numbering. v4's is
  the real one: it is the number that appears in the file's own URL
  (`24_cs_bg_625948.pdf`).
- **So upserting v4 rows into a v2-built database doubles every document
  table** (and `PlenumSessionItem`, renumbered the same way) — old rows keyed the old way, new rows beside them, every protocol and
  bill text listed twice. `pruneStaleDocuments()` in the ETL deletes rows under
  the parents it just refreshed that the feed no longer publishes, which absorbs
  the switch and also handles a genuine upstream retraction.
- **`filePath` is identical across the feeds**, which is what lets provenance
  survive: attendance rows are re-pointed from the old document row to the new
  one by matching on it.
- **The DOC and the PDF of one text no longer share an id.** Under v2 they did,
  and UI code grouped formats by it. In v4 they share only the *file stem* —
  `25/law/25_lst_2807878.docx` and `…2807878.pdf` — so that stem is the grouping
  key. Grouping by id in v4 lists every bill text twice; this got past a
  compiler and a type check, and was only visible by looking at a bill page.
- **v4 writes bill paths with backslashes**, `.../25\law\25_lst_2807878.docx`,
  where v2 used forward slashes and where the committee and plenum tables use
  forward slashes in both feeds. A backslash means nothing in a URL path, so the
  ETL normalises them; that also makes the path usable as the cross-feed key.

## Question documents are not served over OData

`KNS_DocumentQuerie` — the set both `$metadata` and the service document
advertise — **404s under every query option**. `KNS_DocumentQuery` answers
instead, and not as OData: a bare JSON array, camelCase keys, no `value`
envelope and no `@odata.count`. `$top`, `$skip` and `$filter … in (…)` all work,
and its ids match the file names, so the data is v4's.

`fetchJson()` wraps a bare array into `{ value }` for this one endpoint, and the
ETL's `RawQueryDocument` is lower-cased to match. Do not "fix" that casing.

## `KNS_PlmSessionItem` answers nondeterministically

**The identical request returns different rows each time it is called.** Same
filter, same `$skip`, same `$orderby=Id`: three consecutive calls to one page
returned 100 correctly-sorted rows each and 78 of the ids differed between them.
`@odata.count` stays put at 2,677 and every drain returns exactly 2,677 rows, so
nothing looks wrong — the membership just churns by about 7%.

This is specific to this entity. `KNS_CmtSessionItem`,
`KNS_DocumentCommitteeSession` and `KNS_BillInitiator` were checked the same way
and are byte-stable across repeated calls, so it is not paging behaviour and not
something `$orderby` can fix.

Two consequences:

- **Two runs of the same ETL disagree by roughly a thousand plenum items.**
  Re-running accretes coverage rather than converging on an exact set. Do not
  treat a plenum item count as reproducible, and do not diff two runs and
  conclude something broke.
- **Never delete plenum items because a run did not return them.** That throws
  away good rows every run. Deleting only rows whose content reappeared under a
  different id is not a way out either: 1,376 content identities are held by
  more than one row upstream, so a row that merely flickered out would be
  deleted as if superseded. The v2 → v4 renumbering of this table is therefore
  handled by a documented one-time `DELETE`, not by the ETL. See the note above
  `writePlenumItems()`.

## Data v4 moved rather than dropped

Before concluding a field is gone, look for a table that took it over. The
column emptying out is not the same as the data disappearing — this caught me
once already.

- **`KNS_CommitteeSession.BroadcastUrl` is null on every row in v4**, where 7,384
  Knesset 25 sittings carried one in v2. The data moved to
  **`KNS_BroadcastCommitteSession`** (109,256 rows, 20,576 with a URL), keyed on
  an `Id` that *is* the CommitteeSessionID. Every one of a 150-sitting sample
  resolved. The replacement links are better: `https` rather than `http`, and a
  per-committee archive page instead of the generic `AllCommitteesBroadcast`
  one. `ingestBroadcastUrls()` restores them — 7,115 of the 7,441 sittings that
  had one under v2. The remaining 326 are present in the new table with a null
  `BroadcastUrl` (mostly joint committees and subcommittees), so that residue is
  the feed's, not ours.

## Where v4 is worse than v2, measured

Migrating is right, but it is not a pure gain. Every figure below is a
table-by-table diff of the same term ingested from each feed.

- **`KNS_MkSiteCode.KnsID` is corrupt in v4, and this one table is still read
  from v2.** Both feeds carry the same 1,115 rows with the same `SiteId`s and
  the same site codes, but 177 of v4's `KnsID` values name people who do not
  exist in `KNS_Person`, so they resolve to nobody. v2's all resolve, and
  Wikidata's P9770 confirms v2 is right — SiteId 953 is אמיר אוחנה in both.
  Taking v4 here strips the `SiteId` from **105 of the 151 members of Knesset
  25**, and `SiteId` is the key the photo pipeline joins on. `ingestPeople()`
  reads it from `ODATA_V2_BASE` and warns if the resolution rate drops. It is
  the only such exception; do not add a second without this much evidence.
- **Plenum documents are thinner.** v4 drops three types outright: `תור מליאה`
  (16,778 → 0), `סטנוגרמה` (401 → 0) and `תוכן עניינים` (401 → 0). Every other
  type is identical row for row, including `דברי הכנסת`, the actual transcript,
  on all 417 sittings that have one. The queue files were noise; the stenogram
  and the table of contents are a real loss of two supplementary links per
  sitting.
- **`Location` changed on every sitting**, and is a net gain: v4 fills 2,337
  locations v2 left null, at the cost of degrading 778 from a room ("חדר
  הוועדה, באגף קדמה, קומה 3, חדר 3720") to a bare committee name ("ועדת
  הכנסת"). No v4 row is null; 1,235 are bare names.
- **`KNS_PlmSessionItem` ids were renumbered** — v2's run 886,959–1,012,648 and
  v4's 83,445–168,862, with no overlap, for content that is otherwise identical
  (13,430 tuples match exactly, none only in one feed). Like the document tables
  this doubles on upsert, and it would show every reading twice on a bill's
  timeline; unlike them it cannot be pruned automatically, for the reason in the
  section above. `KNS_CmtSessionItem` ids, by contrast, are **unchanged**, and so
  are `KNS_Bill`, `KNS_BillInitiator`, `KNS_Committee`, `KNS_Faction`,
  `KNS_Status`, `KNS_GovMinistry`, `KNS_Query` and `KNS_DocumentQuery` — those
  diffed to zero.
- Sub-second precision is dropped on some timestamps (68 plenum `FinishDate`s
  lost their milliseconds). Cosmetic, but it means a strict equality test
  against a v2-built row will fail.

## Referential integrity is not guaranteed by arrival order

`KNS_Committee` rows reference a parent committee in the same table, and the
feed does not deliver parents first — one of 2,901 rows arrives before its
parent, which is a foreign key violation against an empty database and invisible
against a populated one. `orderParentsFirst()` in the ETL sorts by chain depth
and unlinks a parent id the feed does not itself define. **Test ingestion
against a fresh database**, not just a re-run; that is where this class of bug
shows up.

## Fields that mislead

- **`LastUpdatedDate` is not when anything happened.** It is rewritten in bulk:
  when an MK resigns, every pending bill they sponsored is restamped with that
  day and given the reason `חה"כ המציע התפטר`. One resignation put 99 bills into
  a single month. 60% of the corpus dates differently under `LastUpdatedDate`
  than under a real event. Use `Bill.firstStepDate` (derived: the earliest
  sitting that had the bill on its agenda). Never order user-facing lists by
  `LastUpdatedDate`.
- **DateTimes carry Israel's offset, and we drop it.** v4 serves
  `2026-09-08T10:00:00+03:00`; v2 served the same wall clock naked. Every date in
  this database is an Israeli wall-clock reading stored as if it were UTC and
  rendered in UTC, so a sitting published as 10:00 displays as 10:00. Honouring
  the offset would shift every stored time by two or three hours and push
  late-evening sittings into the wrong day in the `strftime` month buckets behind
  the activity charts. See `parseDate()` and `src/lib/format.ts`.
- **`MKSiteCode` and `SiteId` are different ids** over overlapping small integer
  ranges, both in `KNS_MkSiteCode` (where v2's `MKSiteCode` is v4's `Id`, and
  it changed from a string to a number). `SiteId` is what knesset.gov.il member
  pages, the photo archive and Wikidata's P9770 use. Confusing them does not
  fail — it returns the wrong person. Site code 837 is חנין זועבי; SiteId 837 is
  חמד עמאר.
- **Government bills have no MK initiators** (10% do, vs 100% of private bills).
  An empty `KNS_BillInitiator` is correct data for them, not a gap.
- **Knesset 25 spans two governments.** The 36th was still in office when the
  term opened, so its ministers appear in the position data. Filter on
  `GovernmentNum` before calling anyone a serving minister.

## Child tables have no KnessetNum

`KNS_CmtSessionItem`, `KNS_PlmSessionItem`, `KNS_BillInitiator` and the document
tables cannot be filtered by term. They must be fetched by parent id, which is
what makes the URL-length limit the binding constraint on a full run. Use
`fetchByIds()`.

## Semantics worth knowing

- `KNS_CmtSessionItem` / `KNS_PlmSessionItem`: `ItemTypeID` 2 means the item is a
  bill and `ItemID` is a `BillID`.
- `KNS_PlmSessionItem.StatusID` is the **legislative reading stage**
  ("הונחה על שולחן הכנסת לקריאה ראשונה"), not a workflow state. It is what makes
  a bill timeline readable. `IsDiscussion` (an int, not a bool) separates a real
  debate from merely being tabled.
- `KNS_Query` gives both when a reply was due and when it arrived, so ministry
  lateness is arithmetic on given fields rather than inference.
- `KNS_GovMinistry` contains duplicates and placeholders ("אין נתונים"); group on
  the id, label with the name.

## What v4 changed, and what it added

Porting notes, for reading old code and issues written against v2:

- **Every primary key is renamed `Id`.** Foreign keys keep their names, so
  `KNS_BillInitiator` still has `BillID` — only its own key moved.
- `$count=true` / `@odata.count`, not `$inlinecount=allpages` / `odata.count`.
- `$format=json` is unnecessary; JSON is the default.
- **Timestamps gained Israel's offset**, and document ids were renumbered — both
  have their own sections above, and both change stored data rather than just
  the request.
- **v4 carries more rows, not only more tables.** `KNS_PersonToPosition` for
  Knesset 25 returns 2,178 rows against v2's 554, and 1,632 of them carry a
  `CommitteeID` — the committee seats v2 omitted entirely. Do not assume a row
  count measured on v2 still holds.
- `KNS_Bill` gains `TypeID` / `TypeDesc` and `PublicationSeriesFirstCallDesc`.
- Question documents leave OData entirely — see its section above.

Not yet ingested — each is an open issue, not an oversight:

- `KNS_PlenumVote` (36,183) and `KNS_PlenumVoteResult` (1,953,709) — plenum votes
  with per-MK results, current, keyed on a numeric `MkId`, so no name matching
  is needed. This is a far better source than parsing protocols or scraping
  `WebSiteApi/knessetapi/Votes`.
- `V_Lobbyists`, `V_LobbyistsClients`.
- `KNS_SecondaryLaw` (60,297), `KNS_IsraelLaw` and the law-correction tables.
- `KNS_BillSplit` / `KNS_BillUnion` — why a bill's page can look empty (#18).
- `KNS_BillName` — a bill's renaming history.

Present in v4 and now ingested: committee membership (above) and
`KNS_BroadcastCommitteSession`. Absent from v4 as from v2: member photos, and
per-MK coalition/opposition.
