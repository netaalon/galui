---
name: knesset-odata
description: Hard-won facts about the Knesset OData API (ParliamentInfo.svc) — its undocumented limits, keys that are not unique, fields that are empty, and data that is not there at all. Read before writing or changing any ingestion code, or before concluding that something is missing. Triggers on "OData", "KNS_", "ParliamentInfo", "ingest", "ETL", "Knesset API".
---

# The Knesset OData API

`https://knesset.gov.il/Odata/ParliamentInfo.svc` is the **only** sanctioned source
for legislative data in this project. Do not add HTML scrapers for
knesset.gov.il, and do not pull from oknesset.org or hasadna/knesset-data-pipelines
— their data predates changes the Knesset has since made, which is exactly how
you end up publishing something that is confidently wrong.

Reading the hasadna *pipeline code* to discover which official endpoint they
call is fine. Using their data is not.

## Only two services exist

`ParliamentInfo.svc` and `Votes.svc`. Seventeen other plausible names were
swept; everything else 302s. There is no committee service, no members service,
no lobbyist service.

`Votes.svc` is well shaped but its most recent vote is **2021-07-13** and it
holds **zero rows for Knesset 25**. See issue #10 before spending time on it.

## Limits that are not documented

- **Every response is capped at 100 rows**, whatever `$top` says. Verified with
  `$top=500`. Paging through `$skip` is mandatory.
- **Long request URLs 404** — silently, with no hint that length is the problem.
  The ceiling is about 2 KB *encoded*, so it is a length limit, not an id count:
  48 ids fit for `BillID`, but 50 already fails for `CommitteeSessionID` because
  the field name is longer. `chunkForFilter()` in `scripts/lib/odata.ts` budgets
  by length; use it rather than a constant.
- **Sustained concurrency draws transient failures.** Four to six parallel
  requests is fine, but always retry with backoff — a protocol download pass
  without retries lost 6,108 of 9,135 files, every one of which succeeded later.
- `$inlinecount=allpages` works and returns `odata.count` as a string.
- `$format=json` returns `{value: [...]}`, not the OData v3 `{d: {results}}` shape.

## Entities that do not contain what their name implies

| Expectation | Reality |
|---|---|
| `KNS_MkIndividual` | **Does not exist.** MK status is derived from `KNS_PersonToPosition` rows with `PositionID` 43 (חבר הכנסת) or 61 (חברת הכנסת); faction comes from the `PositionID` 54 row. |
| Committee membership | **Does not exist anywhere.** `PositionID` 41/42/66/67/663 are defined in `KNS_Position` but have zero rows, and not one `KNS_PersonToPosition` row carries a `CommitteeID` — verified by fetching all 11,102. It is recovered from protocol headers instead; see `scripts/protocols/`. |
| A bill's explanation | `KNS_Bill.SummaryLaw` is populated **only after a bill passes third reading** (7% of bills). For everything else the explanation is in the PDF. |
| Member photos | No image field, and no working endpoint. `GetMkImage` returns the literal string `"value"`. Photos come from Wikimedia Commons; see `scripts/fetch-photos.ts`. |

## Keys that are not unique

`$metadata` declares an entity key that is sometimes a lie. **Check before
trusting one.**

- `KNS_DocumentBill`, `KNS_DocumentCommitteeSession`, `KNS_DocumentPlenumSession`
  — the same document is published once per format (DOC and PDF) as two rows
  sharing one id, differing only in `ApplicationID`. Keying on the id alone
  silently drops every alternate format. Stored as `"<documentId>:<applicationId>"`.
- `KNS_JointCommittee` — `JointCommitteeID` is `"1"` on many rows. Keyed on the
  committee pair instead.
- `KNS_DocumentQuery` — genuinely issues a distinct id per format, so the id
  alone *is* safe here. The tables differ; do not generalise either way.
- `KNS_BillSplit` and `KNS_BillUnion` — declared keys verified unique.
- `KNS_PlmSessionItem` — the key is `plmPlenumSessionID`, which despite the name
  identifies the *item*; `PlenumSessionID` is the sitting.

## Fields that mislead

- **`LastUpdatedDate` is not when anything happened.** It is rewritten in bulk:
  when an MK resigns, every pending bill they sponsored is restamped with that
  day and given the reason `חה"כ המציע התפטר`. One resignation put 99 bills into
  a single month. 60% of the corpus dates differently under `LastUpdatedDate`
  than under a real event. Use `Bill.firstStepDate` (derived: the earliest
  sitting that had the bill on its agenda). Never order user-facing lists by
  `LastUpdatedDate`.
- **DateTimes carry no zone offset.** `new Date()` would read them as
  server-local, so the same ETL would produce different instants on different
  machines. They are parsed as UTC and rendered in UTC, preserving the published
  wall-clock time. See `parseDate()` and `src/lib/format.ts`.
- **`MKSiteCode` and `SiteId` are different ids** over overlapping small integer
  ranges, both in `KNS_MkSiteCode`. `SiteId` is what knesset.gov.il member pages,
  the photo archive and Wikidata's P9770 use. Confusing them does not fail — it
  returns the wrong person. Site code 837 is חנין זועבי; SiteId 837 is חמד עמאר.
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
