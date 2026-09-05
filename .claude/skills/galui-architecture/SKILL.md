---
name: galui-architecture
description: How Galui is laid out — the stack, the data flow from the Knesset API to the page, where each kind of code belongs, and the conventions that are load-bearing. Read before adding a page, a query, an ingest stage or a model. Triggers on "architecture", "where should this go", "add a page", "add a model", "ETL stage", "project layout".
---

# Galui architecture

A Next.js app over a local SQLite mirror of the Knesset OData API, tracking the
25th Knesset: bills, members, committees, plenum sittings and written questions.

## Stack

Next.js 16 (App Router, RSC) · TypeScript · Tailwind v4 · shadcn/ui · Recharts ·
Prisma 7 with the `better-sqlite3` driver adapter.

Next.js 16 has breaking changes from what you may remember: `params` and
`searchParams` are **Promises** and must be awaited. `AGENTS.md` points at
version-matched docs in `node_modules/next/dist/docs/` — read the relevant guide
before writing page code.

Prisma 7 talks to SQLite through a driver adapter, not a query engine binary.
The client is generated to `src/generated/prisma` (gitignored, produced by
`postinstall`). Config lives in `prisma7.config.ts`, not `prisma.config.ts`.

## Data flow

```
Knesset OData  ──scripts/fetch-odata.ts──►  SQLite  ──src/lib/queries.ts──►  RSC pages
Wikimedia      ──scripts/fetch-photos.ts──►
Protocol PDFs  ──scripts/protocols/ + load-attendance.ts──►
```

Nothing fetches from the network at request time. Every page reads the local
mirror and is `export const dynamic = "force-dynamic"`, so a fresh ingest shows
up without a rebuild.

## Where things belong

| Path | Holds |
|---|---|
| `scripts/fetch-odata.ts` | The whole OData ETL, one function per entity, ordered so foreign keys resolve |
| `scripts/lib/odata.ts` | Paging, retry, URL-budget chunking, bounded concurrency, date parsing |
| `scripts/protocols/` | Protocol download and the deterministic attendance parser (Python) |
| `scripts/*.ts` | One-purpose loaders: photos, attendance, the Phase 2 LLM stub |
| `src/lib/queries.ts` | Every database read. `server-only`; never import from a client component |
| `src/lib/*-sort.ts` | Sort/filter constants shared with client controls — kept out of `queries.ts` on purpose |
| `src/lib/format.ts` | Hebrew/UTC formatting, name and count helpers |
| `src/lib/factions.ts` | The hand-maintained coalition/opposition map |
| `src/app/**/page.tsx` | Server components; await `params`, call queries, render |
| `src/components/` | Shared presentational pieces; `ui/` is shadcn, do not hand-edit |

**A client component must never import `src/lib/queries.ts`.** It is
`server-only` and pulls Prisma, and the build fails with `Can't resolve 'fs'`
from `better-sqlite3`. That is why sort constants live in their own modules.

## Conventions that are load-bearing

- **Database columns are English; data is Hebrew.** Do not translate payloads.
- **The UI is Hebrew and RTL** (`lang="he" dir="rtl"`). Use logical properties —
  `ms-`/`me-`, `ps-`/`pe-`, `border-s` — never `left`/`right`. See the
  `hebrew-and-rtl` skill.
- **Derived data is labelled as derived, in the UI.** Coalition membership,
  committee rosters and `firstStepDate` are all inferred, and each page says so.
  If you add a derived field, say where it came from on the page that shows it.
- **Every ingest step is an upsert** keyed on the upstream primary key, and the
  ETL is idempotent: two consecutive runs produce identical counts. Steps that
  need "all bills" read the set back from the database rather than reusing an
  in-run backfill list, which is empty on a re-run — that trap has bitten twice.
- **The ETL mirrors the whole term by default.** Sampling produced gaps
  indistinguishable from bugs. `--bills` / `--sessions` / `--plenum` exist only
  for quick local iteration.

## Models with a story

- `Bill.firstStepDate` — the earliest sitting that had the bill on its agenda.
  Exists because `LastUpdatedDate` is rewritten in bulk. Order lists by this.
- `Person.isMk` / `bloc` / `governmentRole` — derived, because the API has no
  MK entity and no bloc data.
- `CommitteeParticipant` — attendance parsed from protocol headers, since the
  API publishes no rosters.
- `SessionDocument.id` etc. — synthetic `"<documentId>:<applicationId>"`, because
  the upstream document ids are not unique per format.

## Commands

```bash
npm run dev                     # Next dev server
npm run ingest                  # full OData mirror, ~8 min, ~35 MB
npm run photos                  # MK headshots from Wikimedia Commons
npm run attendance              # protocol attendance (extract + load), ~20 min
npm run typecheck && npm run lint && npm run build
npm run smoke                   # browser checks; app must be running
```
