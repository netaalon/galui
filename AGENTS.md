<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on Galui

Galui mirrors the Knesset's official OData API into SQLite and renders it as a
Hebrew, right-to-left site. Before changing anything, read the relevant skill in
`.claude/skills/` — they are plain Markdown and record facts that were expensive
to establish:

| Skill | Read it before |
|---|---|
| `knesset-odata` | Touching ingestion, or concluding that data is missing |
| `galui-architecture` | Adding a page, query, model or ETL stage |
| `contributing-to-galui` | Any change — how work here is verified |
| `hebrew-and-rtl` | Matching Hebrew names, parsing documents, or laying out a page |

Three things that catch people out immediately:

- **The API lies about its own shape.** Declared entity keys are sometimes not
  unique, `KNS_MkIndividual` does not exist, and `LastUpdatedDate` is not when
  anything happened. Check against live data before designing.
- **Never guess an identity.** Two Knesset id spaces overlap, and a wrong match
  puts a real person's record on someone else's page without erroring.
- **Verify by measuring.** Sample across the real distribution and report a
  yield, then run `npm run typecheck && npm run lint && npm run build` and
  `npm run smoke`.
